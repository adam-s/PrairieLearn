import { Router } from 'express';

import { HttpStatusError } from '@prairielearn/error';
import { flash } from '@prairielearn/flash';

import { getGettingStartedTasks } from '../../lib/getting-started.js';
import { typedAsyncHandler } from '../../lib/res-locals.js';
import { updateCourseShowGettingStarted } from '../../models/course.js';

import { InstructorCourseAdminGettingStarted } from './instructorCourseAdminGettingStarted.html.js';

const router = Router();

router.get(
  '/',
  typedAsyncHandler<'course'>(async (req, res) => {
    const tasks = await getGettingStartedTasks({ course: res.locals.course });

    // Auto-dismiss the checklist once every task is complete, so a fully set-up
    // course is no longer nagged by it (the `show_getting_started` flag gates every
    // entry point, so clearing it hides the checklist everywhere). Only an editor on
    // a real, still-enabled course can change the flag.
    if (
      res.locals.course.show_getting_started &&
      res.locals.authz_data.has_course_permission_edit &&
      !res.locals.course.example_course &&
      tasks.every((task) => task.isComplete || task.optional)
    ) {
      await updateCourseShowGettingStarted({
        course_id: res.locals.course.id,
        show_getting_started: false,
      });
      flash(
        'success',
        'You have completed the getting started checklist, so it has been dismissed. You can restore it from your course settings.',
      );
      res.redirect(`${res.locals.urlPrefix}/course_admin/instances`);
      return;
    }

    res.send(
      InstructorCourseAdminGettingStarted({
        resLocals: res.locals,
        tasks,
      }),
    );
  }),
);

router.post(
  '/',
  typedAsyncHandler<'course'>(async (req, res) => {
    if (!res.locals.authz_data.has_course_permission_edit) {
      throw new HttpStatusError(403, 'Access denied (must be course editor)');
    }

    if (res.locals.course.example_course) {
      throw new HttpStatusError(403, 'Access denied. Cannot make changes to example course.');
    }

    if (req.body.__action === 'dismiss_getting_started') {
      await updateCourseShowGettingStarted({
        course_id: res.locals.course.id,
        show_getting_started: false,
      });
    } else {
      throw new HttpStatusError(400, `unknown __action: ${req.body.__action}`);
    }
    flash(
      'success',
      'The getting started checklist has been dismissed. You can restore it from your course settings.',
    );
    res.redirect(`${res.locals.urlPrefix}/course_admin/instances`);
  }),
);

export default router;
