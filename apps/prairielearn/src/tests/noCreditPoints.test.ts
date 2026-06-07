import { afterAll, assert, beforeAll, describe, test } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { dangerousFullSystemAuthz } from '../lib/authz-data-lib.js';
import { config } from '../lib/config.js';
import { updateInstanceQuestionScore } from '../lib/manualGrading.js';
import { regradeAllAssessmentInstances } from '../lib/regrading.js';
import { selectAssessmentById, selectAssessmentByTid } from '../models/assessment.js';
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
// The test course assessment `hw21-noCreditPoints` has two windows:
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
      tid: 'hw21-noCreditPoints',
    });
    context.hwId = hwId;
    context.hwUrl = `${context.courseInstanceBaseUrl}/assessment/${hwId}/`;

    // A second assessment with TWO questions in one zone, used to exercise the
    // multi-question regrade boundary (#137-A follow-up): different questions
    // answered under different credits.
    const { id: hwMultiId } = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'hw22-noCreditMultiQuestion',
    });
    context.hwMultiId = hwMultiId;
    context.hwMultiUrl = `${context.courseInstanceBaseUrl}/assessment/${hwMultiId}/`;

    // A third assessment whose second question is *manually* graded, used to
    // exercise the manual-points regrade boundary: a no-credit-window question
    // can still earn points from a deliberate instructor manual grade, and those
    // points must survive a regrade.
    const { id: hwManualId } = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'hw23-noCreditManualPoints',
    });
    context.hwManualId = hwManualId;
    context.hwManualUrl = `${context.courseInstanceBaseUrl}/assessment/${hwManualId}/`;
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

    const questionPath = assessmentResponse.$('a:contains(HW21.1.)').attr('href');
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

  // Grade the question reachable from `pageUrl` whose visible link text contains
  // `questionLinkText`, submitting the requested percentage score. Returns the
  // assessment instance id parsed from the assessment-overview URL.
  async function gradeQuestionFromPage(
    pageUrl: string,
    questionLinkText: string,
    headers: Record<string, string>,
    scorePercent: number,
  ): Promise<number> {
    const pageResponse = await helperClient.fetchCheerio(pageUrl, { headers });
    assert.isTrue(pageResponse.ok);
    const instanceUrl = pageResponse.url;
    assert.include(instanceUrl, '/assessment_instance/');

    const questionPath = pageResponse.$(`a:contains(${questionLinkText})`).attr('href');
    assert.isString(questionPath, `question link "${questionLinkText}" should be present`);
    const questionUrl = `${context.siteUrl}${questionPath}`;

    const questionResponse = await helperClient.fetchCheerio(questionUrl, { headers });
    assert.isTrue(questionResponse.ok);
    const csrf = helperClient.getCSRFToken(questionResponse.$('.question-form'));
    const variantId = questionResponse.$('.question-form input[name="__variant_id"]').val() as string;
    assert.isString(variantId);

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

  function readQuestionPoints(assessmentInstanceId: number) {
    return sqldb.queryRows(
      sql.read_instance_question_points,
      { assessment_instance_id: assessmentInstanceId },
      z.object({ points: z.number().nullable() }),
    );
  }

  function readQuestionBreakdown(assessmentInstanceId: number) {
    return sqldb.queryRows(
      sql.read_instance_question_point_breakdown,
      { assessment_instance_id: assessmentInstanceId },
      z.object({
        id: z.string(),
        points: z.number().nullable(),
        auto_points: z.number().nullable(),
        manual_points: z.number().nullable(),
      }),
    );
  }

  // Save (not grade) a submission for the question reachable from `pageUrl` whose
  // visible link text contains `questionLinkText`. Used for manually-graded
  // questions, which have no auto-grade step -- saving just records a submission
  // (which, in the no-credit window, carries credit = 0). Returns the assessment
  // instance id parsed from the assessment-overview URL.
  async function submitQuestionFromPage(
    pageUrl: string,
    questionLinkText: string,
    headers: Record<string, string>,
  ): Promise<number> {
    const pageResponse = await helperClient.fetchCheerio(pageUrl, { headers });
    assert.isTrue(pageResponse.ok);
    const instanceUrl = pageResponse.url;
    assert.include(instanceUrl, '/assessment_instance/');

    const questionPath = pageResponse.$(`a:contains(${questionLinkText})`).attr('href');
    assert.isString(questionPath, `question link "${questionLinkText}" should be present`);
    const questionUrl = `${context.siteUrl}${questionPath}`;

    const questionResponse = await helperClient.fetchCheerio(questionUrl, { headers });
    assert.isTrue(questionResponse.ok);
    const csrf = helperClient.getCSRFToken(questionResponse.$('.question-form'));
    const variantId = questionResponse.$('.question-form input[name="__variant_id"]').val() as string;
    assert.isString(variantId);

    const saveResponse = await helperClient.fetchCheerio(questionUrl, {
      method: 'POST',
      body: new URLSearchParams({
        __action: 'save',
        __csrf_token: csrf,
        __variant_id: variantId,
        explanation: 'a saved no-credit answer',
      }),
      headers,
    });
    assert.isTrue(saveResponse.ok);

    return helperClient.parseAssessmentInstanceId(instanceUrl);
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
      const qPath = instanceResponse.$('a:contains(HW21.1.)').attr('href');
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

  test.sequential(
    'instructor regrade must recompute earned points even after a no-credit submission (issue #137-A)',
    async () => {
      // Red-team finding #137-A. A student earns for-credit points, then makes a
      // single no-credit practice submission. Because the recompute paths resolve
      // credit from the *last* submission (which is now the no-credit one),
      // gating the credit math on that value made an instructor regrade a silent
      // no-op -- the student's legitimately-earned for-credit points were never
      // corrected. The regrade must recompute from the for-credit work, not be
      // suppressed by the trailing no-credit submission.

      // Phase 1: earn for-credit points (50% -> 5 points on the 10-point question).
      const creditHeaders = await actAs('student-regrade@example.com', CREDIT_DATE);
      const aiId = await startAndGrade(creditHeaders, 50);
      assert.equal((await readPoints(aiId))?.points, 5);

      // Phase 2: one no-credit practice submission scoring 0% -- it must not
      // change the recorded points, and (scoring 0%) it leaves the question's
      // earned points at the for-credit value, so the correct regrade result is
      // unambiguous. The instance now has a for-credit submission AND a more
      // recent no-credit submission (whose credit = 0 is what the buggy gate
      // wrongly keyed the regrade on).
      const noCreditHeaders = { cookie: NO_CREDIT_DATE };
      const instanceResponse = await helperClient.fetchCheerio(
        `${context.courseInstanceBaseUrl}/assessment_instance/${aiId}`,
        { headers: noCreditHeaders },
      );
      assert.isTrue(instanceResponse.ok);
      const qPath = instanceResponse.$('a:contains(HW21.1.)').attr('href');
      assert.isString(qPath);
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
          s: '0',
        }),
        headers: noCreditHeaders,
      });
      assert.isTrue(gradeResponse.ok);
      // The no-credit submission must not have changed the recorded points.
      assert.equal((await readPoints(aiId))?.points, 5);

      // Simulate a stale/incorrect recorded instance score that an instructor
      // regrade is meant to correct (e.g. a points policy change). The for-credit
      // work is intact in instance_questions; only assessment_instances.points is
      // wrong. A correct regrade must recompute it back from the graded work.
      // (score_perc is set to 0 so the no-decrease floor does not mask the
      // recompute -- a regrade legitimately never decreases an existing score.)
      await sqldb.execute(sql.set_assessment_instance_points, {
        assessment_instance_id: aiId,
        points: 999,
        score_perc: 0,
      });
      assert.equal((await readPoints(aiId))?.points, 999);

      // Instructor regrade (the production path: regradeAllAssessmentInstances ->
      // regradeSingleAssessmentInstance -> updateAssessmentInstanceGrade with NO
      // explicit credit). With the trailing no-credit submission, the buggy gate
      // resolved credit = 0 and returned early, leaving points = 999 (a silent
      // no-op that withholds the legitimately-earned correction).
      const jobSequenceId = await regradeAllAssessmentInstances(
        String(context.hwId),
        '1', // user_id (instructor)
        '1', // authn_user_id
      );
      await helperServer.waitForJobSequenceSuccess(jobSequenceId);

      const afterRegrade = await readPoints(aiId);
      assert.equal(
        afterRegrade?.points,
        5,
        'regrade must recompute the earned for-credit points (not no-op to the stale 999)',
      );
      assert.equal(
        afterRegrade?.score_perc,
        50,
        'regrade must recompute the earned for-credit score (not no-op to the stale 0)',
      );
    },
  );

  test.sequential(
    'multi-question regrade must exclude a no-credit question from the instance total (issue #137-A follow-up)',
    async () => {
      // Red-team finding #137-A follow-up. The #137-A fix resolves the omitted
      // regrade credit from the instance-wide highest submission credit
      // (max(s.credit)). In a MULTI-question instance where different questions
      // were answered under different credits, that one instance-wide max
      // un-gates the WHOLE total -- including a no-credit question's points.
      //
      // Scenario (two 10-point questions, instance max 20):
      //   1. Q1 answered 100% under credit:100  -> Q1.points = 10.
      //   2. Q2 answered 100% under credit:0     -> Q2.points = 10, but the
      //      submission path gates the instance total at 10 (correct per #958).
      //   3. Instructor regrade resolves max(s.credit) = max(100, 0) = 100, so
      //      the instance-wide gate does NOT fire and the total recomputes to
      //      min(20, 10 + 10) = 20 -- folding the no-credit Q2's points in.
      // The regrade must instead count only the questions whose own work was
      // earned under non-zero credit, leaving the total at 10.

      // Phase 1: answer Q1 (HW22.1) perfectly for credit.
      const creditHeaders = await actAs('student-multi@example.com', CREDIT_DATE);
      const aiId = await gradeQuestionFromPage(context.hwMultiUrl, 'HW22.1.', creditHeaders, 100);
      // Instance total = Q1's 10 points; max_points = 20, so score_perc = 50%
      // (capped by credit 100, which is a no-op here).
      assert.equal((await readPoints(aiId))?.points, 10);

      // Phase 2: answer Q2 (HW22.2) perfectly during the no-credit window. The
      // submission path must not change the recorded instance total (issue #958),
      // even though Q2 itself records 10 question points (the question-grade path
      // is credit-blind).
      const noCreditHeaders = await actAs('student-multi@example.com', NO_CREDIT_DATE);
      await gradeQuestionFromPage(
        `${context.courseInstanceBaseUrl}/assessment_instance/${aiId}`,
        'HW22.2.',
        noCreditHeaders,
        100,
      );
      assert.equal(
        (await readPoints(aiId))?.points,
        10,
        'no-credit submission on a second question must not change the instance total (#958)',
      );
      // Both questions have their own 10 earned points recorded (the question
      // grade path is credit-blind) -- the credit difference lives only in the
      // submissions, so the instance-total recompute is the only place to honor it.
      const iqPoints = await readQuestionPoints(aiId);
      assert.deepEqual(
        iqPoints.map((q) => q.points),
        [10, 10],
        'both questions record their earned points regardless of credit',
      );

      // Phase 3: instructor regrade (production path: regradeAllAssessmentInstances
      // -> regradeSingleAssessmentInstance -> updateAssessmentInstanceGrade with NO
      // explicit credit -> resolves credit per instance). The buggy instance-wide
      // max(credit) = 100 un-gates the whole total and folds Q2's no-credit points
      // in (-> 20). The fix counts only the for-credit question (-> 10).
      const jobSequenceId = await regradeAllAssessmentInstances(
        String(context.hwMultiId),
        '1', // user_id (instructor)
        '1', // authn_user_id
      );
      await helperServer.waitForJobSequenceSuccess(jobSequenceId);

      const afterRegrade = await readPoints(aiId);
      assert.equal(
        afterRegrade?.points,
        10,
        'regrade must exclude the no-credit question (Q2) from the instance total (10, not 20)',
      );
      // score_perc: 10/20 = 50%, capped by the resolved for-credit rule and held
      // by the no-decrease floor -- unchanged from the for-credit phase.
      assert.equal(afterRegrade?.score_perc, 50);
    },
  );

  test.sequential(
    'multi-question regrade preserves a for-credit question that has a later no-credit submission (#137-A combined)',
    async () => {
      // Combined guard: the single-question #137-A protection (a trailing
      // no-credit submission must not suppress a for-credit question's regrade)
      // must keep holding in the multi-question instance, alongside the new
      // per-question exclusion above. Q1 is earned for credit AND later gets a
      // no-credit submission; Q2 is answered only under no-credit. After a
      // regrade, Q1's for-credit points are kept and Q2's no-credit points are
      // excluded -> total = 10 (Q1 only), never 0 (the #137-A regression) and
      // never 20 (the multi-question over-credit).

      // Phase 1: Q1 perfect for credit.
      const creditHeaders = await actAs('student-multi2@example.com', CREDIT_DATE);
      const aiId = await gradeQuestionFromPage(context.hwMultiUrl, 'HW22.1.', creditHeaders, 100);
      assert.equal((await readPoints(aiId))?.points, 10);

      // Phase 2: in the no-credit window, make a trailing no-credit submission on
      // Q1 (0%, so it does not change Q1's earned points) AND answer Q2 at 100%.
      const noCreditHeaders = await actAs('student-multi2@example.com', NO_CREDIT_DATE);
      await gradeQuestionFromPage(
        `${context.courseInstanceBaseUrl}/assessment_instance/${aiId}`,
        'HW22.1.',
        noCreditHeaders,
        0,
      );
      await gradeQuestionFromPage(
        `${context.courseInstanceBaseUrl}/assessment_instance/${aiId}`,
        'HW22.2.',
        noCreditHeaders,
        100,
      );
      // The instance total is still Q1's 10 for-credit points.
      assert.equal((await readPoints(aiId))?.points, 10);

      // Make the recorded instance points stale so the regrade has to recompute.
      await sqldb.execute(sql.set_assessment_instance_points, {
        assessment_instance_id: aiId,
        points: 999,
        score_perc: 0,
      });

      const jobSequenceId = await regradeAllAssessmentInstances(
        String(context.hwMultiId),
        '1',
        '1',
      );
      await helperServer.waitForJobSequenceSuccess(jobSequenceId);

      const afterRegrade = await readPoints(aiId);
      assert.equal(
        afterRegrade?.points,
        10,
        'regrade keeps Q1 (for credit) and excludes Q2 (no credit): 10, not 0 and not 20',
      );
      assert.equal(afterRegrade?.score_perc, 50);
    },
  );

  test.sequential(
    'multi-question regrade must keep a no-credit question\'s instructor-awarded MANUAL points',
    async () => {
      // A no-credit question can still legitimately earn points -- not from its
      // own submission credit, but from a deliberate instructor MANUAL grade.
      // Manual grading writes instance_questions.manual_points/points but never
      // touches a submission's credit, so a question answered in a no-credit
      // window keeps max(submission.credit) = 0 even after the instructor awards
      // manual points. A per-question exclusion keyed only on submission credit
      // therefore wrongly drops those manual points on a regrade -- silently
      // erasing instructor work. The regrade must exclude only a question's
      // *auto* points by credit; manual awards are always counted.
      //
      // Scenario (Q1 auto 10pts, Q2 manual 10pts, instance max 20):
      //   1. Q1 answered 100% under credit:100  -> Q1.points = 10 (auto).
      //   2. Q2 (manual) answered under credit:0 -> a submission with credit = 0;
      //      no points yet (manual question, ungraded).
      //   3. Instructor manually grades Q2 = 7 points (credit:100 staff action)
      //      -> Q2.manual_points = 7, instance total = 10 + 7 = 17. Q2's
      //      submission stays credit = 0.
      //   4. Instructor regrade (credit omitted): must keep Q2's 7 manual points
      //      -> instance total stays 17 (NOT 10, which would erase the manual
      //      grade just because Q2's submission counts under no credit).

      // Phase 1: Q1 auto, for credit.
      const creditHeaders = await actAs('student-manual@example.com', CREDIT_DATE);
      const aiId = await gradeQuestionFromPage(context.hwManualUrl, 'HW23.1.', creditHeaders, 100);
      assert.equal((await readPoints(aiId))?.points, 10);

      // Phase 2: Q2 (manual question) answered in the no-credit window. Saving a
      // submission records credit = 0 for it; no points yet.
      const noCreditHeaders = await actAs('student-manual@example.com', NO_CREDIT_DATE);
      await submitQuestionFromPage(
        `${context.courseInstanceBaseUrl}/assessment_instance/${aiId}`,
        'HW23.2.',
        noCreditHeaders,
      );
      // The no-credit submission alone must not change the instance total (#958);
      // the manual question has earned nothing yet.
      assert.equal((await readPoints(aiId))?.points, 10);

      // Phase 3: instructor manually grades Q2 = 7 points. This is the production
      // manual-grade path (updateInstanceQuestionScore -> updateAssessmentInstanceGrade
      // with credit:100), so the instance total becomes 10 + 7 = 17.
      const breakdownBefore = await readQuestionBreakdown(aiId);
      const q2Id = breakdownBefore[1].id; // ordered by aq.number; Q2 is the manual one
      const assessment = await selectAssessmentById(String(context.hwManualId));
      await updateInstanceQuestionScore({
        assessment,
        instance_question_id: q2Id,
        submission_id: null,
        check_modified_at: null,
        score: { manual_points: 7 },
        authn_user_id: '1',
      });
      assert.equal(
        (await readPoints(aiId))?.points,
        17,
        'manual grade must record the instructor-awarded points (10 auto + 7 manual)',
      );
      const afterManual = await readQuestionBreakdown(aiId);
      assert.equal(afterManual[1].manual_points, 7, 'Q2 records 7 manual points');
      assert.equal(afterManual[1].auto_points ?? 0, 0, 'Q2 (manual question) has no auto points');

      // Make the recorded instance points stale so the regrade must recompute.
      await sqldb.execute(sql.set_assessment_instance_points, {
        assessment_instance_id: aiId,
        points: 999,
        score_perc: 0,
      });

      // Phase 4: instructor regrade (credit omitted -> excludeNoCreditQuestions).
      // Q2's submission counts under no credit, but its 7 manual points were
      // awarded by an instructor and must be kept. The regrade must leave the
      // instance total at 17 -- Q1's 10 auto (for credit) plus Q2's 7 manual.
      const jobSequenceId = await regradeAllAssessmentInstances(
        String(context.hwManualId),
        '1',
        '1',
      );
      await helperServer.waitForJobSequenceSuccess(jobSequenceId);

      const afterRegrade = await readPoints(aiId);
      assert.equal(
        afterRegrade?.points,
        17,
        'regrade must keep Q2\'s instructor manual points: 17, not 10 (erased)',
      );
      const afterRegradeBreakdown = await readQuestionBreakdown(aiId);
      assert.equal(
        afterRegradeBreakdown[1].manual_points,
        7,
        'Q2 manual points survive the regrade',
      );
      // score_perc: 17/20 = 85%.
      assert.equal(afterRegrade?.score_perc, 85);
    },
  );
});
