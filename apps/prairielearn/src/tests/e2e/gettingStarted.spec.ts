import { selectCourseById, updateCourseShowGettingStarted } from '../../models/course.js';

import { expect, test } from './fixtures.js';

test.describe('Getting started checklist', () => {
  test('auto-dismisses once every required task is complete', async ({ page, courseInstance }) => {
    const courseId = courseInstance.course_id;

    // The test course already has questions, a course instance, and assessments
    // (the "add course staff" task is optional), so every required task is complete.
    // Enable the checklist on this finished course.
    await updateCourseShowGettingStarted({ course_id: courseId, show_getting_started: true });

    await page.goto(`/pl/course/${courseId}/course_admin/getting_started`);

    // Opening a completed checklist auto-dismisses it: redirected to instances, a
    // success flash is shown, and the "Getting Started" nav tab is gone.
    await expect(page).toHaveURL(/\/course_admin\/instances/);
    await expect(page.getByText(/completed the getting started checklist/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Getting Started' })).toHaveCount(0);

    // The flag is persisted off.
    const course = await selectCourseById(courseId);
    expect(course.show_getting_started).toBe(false);
  });
});
