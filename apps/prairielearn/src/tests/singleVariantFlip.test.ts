import * as path from 'node:path';

import * as cheerio from 'cheerio';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import * as tmp from 'tmp-promise';
import { afterAll, assert, beforeAll, describe, it } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { config } from '../lib/config.js';

import * as helperCourse from './helperCourse.js';
import * as helperServer from './helperServer.js';

// Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/802
//
// A Homework question that starts as `singleVariant: false` is given a fresh
// variant per attempt; grading a correct submission CLOSES that variant
// (variants.open = FALSE). If the instructor then flips the question to
// `singleVariant: true` and re-syncs, the student's already-answered variant is
// still closed, so the next page load -- which calls ensureVariant with
// require_open = true for Homework -- discards it and generates a BRAND-NEW
// variant with different random parameters. The student's previously-correct
// answer no longer matches, i.e. "correct answers marked incorrect".
//
// Correct behavior: a single_variant question must keep reusing the SAME
// variant, open or not. So after the flip, reloading the question must return
// the SAME variant the student already answered.

function courseInstanceBaseUrl() {
  return `http://localhost:${config.serverPort}/pl/course_instance/1`;
}

const templateDir = path.join(import.meta.dirname, 'singleVariantCourse');
const questionInfoRelPath = 'questions/addNumbers/info.json';

let courseDir: string;

function questionInfoFullPath() {
  return path.join(courseDir, questionInfoRelPath);
}

async function setSingleVariant(value: boolean) {
  const info = await fs.readJson(questionInfoFullPath());
  info.singleVariant = value;
  await fs.writeJson(questionInfoFullPath(), info, { spaces: 2 });
  await helperCourse.syncCourse(courseDir);
}

/** Returns the rendered student instance-question page parsed by cheerio. */
async function getInstanceQuestionPage(instanceQuestionUrl: string) {
  const res = await fetch(instanceQuestionUrl);
  assert.equal(res.status, 200);
  return cheerio.load(await res.text());
}

const VariantRowSchema = z.object({
  id: IdSchema,
  open: z.boolean(),
  params: z.record(z.any()),
  broken: z.boolean(),
});

/** Pull the live variant id + its random params straight from the DB. */
async function selectLatestVariant(instanceQuestionId: string) {
  return await sqldb.queryRow(
    `SELECT v.id, v.open, v.params, v.broken
       FROM variants AS v
      WHERE v.instance_question_id = $instance_question_id
      ORDER BY v.date DESC
      LIMIT 1`,
    { instance_question_id: instanceQuestionId },
    VariantRowSchema,
  );
}

describe(
  'issue #802: switching a Homework question to singleVariant after a correct submission',
  { timeout: 60_000 },
  () => {
    beforeAll(async () => {
      const { path: dir } = await tmp.dir({ unsafeCleanup: true });
      courseDir = path.join(dir, 'course');
      await fs.copy(templateDir, courseDir);
      // Sanity: start from singleVariant:false.
      const info = await fs.readJson(questionInfoFullPath());
      assert.equal(info.singleVariant, false);
      await helperServer.before(courseDir)();
    }, 120_000);

    afterAll(async () => {
      await helperServer.after();
    });

    it('keeps the same answered variant after the flip (does not regenerate a new one)', async () => {
      // --- 1. Student starts the assessment ---------------------------------
      const assessmentId = await sqldb.queryScalar(
        `SELECT a.id FROM assessments AS a WHERE a.tid = 'HW1'`,
        IdSchema,
      );
      const startRes = await fetch(`${courseInstanceBaseUrl()}/assessment/${assessmentId}/`);
      assert.equal(startRes.status, 200);

      const instanceQuestionId = await sqldb.queryScalar(
        `SELECT iq.id
         FROM instance_questions AS iq
         JOIN assessment_questions AS aq ON aq.id = iq.assessment_question_id
        ORDER BY iq.id DESC
        LIMIT 1`,
        IdSchema,
      );
      const instanceQuestionUrl = `${courseInstanceBaseUrl()}/instance_question/${instanceQuestionId}/`;

      // --- 2. Student opens the question -> variant V1 ----------------------
      let $ = await getInstanceQuestionPage(instanceQuestionUrl);
      const variantIdInput = $('.question-form input[name="__variant_id"]');
      assert.lengthOf(variantIdInput, 1);
      const v1Id = variantIdInput.attr('value');
      assert.isString(v1Id);
      const csrf = $('.question-form input[name="__csrf_token"]').attr('value');
      assert.isString(csrf);

      const v1 = await selectLatestVariant(instanceQuestionId);
      assert.equal(v1.id, v1Id);
      assert.isTrue(v1.open, 'fresh variant should be open');
      const correctAnswer = v1.params.a + v1.params.b; // addNumbers correct answer

      // --- 3. Student submits the CORRECT answer; it grades correct ---------
      const gradeRes = await fetch(instanceQuestionUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'grade',
          __csrf_token: csrf as string,
          __variant_id: v1Id as string,
          c: String(correctAnswer),
        }),
      });
      assert.equal(gradeRes.status, 200);

      const submission = await sqldb.queryRow(
        `SELECT s.correct, s.score
         FROM submissions AS s
         JOIN variants AS v ON v.id = s.variant_id
        WHERE v.instance_question_id = $instance_question_id
        ORDER BY s.date DESC
        LIMIT 1`,
        { instance_question_id: instanceQuestionId },
        z.object({ correct: z.boolean().nullable(), score: z.number().nullable() }),
      );
      assert.isTrue(submission.correct, 'submission should be graded correct');

      // Homework closes a non-single-variant variant once it is answered correctly.
      const v1AfterGrade = await selectLatestVariant(instanceQuestionId);
      assert.equal(v1AfterGrade.id, v1Id, 'still the same single variant');
      assert.isFalse(
        v1AfterGrade.open,
        'non-single-variant HW variant closes after a correct grade',
      );

      // --- 4. Instructor flips the question to singleVariant:true + resync --
      await setSingleVariant(true);

      // --- 5. Student reloads the question ----------------------------------
      $ = await getInstanceQuestionPage(instanceQuestionUrl);
      const reloadVariant = await selectLatestVariant(instanceQuestionId);

      // THE BUG: a brand-new variant V2 (different params) is generated, throwing
      // away the answered V1. THE FIX: the answered V1 is reused.
      assert.equal(
        reloadVariant.id,
        v1Id,
        'after flipping to singleVariant:true the student must keep the SAME answered variant, ' +
          'not get a freshly-generated one',
      );
      // The reloaded page must show the same question the student already answered.
      assert.deepEqual(reloadVariant.params, v1.params, 'the same variant params are shown');
      const reloadVariantInput = $('.question-form input[name="__variant_id"]');
      if (reloadVariantInput.length > 0) {
        assert.equal(reloadVariantInput.attr('value'), v1Id, 'rendered variant id is unchanged');
      }

      // Red-team / no-regression: flipping back to singleVariant:false must restore
      // the normal Homework behavior -- the closed answered variant is once again
      // skipped and a fresh variant is generated for the next attempt.
      await setSingleVariant(false);
      await getInstanceQuestionPage(instanceQuestionUrl);
      const afterRevert = await selectLatestVariant(instanceQuestionId);
      assert.notEqual(
        afterRevert.id,
        v1Id,
        'with singleVariant:false the closed variant is skipped and a new one is generated',
      );
      assert.isTrue(afterRevert.open, 'the freshly generated variant is open');
    });
  },
);
