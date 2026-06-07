import type { Page } from '@playwright/test';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { dangerousFullSystemAuthz } from '../../lib/authz-data-lib.js';
import { selectAssessmentByTid } from '../../models/assessment.js';
import { ensureUncheckedEnrollment } from '../../models/enrollment.js';
import {
  insertCourseInstancePermissions,
  insertCoursePermissionsByUserUid,
} from '../../models/course-permissions.js';
import { getOrCreateUser } from '../utils/auth.js';

import { expect, test } from './fixtures.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const STUDENT = { uid: 'e2e_focus_student@test.com', name: 'E2E Focus Student', uin: 'E2EF01' };
// A staff member with view-only (no edit) permission on the course instance.
const VIEWER = { uid: 'e2e_focus_viewer@test.com', name: 'E2E Focus Viewer', uin: 'E2EF02' };

let assessmentId: string;

/**
 * Submit a file to the manual-graded `manualGrade/codeUpload` question as the
 * student, leaving it `waiting for grading`. Returns the manual-grading
 * instance-question URL an instructor would open.
 */
async function submitAndGetGradingUrl(
  page: Page,
  baseURL: string,
  courseInstanceId: string,
): Promise<string> {
  await page.context().addCookies([
    { name: 'pl2_requested_uid', value: STUDENT.uid, url: baseURL },
    { name: 'pl2_requested_data_changed', value: 'true', url: baseURL },
  ]);

  await page.goto(`/pl/course_instance/${courseInstanceId}/assessments`);
  await page.getByRole('link', { name: 'Homework for Internal, External, Manual' }).click();
  await page
    .getByRole('link', { name: 'Manual Grading: Fibonacci function, file upload' })
    .click();

  // Submit file via direct POST to bypass the Dropzone UI.
  const csrfToken = await page.locator('form input[name="__csrf_token"]').first().inputValue();
  const variantId = await page.locator('form input[name="__variant_id"]').first().inputValue();
  const fileUploadName = await page
    .locator('input[name^="_file_upload"]')
    .first()
    .getAttribute('name');
  await page.request.post(page.url(), {
    form: {
      __csrf_token: csrfToken,
      __variant_id: variantId,
      __action: 'save',
      [fileUploadName!]: JSON.stringify([
        { name: 'fib.py', contents: Buffer.from('def fib(n): return n').toString('base64') },
      ]),
    },
  });

  await page.context().clearCookies();

  const iqId = await sqldb.queryScalar(
    sql.select_instance_question_for_manual_grading,
    { assessment_id: assessmentId, qid: 'manualGrade/codeUpload' },
    IdSchema,
  );

  return `/pl/course_instance/${courseInstanceId}/instructor/assessment/${assessmentId}/manual_grading/instance_question/${iqId}`;
}

