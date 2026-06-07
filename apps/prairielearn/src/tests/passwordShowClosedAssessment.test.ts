import { afterAll, assert, beforeAll, describe, test } from 'vitest';

import { generateSignedToken } from '@prairielearn/signed-token';

import { dangerousFullSystemAuthz } from '../lib/authz-data-lib.js';
import { config } from '../lib/config.js';
import { selectAssessmentByTid } from '../models/assessment.js';
import { selectCourseInstanceById } from '../models/course-instances.js';
import { ensureUncheckedEnrollment } from '../models/enrollment.js';
import { selectUserByUid } from '../models/user.js';

import * as helperClient from './helperClient.js';
import * as helperServer from './helperServer.js';

// Regression test for issue #2491:
//   "showClosedAssessment has no effect on password protected assessments"
// https://github.com/PrairieLearn/PrairieLearn/issues/2491
//
// A password-protected, time-limited exam configured with
// `showClosedAssessment: false` must still honor that flag once the instance is
// closed (e.g. the time limit expires): the student should see the standard
// "assessment closed" page, NOT the password prompt and NOT the assessment
// content. Historically (when `showClosedAssessment` was first added) the
// password gate ran *before* the closed-assessment check, so a closed,
// password-protected assessment never consulted `showClosedAssessment` at all.

describe(
  'Password-protected exam with showClosedAssessment: false (issue #2491)',
  { timeout: 60_000 },
  function () {
    const context: Record<string, any> = { siteUrl: `http://localhost:${config.serverPort}` };
    context.baseUrl = `${context.siteUrl}/pl`;
    context.courseInstanceBaseUrl = `${context.baseUrl}/course_instance/1`;

    // The signed password cookie the browser would carry after the student
    // entered the assessment password ("diamond") on the /pl/password page.
    const pwCookie = generateSignedToken(
      { password: 'diamond', maxAge: 1000 * 60 * 60 * 12 },
      config.secretKey,
    );

    // Student is "inside" the time window and has supplied the password.
    const headers = {
      cookie: `pl_test_user=test_student; pl_test_date=2000-01-19T00:00:01; pl2_assessmentpw=${pwCookie}`,
    };
    // Same student/password, but the clock has advanced past the time limit.
    const headersTimeLimit = {
      cookie: `pl_test_user=test_student; pl_test_date=2000-01-19T12:00:01; pl2_assessmentpw=${pwCookie}`,
    };

    beforeAll(async function () {
      await helperServer.before()();
      const { id: assessmentId } = await selectAssessmentByTid({
        course_instance_id: '1',
        tid: 'exam6-passwordShowClosed',
      });
      context.assessmentId = assessmentId;
      context.assessmentUrl = `${context.courseInstanceBaseUrl}/assessment/${context.assessmentId}/`;
    });

    afterAll(helperServer.after);

    test.sequential('visit home page', async () => {
      const response = await helperClient.fetchCheerio(context.baseUrl, { headers });
      assert.isTrue(response.ok);
    });

    test.sequential('enroll the test student user in the course', async () => {
      const user = await selectUserByUid('student@example.com');
      const courseInstance = await selectCourseInstanceById('1');
      await ensureUncheckedEnrollment({
        userId: user.id,
        courseInstance,
        requiredRole: ['System'],
        authzData: dangerousFullSystemAuthz(),
        actionDetail: 'implicit_joined',
      });
    });

    test.sequential('start the password-protected exam', async () => {
      // Load the start page (password already supplied via cookie).
      let response = await helperClient.fetchCheerio(context.assessmentUrl, { headers });
      assert.isTrue(response.ok);
      assert.equal(response.$('#start-assessment').text().trim(), 'Start assessment');
      helperClient.extractAndSaveCSRFToken(context, response.$, 'form');

      // Start it.
      response = await helperClient.fetchCheerio(context.assessmentUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'new_instance',
          __csrf_token: context.__csrf_token,
        }),
        headers,
      });
      assert.isTrue(response.ok);
      assert.include(response.url, '/assessment_instance/');
      context.assessmentInstanceUrl = response.url;
      const questionUrl = response.$('a:contains("Question 1")').attr('href');
      context.questionUrl = `${context.siteUrl}${questionUrl}`;
      context.__csrf_token = response.$('span[id=test_csrf_token]').text();
    });

    test.sequential('close the instance via time-limit expiration', async () => {
      const response = await helperClient.fetchCheerio(context.assessmentInstanceUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'timeLimitFinish',
          __csrf_token: context.__csrf_token,
        }),
        headers: headersTimeLimit,
      });
      // Once closed, showClosedAssessment: false must take effect -> 403 closed page.
      assert.equal(response.status, 403);
      assert.equal(response.url, context.assessmentInstanceUrl + '?timeLimitExpired=true');
      const msg = response.$('[data-testid="assessment-closed-message"]');
      assert.lengthOf(msg, 1);
      assert.match(msg.text(), /Assessment .* is no longer available/);
    });

    test.sequential(
      'accessing the closed, password-protected instance honors showClosedAssessment',
      async () => {
        const response = await helperClient.fetchCheerio(context.assessmentInstanceUrl, {
          headers,
        });
        // The flag is honored: closed page, not a password prompt, not content.
        assert.equal(response.status, 403);
        assert.lengthOf(response.$('[data-testid="assessment-closed-message"]'), 1);
        // Must NOT be redirected to the password page...
        assert.notInclude(response.url, '/pl/password');
        assert.lengthOf(response.$('input[name="password"]'), 0);
        // ...and must NOT reveal the assessment content.
        assert.lengthOf(response.$('a:contains("Question 1")'), 0);
      },
    );

    test.sequential(
      'accessing a question in the closed instance also honors showClosedAssessment',
      async () => {
        const response = await helperClient.fetchCheerio(context.questionUrl, { headers });
        assert.equal(response.status, 403);
        assert.lengthOf(response.$('[data-testid="assessment-closed-message"]'), 1);
        assert.notInclude(response.url, '/pl/password');
      },
    );
  },
);
