import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { dangerousFullSystemAuthz } from '../../lib/authz-data-lib.js';
import { selectAssessmentByTid } from '../../models/assessment.js';
import { ensureUncheckedEnrollment } from '../../models/enrollment.js';
import { getOrCreateUser } from '../utils/auth.js';

import { expect, test } from './fixtures.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const STUDENT = {
  uid: 'e2e_rubric_disable_student@test.com',
  name: 'E2E Rubric Disable Student',
  uin: 'E2E101',
};

// Optional screenshot capture for harness before/after evidence. Set SHOT_DIR to
// a directory and the empty-rubric-state screenshot is written there. Off in CI.
const SHOT_DIR = process.env.SHOT_DIR;
const SHOT_NAME = process.env.SHOT_NAME ?? 'empty-rubric-state';

let assessmentId: string;

// The rubric editor lives in a Bootstrap collapsible card whose open/closed state
// is driven by Bootstrap JS (independent of React re-renders). Toggling blindly is
// racy, so settle any in-flight transition, then open only if actually closed.
async function ensureRubricEditorOpen(page: Page): Promise<void> {
  const body = page.locator('#rubric-setting');
  await expect(async () => {
    // Wait out any in-progress transition.
    await expect(body).not.toHaveClass(/collapsing/);
    if (!(await body.evaluate((el) => el.classList.contains('show')))) {
      await page.locator('[aria-label="Toggle rubric settings"]').click();
    }
    await expect(body).toHaveClass(/(^|\s)show(\s|$)/, { timeout: 2000 });
  }).toPass({ timeout: 15000 });
}

async function addRubricItem(page: Page, rubricTable: Locator): Promise<Locator> {
  const rubricRows = rubricTable
    .locator('tr')
    .filter({ has: page.getByRole('spinbutton', { name: 'Points' }) });
  const previousRowCount = await rubricRows.count();

  await expect(async () => {
    if ((await rubricRows.count()) === previousRowCount + 1) return;
    await page.getByRole('button', { name: 'Add item' }).click();
    await expect(rubricRows).toHaveCount(previousRowCount + 1, { timeout: 2000 });
  }).toPass({ timeout: 10000 });

  return rubricRows.nth(previousRowCount);
}

test.describe('Manual grading rubric empty-state "disable" affordance', () => {
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

    const assessment = await selectAssessmentByTid({
      tid: 'hw9-internalExternalManual',
      course_instance_id: courseInstance.id,
    });
    assessmentId = assessment.id;
  });

  test('empty-state offers an honest, confirmation-gated removal — not a misleading "Disable rubric"', async ({
    page,
    baseURL,
    courseInstance,
  }) => {
    // --- Seed: student submits to a manually graded question. ---
    await page.context().addCookies([
      { name: 'pl2_requested_uid', value: STUDENT.uid, url: baseURL },
      { name: 'pl2_requested_data_changed', value: 'true', url: baseURL },
    ]);

    await page.goto(`/pl/course_instance/${courseInstance.id}/assessments`);
    await page.getByRole('link', { name: 'Homework for Internal, External, Manual' }).click();
    await page
      .getByRole('link', { name: 'Manual Grading: Fibonacci function, file upload' })
      .click();

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

    await page.reload();
    await expect(page.locator('[data-testid="submission-status"] .badge').first()).toContainText(
      'waiting for grading',
    );
    await page.context().clearCookies();

    // --- As instructor: create a rubric with one item and grade. ---
    const iqId = await sqldb.queryScalar(
      sql.select_instance_question_for_manual_grading,
      { assessment_id: assessmentId, qid: 'manualGrade/codeUpload' },
      IdSchema,
    );

    const manualGradingIQUrl = `/pl/course_instance/${courseInstance.id}/instructor/assessment/${assessmentId}/manual_grading/instance_question/${iqId}`;
    await page.goto(manualGradingIQUrl);

    await ensureRubricEditorOpen(page);

    const rubricTable = page.locator('#rubric-editor table[aria-label="Rubric items"] tbody');
    const firstRow = await addRubricItem(page, rubricTable);
    await firstRow.getByRole('spinbutton', { name: 'Points' }).fill('6');
    await firstRow
      .getByRole('textbox', { name: 'Description' })
      .fill('Full credit for correct solution');

    await page.locator('#rubric-setting').getByRole('button', { name: 'Save' }).click();
    await expect(
      page.locator('.js-main-grading-panel .js-selectable-rubric-item').first(),
    ).toBeVisible({ timeout: 10000 });

    // --- Reopen the editor and delete the only rubric row to reach the empty state. ---
    // (A saved rubric still exists -> wasUsingRubric is true; the editor table is now
    // empty -> the empty-state row renders the removal affordance.)
    await ensureRubricEditorOpen(page);

    const rubricRows = rubricTable
      .locator('tr')
      .filter({ has: page.getByRole('spinbutton', { name: 'Points' }) });
    await expect(rubricRows).toHaveCount(1);
    await rubricTable.getByRole('button', { name: 'Delete' }).first().click();
    await expect(rubricRows).toHaveCount(0);

    // Ensure the editor is open and settled, then confirm the empty-state row is visible.
    await ensureRubricEditorOpen(page);
    const emptyStateRow = rubricTable.getByText('This question does not have any rubric items');
    await expect(emptyStateRow).toBeVisible();

    if (SHOT_DIR) {
      // Full-page screenshot (captures the affordance regardless of scroll position).
      await emptyStateRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_NAME}.png`), fullPage: true });
    }

    // --- Assertions (the regression guard) ---
    // The empty-state removal affordance must NOT use the misleading reversible-sounding
    // "Disable rubric" verb, and must route through the same confirmation as the sibling
    // footer "Delete rubric" control (rather than soft-deleting immediately).
    await expect(
      emptyStateRow,
      'empty-state should not advertise a reversible-sounding "Disable rubric"',
    ).not.toContainText('Disable rubric');

    const removalLink = page
      .locator('#rubric-editor tbody')
      .getByRole('button', { name: /Delete rubric/i });
    await expect(
      removalLink,
      'empty-state should offer an honest "Delete rubric" action',
    ).toHaveCount(1);

    // Clicking it must open the confirmation dialog, not immediately remove the rubric.
    await removalLink.click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog, 'a confirmation must precede removal').toBeVisible();
    await expect(confirmDialog).toContainText('This action cannot be undone');

    if (SHOT_DIR) {
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(SHOT_DIR, `${SHOT_NAME}-confirm.png`),
        fullPage: false,
      });
    }

    // Cancel keeps the rubric attached (no destructive call fired).
    await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmDialog).toBeHidden();
  });
});
