import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { afterAll, assert, beforeAll, describe, it } from 'vitest';

import * as sqldb from '@prairielearn/postgres';

import { config } from '../lib/config.js';
import { VariantSchema } from '../lib/db-types.js';
import { selectAssessmentByTid } from '../models/assessment.js';

import { saveOrGrade } from './helperClient.js';
import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const siteUrl = 'http://localhost:' + config.serverPort;
const baseUrl = siteUrl + '/pl';
const courseInstanceBaseUrl = baseUrl + '/course_instance/1';

/**
 * Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/5498
 *
 * When a question's `grade()` throws a fatal error, PrairieLearn must mark the
 * *variant* broken (`variant.broken_at`) — not only the submission. Otherwise
 * the broken variant is reused on every load/re-grade (every "skip / new
 * variant" gate keys off `broken_at`), permanently blocking the student.
 */
describe('grade() fatal error marks the variant broken', { timeout: 60_000 }, function () {
  beforeAll(helperServer.before());
  afterAll(helperServer.after);

  it('sets variant.broken_at after a fatal grading error', async () => {
    // brokenGrading lives in hw1-automaticTestSuite; its grade() raises.
    const { id: assessmentId } = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'hw1-automaticTestSuite',
    });

    // Open the assessment to create the assessment instance + instance questions.
    const assessmentUrl = `${courseInstanceBaseUrl}/assessment/${assessmentId}/`;
    const assessmentRes = await fetch(assessmentUrl);
    assert.equal(assessmentRes.status, 200);
    const $assessment = cheerio.load(await assessmentRes.text());

    // Find the instance-question URL for the brokenGrading question.
    const iqHref = $assessment(`td a:contains("Broken grading function")`).attr('href');
    assert.isDefined(iqHref, 'could not find brokenGrading instance question link');
    const instanceQuestionUrl = siteUrl + iqHref;

    // Generate the variant by loading the question page.
    const iqRes = await fetch(instanceQuestionUrl);
    assert.equal(iqRes.status, 200);
    const $iq = cheerio.load(await iqRes.text());
    const variantId = $iq('form input[name="__variant_id"]').val();
    assert.isString(variantId, 'no variant generated for brokenGrading');

    // Sanity: variant is healthy before grading.
    const before = await sqldb.queryRow(
      sql.select_variant_by_id,
      { variant_id: variantId },
      VariantSchema,
    );
    assert.isNull(before.broken_at, 'precondition: variant should not be broken yet');

    // Grade with a valid answer so parse() succeeds and grade() actually runs
    // (grade() then raises a fatal error).
    const gradeRes = await saveOrGrade(instanceQuestionUrl, { x: '3' }, 'grade');
    assert.equal(gradeRes.status, 200);

    // The fix: the variant must now be marked broken so the student can
    // get a fresh one. Before the fix, broken_at stays NULL (student stuck).
    const after = await sqldb.queryRow(
      sql.select_variant_by_id,
      { variant_id: variantId },
      VariantSchema,
    );
    assert.isNotNull(
      after.broken_at,
      'variant.broken_at should be set after a fatal grade() error',
    );
    assert.isNotNull(after.broken_by, 'variant.broken_by should record who triggered grading');
    // The legacy `broken` boolean is kept in sync (as `insert_variant` does).
    assert.isTrue(after.broken, 'variant.broken should be kept in sync with broken_at');
  });
});
