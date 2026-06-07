import { afterAll, assert, beforeAll, describe, test } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { config } from '../lib/config.js';
import { selectAssessmentByTid } from '../models/assessment.js';

import * as helperClient from './helperClient.js';
import * as helperServer from './helperServer.js';

// Regression test for PrairieLearn/PrairieLearn#3120:
// "There should be no penalty for re-submitting a wrong answer."
//
// On an Exam, each graded submission advances `number_attempts`, which consumes
// an entry in the question's `points_list` (lowering the value of the remaining
// attempts). Re-submitting an answer identical to the most recent graded
// submission therefore used up a try for no benefit. The fix marks an identical
// re-submission as not gradable (status 'invalid'), just like a blank answer, so
// it does not consume an attempt.

describe('Re-submitting an identical wrong answer (issue #3120)', { timeout: 60_000 }, function () {
  const context: Record<string, any> = { siteUrl: `http://localhost:${config.serverPort}` };
  context.baseUrl = `${context.siteUrl}/pl`;
  context.courseInstanceBaseUrl = `${context.baseUrl}/course_instance/1`;

  beforeAll(async function () {
    await helperServer.before()();
    const { id: assessmentId } = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'exam1-automaticTestSuite',
    });
    context.assessmentId = assessmentId;
    context.assessmentUrl = `${context.courseInstanceBaseUrl}/assessment/${context.assessmentId}/`;
  });

  afterAll(helperServer.after);

  test.sequential('start the exam', async () => {
    const startResponse = await helperClient.fetchCheerio(context.assessmentUrl);
    assert.isTrue(startResponse.ok);
    helperClient.extractAndSaveCSRFToken(context, startResponse.$, 'form');

    const response = await helperClient.fetchCheerio(context.assessmentUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'new_instance',
        __csrf_token: context.__csrf_token,
      }),
    });
    assert.isTrue(response.ok);
    assert.include(response.url, '/assessment_instance/');

    // partialCredit3 has autoPoints [13, 13, 8, 0.5, 0.1] — multiple attempts,
    // each worth less, so it exhibits the "using up tries" penalty.
    const instanceQuestionId = await sqldb.queryRow(
      "SELECT iq.id::text AS id FROM instance_questions AS iq JOIN assessment_questions AS aq ON aq.id = iq.assessment_question_id JOIN questions AS q ON q.id = aq.question_id WHERE q.qid = 'partialCredit3';",
      {},
      z.object({ id: z.string() }),
    );
    context.questionUrl = `${context.courseInstanceBaseUrl}/instance_question/${instanceQuestionId.id}/`;
  });

  async function gradeWrongAnswer() {
    const getResponse = await helperClient.fetchCheerio(context.questionUrl);
    assert.isTrue(getResponse.ok);
    helperClient.extractAndSaveCSRFToken(context, getResponse.$, '.question-form');
    helperClient.extractAndSaveVariantId(context, getResponse.$, '.question-form');

    const response = await helperClient.fetchCheerio(context.questionUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'grade',
        __csrf_token: context.__csrf_token,
        __variant_id: context.__variant_id,
        s: '0', // wrong answer (correct is 100)
      }),
    });
    assert.isTrue(response.ok);
  }

  async function instanceQuestionState() {
    return await sqldb.queryRow(
      "SELECT iq.number_attempts, iq.points_list FROM instance_questions AS iq JOIN assessment_questions AS aq ON aq.id = iq.assessment_question_id JOIN questions AS q ON q.id = aq.question_id WHERE q.qid = 'partialCredit3';",
      {},
      z.object({ number_attempts: z.number(), points_list: z.array(z.number()).nullable() }),
    );
  }

  async function gradableSubmissionCount() {
    return await sqldb.queryRow(
      "SELECT count(*)::int AS n FROM submissions AS s JOIN variants AS v ON v.id = s.variant_id JOIN instance_questions AS iq ON iq.id = v.instance_question_id JOIN assessment_questions AS aq ON aq.id = iq.assessment_question_id JOIN questions AS q ON q.id = aq.question_id WHERE q.qid = 'partialCredit3' AND s.gradable IS TRUE;",
      {},
      z.object({ n: z.number() }),
    );
  }

  test.sequential('first wrong answer consumes one attempt', async () => {
    await gradeWrongAnswer();
    const state = await instanceQuestionState();
    assert.equal(state.number_attempts, 1, 'first graded submission should advance attempts to 1');
    // After 1 attempt the next attempt is worth points_list[0] = 13.
    assert.deepEqual(state.points_list, [13, 8, 0.5, 0.1]);
  });

  test.sequential('re-submitting the same wrong answer does NOT consume an attempt', async () => {
    await gradeWrongAnswer();

    const state = await instanceQuestionState();
    assert.equal(
      state.number_attempts,
      1,
      'an identical re-submission must NOT advance number_attempts (issue #3120)',
    );
    // The remaining-attempt values must be unchanged: the student still has a
    // 13-point attempt available.
    assert.deepEqual(
      state.points_list,
      [13, 8, 0.5, 0.1],
      'an identical re-submission must NOT shrink the points_list (issue #3120)',
    );

    // The duplicate submission is recorded but marked not gradable.
    const { n } = await gradableSubmissionCount();
    assert.equal(n, 1, 'only the first (distinct) submission should be gradable');
  });

  test.sequential('a different (still wrong) answer consumes the next attempt', async () => {
    const getResponse = await helperClient.fetchCheerio(context.questionUrl);
    assert.isTrue(getResponse.ok);
    helperClient.extractAndSaveCSRFToken(context, getResponse.$, '.question-form');
    helperClient.extractAndSaveVariantId(context, getResponse.$, '.question-form');

    const response = await helperClient.fetchCheerio(context.questionUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'grade',
        __csrf_token: context.__csrf_token,
        __variant_id: context.__variant_id,
        s: '10', // a DIFFERENT wrong answer
      }),
    });
    assert.isTrue(response.ok);

    const state = await instanceQuestionState();
    assert.equal(state.number_attempts, 2, 'a distinct answer should advance attempts');
    // points_list shrank by one entry (the second attempt was consumed).
    assert.lengthOf(state.points_list ?? [], 3);
  });
});
