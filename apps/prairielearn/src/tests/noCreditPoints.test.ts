import { afterAll, assert, beforeAll, describe, test } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { dangerousFullSystemAuthz } from '../lib/authz-data-lib.js';
import { config } from '../lib/config.js';
import { selectAssessmentByTid } from '../models/assessment.js';
import { selectCourseInstanceById } from '../models/course-instances.js';
import { ensureUncheckedEnrollment } from '../models/enrollment.js';
import { selectUserByUid } from '../models/user.js';

import * as helperClient from './helperClient.js';
import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

// Issue #958: under an access rule with no credit (credit = 0), working a
// question must NOT change the assessment instance's points/score. Today the
// grade machinery still writes points (the raw earned points leak in even
// though credit is 0), which corrupts the "attempted for credit" signal that
// e.g. CS 411 reads from the gradebook.
//
// The test course assessment `hw9-noCreditPoints` has two windows:
//   2020 -> credit: 100  (the for-credit phase)
//   2021+ -> active: true, credit: 0  (submittable but no credit)
const CREDIT_DATE = 'pl_test_date=2020-06-01T00:00:01Z';
const NO_CREDIT_DATE = 'pl_test_date=2022-06-01T00:00:01Z';

describe('No-credit access rule must not change assessment instance points (issue #958)', { timeout: 60_000 }, () => {
  const storedConfig: Record<string, any> = {};
  const context: Record<string, any> = {};
  context.siteUrl = `http://localhost:${config.serverPort}`;
  context.baseUrl = `${context.siteUrl}/pl`;
  context.courseInstanceBaseUrl = `${context.baseUrl}/course_instance/1`;

  beforeAll(async () => {
    storedConfig.authUid = config.authUid;
    storedConfig.authName = config.authName;
    storedConfig.authUin = config.authUin;

    await helperServer.before()();

    const { id: hwId } = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'hw9-noCreditPoints',
    });
    context.hwId = hwId;
    context.hwUrl = `${context.courseInstanceBaseUrl}/assessment/${hwId}/`;
  }, 120_000);

  afterAll(helperServer.after, 120_000);
  afterAll(() => {
    Object.assign(config, storedConfig);
  });

  // Switch the effective/auth user, enroll them, and return a headers object
  // pinned to the given test date.
  async function actAs(uid: string, cookie: string): Promise<Record<string, string>> {
    config.authUid = uid;
    config.authName = uid;
    config.authUin = uid;
    // A warm-up request creates the user from the configured auth identity.
    const home = await helperClient.fetchCheerio(context.baseUrl, { headers: {} });
    assert.isTrue(home.ok);
    const user = await selectUserByUid(uid);
    const courseInstance = await selectCourseInstanceById('1');
    await ensureUncheckedEnrollment({
      userId: user.id,
      courseInstance,
      requiredRole: ['System'],
      authzData: dangerousFullSystemAuthz(),
      actionDetail: 'implicit_joined',
    });
    return { cookie };
  }

  // Start the homework (creating an instance) and grade the first question with
  // the requested percentage score. Returns the assessment instance id.
  async function startAndGrade(
    headers: Record<string, string>,
    scorePercent: number,
  ): Promise<number> {
    const assessmentResponse = await helperClient.fetchCheerio(context.hwUrl, { headers });
    assert.isTrue(assessmentResponse.ok);
    const instanceUrl = assessmentResponse.url;
    assert.include(instanceUrl, '/assessment_instance/');

    const questionPath = assessmentResponse.$('a:contains(HW9.1.)').attr('href');
    assert.isString(questionPath);
    const questionUrl = `${context.siteUrl}${questionPath}`;

    // Load the question page to mint a variant + CSRF token.
    const questionResponse = await helperClient.fetchCheerio(questionUrl, { headers });
    assert.isTrue(questionResponse.ok);
    const csrf = helperClient.extractAndSaveCSRFToken(context, questionResponse.$, '.question-form');
    const variantId = helperClient.extractAndSaveVariantId(
      context,
      questionResponse.$,
      '.question-form',
    );

    const gradeResponse = await helperClient.fetchCheerio(questionUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'grade',
        __csrf_token: csrf,
        __variant_id: variantId,
        s: String(scorePercent),
      }),
      headers,
    });
    assert.isTrue(gradeResponse.ok);

    return helperClient.parseAssessmentInstanceId(instanceUrl);
  }

  function readPoints(assessmentInstanceId: number) {
    return sqldb.queryOptionalRow(
      sql.read_assessment_instance_points_by_id,
      { assessment_instance_id: assessmentInstanceId },
      z.object({
        points: z.number().nullable(),
        score_perc: z.number().nullable(),
      }),
    );
  }

  test.sequential('credit-bearing rule still scores normally (control)', async () => {
    const headers = await actAs('student-credit@example.com', CREDIT_DATE);
    const aiId = await startAndGrade(headers, 100);
    const row = await readPoints(aiId);
    // Full credit, 100% on a 10-point question -> 10 points, 100%.
    assert.equal(row?.points, 10);
    assert.equal(row?.score_perc, 100);
  });

  test.sequential(
    'no-credit-only attempt must not record points (never attempted for credit)',
    async () => {
      // This student never touches the assessment during the for-credit window,
      // then submits a perfect answer during the no-credit window.
      const headers = await actAs('student-nocredit@example.com', NO_CREDIT_DATE);
      const aiId = await startAndGrade(headers, 100);
      const row = await readPoints(aiId);
      // The instance was created fresh in the no-credit window, so its points
      // must remain at the unchanged creation value (0) -- the no-credit work
      // must not record the 10 earned points. (Base behavior: points = 10.)
      assert.equal(row?.points, 0);
      assert.equal(row?.score_perc, 0);
    },
  );

  test.sequential(
    'no-credit attempt must not overwrite an existing for-credit score',
    async () => {
      // Phase 1: attempt for credit, scoring 50% -> 5 points recorded.
      const creditHeaders = await actAs('student-mixed@example.com', CREDIT_DATE);
      const aiId = await startAndGrade(creditHeaders, 50);
      const afterCredit = await readPoints(aiId);
      assert.equal(afterCredit?.points, 5);
      assert.equal(afterCredit?.score_perc, 50);

      // Phase 2: same student works the question again in the no-credit window,
      // this time perfectly. The recorded for-credit score must be untouched.
      // (Base behavior: points gets recomputed and inflated to 10.)
      const noCreditHeaders = { cookie: NO_CREDIT_DATE };
      const questionPath = `/pl/course_instance/1/instance_question`;
      // Re-open the assessment instance page in the no-credit window to find the
      // question, then grade it again.
      const instanceResponse = await helperClient.fetchCheerio(
        `${context.courseInstanceBaseUrl}/assessment_instance/${aiId}`,
        { headers: noCreditHeaders },
      );
      assert.isTrue(instanceResponse.ok);
      const qPath = instanceResponse.$('a:contains(HW9.1.)').attr('href');
      assert.isString(qPath, 'question link should be present in no-credit window');
      assert.include(qPath as string, questionPath);
      const qUrl = `${context.siteUrl}${qPath}`;

      const qResponse = await helperClient.fetchCheerio(qUrl, { headers: noCreditHeaders });
      assert.isTrue(qResponse.ok);
      const csrf = helperClient.getCSRFToken(qResponse.$('.question-form'));
      const variantId = qResponse.$('.question-form input[name="__variant_id"]').val() as string;
      assert.isString(variantId);

      const gradeResponse = await helperClient.fetchCheerio(qUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'grade',
          __csrf_token: csrf,
          __variant_id: variantId,
          s: '100',
        }),
        headers: noCreditHeaders,
      });
      assert.isTrue(gradeResponse.ok);

      const afterNoCredit = await readPoints(aiId);
      assert.equal(afterNoCredit?.points, 5, 'no-credit work must not change recorded points');
      assert.equal(afterNoCredit?.score_perc, 50, 'no-credit work must not change recorded score');
    },
  );
});
