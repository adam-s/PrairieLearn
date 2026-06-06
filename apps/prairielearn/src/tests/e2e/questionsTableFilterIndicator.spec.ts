import { getCourseAdminQuestionsUrl } from '../../lib/client/url.js';

import { expect, test } from './fixtures.js';

// Regression test for PrairieLearn/PrairieLearn#15050: a column filter that stays
// active (especially on a hidden column) was only signalled by a muted count and a
// text-styled circled-x, with no evident indication a filter was applied. The
// shared Tanstack table card now renders an evident "Filtered" indicator
// (data-testid="active-filters-indicator") whenever a column filter is active, and
// nothing when none is.
test.describe('Tanstack table active-filter indicator', () => {
  test('appears only while a column filter is applied, and clears the filter when clicked', async ({
    page,
    courseInstance,
  }) => {
    const url = getCourseAdminQuestionsUrl({ courseInstanceId: courseInstance.id });

    // Unfiltered: the table renders and there is no active-filter indicator.
    await page.goto(url);
    await expect(page.getByLabel('Search by QID, title...')).toBeVisible();
    await expect(page.getByTestId('active-filters-indicator')).toHaveCount(0);

    // Apply a column filter via URL state ("Algebra" is a topic in testCourse).
    await page.goto(`${url}?topic=${encodeURIComponent('Algebra')}`);
    await expect(page.getByLabel('Search by QID, title...')).toBeVisible();

    // The evident indicator is visible while the filter is active.
    const indicator = page.getByTestId('active-filters-indicator');
    await expect(indicator).toBeVisible();

    // Clicking it clears the active filters; the indicator disappears.
    await indicator.click();
    await expect(page.getByTestId('active-filters-indicator')).toHaveCount(0);
  });
});