test.describe('Manual grading: focus the score input on page load', () => {
  test.setTimeout(60000);

  test.beforeAll(async ({ courseInstance }) => {
    const student = await getOrCreateUser(STUDENT);
    await ensureUncheckedEnrollment({
      userId: student.id,
      courseInstance,
      authzData: dangerousFullSystemAuthz(),
      requiredRole: ['System'],
      actionDetail: 'implicit_joined',
    });

    // A staff member with VIEW-ONLY (Student Data Viewer) permission — the
    // grading inputs render `disabled` for this user.
    const viewer = await getOrCreateUser(VIEWER);
    await insertCoursePermissionsByUserUid({
      course_id: courseInstance.course_id,
      uid: VIEWER.uid,
      course_role: 'None',
      authn_user_id: '1',
    });
    await insertCourseInstancePermissions({
      course_id: courseInstance.course_id,
      user_id: viewer.id,
      course_instance_id: courseInstance.id,
      course_instance_role: 'Student Data Viewer',
      authn_user_id: '1',
    });

    const assessment = await selectAssessmentByTid({
      tid: 'hw9-internalExternalManual',
      course_instance_id: courseInstance.id,
    });
    assessmentId = assessment.id;
  });

  test('focuses the visible, enabled manual score input on load', async ({
    page,
    baseURL,
    courseInstance,
  }) => {
    const gradingUrl = await submitAndGetGradingUrl(page, baseURL!, courseInstance.id);

    // --- Positive: on initial load the manual points input is focused. ---
    await page.goto(gradingUrl);
    const pointsInput = page.locator('.js-main-grading-panel input[name="score_manual_points"]');
    await expect(pointsInput).toBeVisible();
    await expect(pointsInput).toBeFocused();

    // --- Negative: percentage toggle on → the PERCENTAGE input is focused, not points. ---
    await page.evaluate(() => {
      window.localStorage.manual_grading_score_use = 'percentage';
    });
    await page.goto(gradingUrl);
    const percentInput = page.locator('.js-main-grading-panel input[name="score_manual_percent"]');
    await expect(percentInput).toBeVisible();
    await expect(percentInput).toBeFocused();
    await expect(pointsInput).not.toBeFocused();
    // Restore the default (points) toggle for subsequent loads.
    await page.evaluate(() => {
      window.localStorage.manual_grading_score_use = 'points';
    });

    // --- Negative: an AI-grading reload must NOT steal focus. ---
    // The AI-reload path (reloadGradingPanel.ts) calls window.resetInstructorGradingPanel().
    // The focus call lives in the DOM-ready handler, NOT in that function, so re-running
    // it must leave focus where the grader put it.
    await page.goto(gradingUrl);
    await expect(pointsInput).toBeFocused();
    // Move focus elsewhere (as a grader reading the AI explanation / feedback would),
    // then simulate the reset the AI-reload path triggers.
    await page.locator('form[name="manual-grading-form"] textarea').first().focus();
    await expect(page.locator('form[name="manual-grading-form"] textarea').first()).toBeFocused();
    await page.evaluate(() =>
      (window as unknown as { resetInstructorGradingPanel: () => void }).resetInstructorGradingPanel(),
    );
    // Focus must NOT have jumped back to the score input.
    await expect(pointsInput).not.toBeFocused();
    await expect(page.locator('form[name="manual-grading-form"] textarea').first()).toBeFocused();
  });

  test('does not focus the score input when a rubric drives the score', async ({
    page,
    baseURL,
    courseInstance,
  }) => {
    const gradingUrl = await submitAndGetGradingUrl(page, baseURL!, courseInstance.id);

    // Set up a rubric so the manual points input is hidden (the score comes from the rubric).
    await page.goto(gradingUrl);
    await page.locator('[aria-label="Toggle rubric settings"]').click();
    await expect(page.locator('#rubric-setting')).toBeVisible();

    const rubricTable = page.locator('#rubric-editor table[aria-label="Rubric items"] tbody');
    const rubricRows = rubricTable
      .locator('tr')
      .filter({ has: page.getByRole('spinbutton', { name: 'Points' }) });
    await expect(async () => {
      if ((await rubricRows.count()) === 1) return;
      await page.getByRole('button', { name: 'Add item' }).click();
      await expect(rubricRows).toHaveCount(1, { timeout: 2000 });
    }).toPass({ timeout: 10000 });
    await rubricRows.first().getByRole('spinbutton', { name: 'Points' }).fill('6');
    await rubricRows
      .first()
      .getByRole('textbox', { name: 'Description' })
      .fill('Full credit for correct solution');
    await page.locator('#rubric-setting').getByRole('button', { name: 'Save' }).click();
    await expect(
      page.locator('.js-main-grading-panel .js-selectable-rubric-item').first(),
    ).toBeVisible({ timeout: 10000 });

    // Reload the page: with a rubric active, the manual points input is hidden (d-none),
    // so nothing should be focused on it.
    await page.goto(gradingUrl);
    const pointsInput = page.locator('.js-main-grading-panel input[name="score_manual_points"]');
    await expect(pointsInput).toBeHidden();
    await expect(pointsInput).not.toBeFocused();
  });

  test('does not focus a disabled score input for a view-only grader', async ({
    page,
    baseURL,
    courseInstance,
  }) => {
    const gradingUrl = await submitAndGetGradingUrl(page, baseURL!, courseInstance.id);

    // Emulate the view-only (Student Data Viewer) staff member.
    await page.context().addCookies([
      { name: 'pl2_requested_uid', value: VIEWER.uid, url: baseURL! },
      { name: 'pl2_requested_data_changed', value: 'true', url: baseURL! },
    ]);

    await page.goto(gradingUrl);
    const pointsInput = page.locator('.js-main-grading-panel input[name="score_manual_points"]');
    await expect(pointsInput).toBeAttached();
    // The input renders disabled for a view-only grader; focus must skip it
    // (the `:not(:disabled)` gate), so the cursor never lands in the field.
    await expect(pointsInput).toBeDisabled();
    await expect(pointsInput).not.toBeFocused();
    // Nothing in the grading panel should have been auto-focused.
    const activeName = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute('name') ?? null,
    );
    expect(activeName).not.toBe('score_manual_points');
    expect(activeName).not.toBe('score_manual_percent');
  });
});
