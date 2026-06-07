import { HttpStatusError } from '@prairielearn/error';

import { typedAsyncHandler } from '../lib/res-locals.js';

/**
 * Middleware for public course-instance routes that expose course-instance-level
 * content (e.g. the list of a course instance's assessments). Such pages require
 * the course instance itself to be publicly shared.
 *
 * Assessment-level public pages do NOT use this: an assessment can be shared
 * publicly without sharing its entire course instance, and those pages enforce
 * their own per-assessment sharing check.
 *
 * Relies on `authzPublicCourseOrInstance` having already populated
 * `res.locals.course_instance`, so it adds no additional database query.
 *
 * Responds with 404 Not Found if the course instance is not publicly shared.
 */
export default typedAsyncHandler<'public-course-instance'>(async (req, res, next) => {
  if (!res.locals.course_instance.share_source_publicly) {
    throw new HttpStatusError(404, 'Not Found');
  }

  next();
});
