import { afterAll, assert, beforeAll, describe, test } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { config } from '../lib/config.js';
import { selectAssessmentByTid } from '../models/assessment.js';

import * as helperClient from './helperClient.js';
import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

// Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/3878
//
// When `allowRealTimeGrading: false`, grading is deferred until the assessment is
// closed. At close time the grader must grade the last *valid* submission for each
// variant. If the student's final submission is invalid (e.g. time expired with a
// malformed answer in the box), an earlier valid submission must still be graded —
// it must NOT silently receive zero points.
describe('Non-real-time grading falls back to last valid submission', { timeout: 60_000 }, () => {
  const context: Record<string, any> = { siteUrl: `http://localhost:${config.serverPort}` };
  context.baseUrl = `${context.siteUrl}/pl`;
  context.courseInstanceBaseUrl = `${context.baseUrl}/course_instance/1`;

  beforeAll(helperServer.before());
  afterAll(helperServer.after);

  beforeAll(async () => {
    const { id: assessmentId } = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'exam8-disableRealTimeGrading',
    });
    context.assessmentId = assessmentId;
    context.assessmentUrl = `${context.courseInstanceBaseUrl}/assessment/${context.assessmentId}/`;
  });

  test.sequential('start the exam', async () => {
    const startPage = await helperClient.fetchCheerio(context.assessmentUrl);
    assert.isTrue(startPage.ok);
    helperClient.extractAndSaveCSRFToken(context, startPage.$, 'form');

    const response = await helperClient.fetchCheerio(context.assessmentUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'new_instance',
        __csrf_token: context.__csrf_token,
      }),
    });
    assert.isTrue(response.ok);
    assert.include(response.url, '/assessment_instance/');
    context.assessmentInstanceUrl = response.url;

    const match = response.url.match(/assessment_instance\/(\d+)/);
    assert.ok(match, 'assessment instance id should be in URL');
    context.assessmentInstanceId = match![1];

    // partialCredit1 awards a score equal to the submitted percentage; the correct
    // answer is a plain "100". We pick it because (a) its answer is deterministic and
    // (b) a non-numeric value yields an *invalid* (non-gradable) submission. Resolve
    // its instance_question id from the DB so we don't depend on page link text/order.
    const { id: instanceQuestionId } = await sqldb.queryRow(
      sql.select_instance_question_id,
      { assessment_instance_id: context.assessmentInstanceId, qid: 'partialCredit1' },
      z.object({ id: z.string() }),
    );
    context.questionUrl = `${context.courseInstanceBaseUrl}/instance_question/${instanceQuestionId}/`;
  });

  test.sequential('save a valid answer, then save an invalid answer', async () => {
    const questionPage = await helperClient.fetchCheerio(context.questionUrl);
    assert.isTrue(questionPage.ok);
    const variantId = questionPage.$('input[name=__variant_id]').val() as string;
    assert.ok(variantId);
    context.variantId = variantId;

    // 1. Save a VALID answer (full credit).
    const validResponse = await helperClient.fetchCheerio(context.questionUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'save',
        __csrf_token: helperClient.getCSRFToken(questionPage.$),
        __variant_id: variantId,
        s: '100',
      }),
    });
    assert.isTrue(validResponse.ok);

    // 2. Save an INVALID answer last (non-numeric => gradable = false). This mimics
    //    the student leaving a garbage value in the box when the timer expires.
    const invalidResponse = await helperClient.fetchCheerio(context.questionUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'save',
        __csrf_token: helperClient.getCSRFToken(questionPage.$),
        __variant_id: variantId,
        s: 'not-a-number',
      }),
    });
    assert.isTrue(invalidResponse.ok);
  });

  test.sequential('the most-recent submission is the invalid one', async () => {
    const submissions = await sqldb.queryRows(
      sql.select_submissions_for_variant,
      { variant_id: context.variantId },
      z.object({ id: z.string(), gradable: z.boolean().nullable() }),
    );
    // Ordered date DESC: newest first. Newest must be the invalid (non-gradable) one,
    // and an earlier valid (gradable) submission must exist.
    assert.isAtLeast(submissions.length, 2);
    assert.isFalse(submissions[0].gradable, 'newest submission should be invalid');
    assert.isTrue(
      submissions.some((s) => s.gradable),
      'an earlier valid submission should exist',
    );
  });

  test.sequential('finish the assessment (defers grading to close)', async () => {
    const instancePage = await helperClient.fetchCheerio(context.assessmentInstanceUrl);
    assert.isTrue(instancePage.ok);

    const finishResponse = await helperClient.fetchCheerio(context.assessmentInstanceUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'finish',
        __csrf_token: helperClient.getCSRFToken(instancePage.$),
      }),
    });
    assert.isTrue(finishResponse.ok);
  });

  test.sequential('the question is graded against the last VALID submission', async () => {
    const instanceQuestion = await sqldb.queryRow(
      sql.select_instance_question_for_variant,
      { variant_id: context.variantId },
      z.object({
        points: z.number().nullable(),
        score_perc: z.number().nullable(),
        status: z.string().nullable(),
      }),
    );

    // The valid submission was 100%, worth 19 auto points. Before the fix this is 0
    // because the grader only looked at the last (invalid) submission and bailed.
    assert.equal(instanceQuestion.score_perc, 100);
    assert.equal(instanceQuestion.points, 19);
  });
});
