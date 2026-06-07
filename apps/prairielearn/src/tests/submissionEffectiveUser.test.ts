import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { afterAll, assert, beforeAll, describe, test } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { config } from '../lib/config.js';
import { insertCoursePermissionsByUserUid } from '../models/course-permissions.js';

import { getOrCreateUser } from './utils/auth.js';
import * as helperServer from './helperServer.js';

/**
 * Issue #4264: a submission made under a different *effective* user was stored
 * with the uid of the *real* (authenticated) user only.
 *
 * This test drives the real submission path: an instructor (the authenticated
 * user) emulates a different staff user via `pl2_requested_uid`, then submits a
 * grade on the instructor question-preview page. We then inspect the persisted
 * submission and its variant.
 *
 * Expected behavior (mirroring `variants`): the submission records its owning
 * (effective) user in `submissions.user_id`, while `submissions.auth_user_id`
 * remains the real (authenticated) user as an audit field.
 */
describe('submission ownership under an effective user (issue #4264)', { timeout: 60_000 }, () => {
  const siteUrl = `http://localhost:${config.serverPort}`;
  const baseUrl = `${siteUrl}/pl`;

  let instructorId: string;
  let effectiveUserId: string;
  let previewUrl: string;

  beforeAll(async () => {
    await helperServer.before()();

    // The real (authenticated) user: a course owner.
    const instructor = await getOrCreateUser({
      uid: 'instructor@example.com',
      name: 'Instructor User',
      uin: '100000000',
      email: 'instructor@example.com',
    });
    instructorId = instructor.id;
    await insertCoursePermissionsByUserUid({
      course_id: '1',
      uid: 'instructor@example.com',
      course_role: 'Owner',
      authn_user_id: '1',
    });

    // The effective (emulated) user: a different staff member with edit access,
    // so the instructor question-preview page is reachable while the effective
    // uid differs from the authenticated uid.
    const effectiveUser = await getOrCreateUser({
      uid: 'staff@example.com',
      name: 'Staff User',
      uin: '200000000',
      email: 'staff@example.com',
    });
    effectiveUserId = effectiveUser.id;
    await insertCoursePermissionsByUserUid({
      course_id: '1',
      uid: 'staff@example.com',
      course_role: 'Editor',
      authn_user_id: '1',
    });

    // Resolve addNumbers' numeric question id from its qid.
    const questionId = await sqldb
      .queryRow(
        'SELECT id FROM questions WHERE qid = $qid AND course_id = 1 AND deleted_at IS NULL',
        { qid: 'addNumbers' },
        z.object({ id: IdSchema }),
      )
      .then((r) => r.id);
    previewUrl = `${baseUrl}/course_instance/1/instructor/question/${questionId}/preview`;
  }, 120_000);

  afterAll(helperServer.after, 60_000);

  test.sequential(
    'submission under effective user records the authenticated (real) user',
    async () => {
      // The instructor (test_instructor => instructor@example.com) authenticates
      // and emulates a different staff user.
      const cookie =
        'pl_test_user=test_instructor; pl2_requested_uid=staff@example.com; pl2_requested_course_role=Editor';

      // Load the preview page to grab a variant + CSRF token.
      const previewRes = await fetch(previewUrl, { headers: { cookie } });
      assert.equal(previewRes.status, 200);
      const $ = cheerio.load(await previewRes.text());
      const csrfToken = $('form input[name="__csrf_token"]').val();
      const variantId = $('form input[name="__variant_id"]').val();
      assert.isString(csrfToken, 'expected a CSRF token on the preview page');
      assert.isString(variantId, 'expected a variant id on the preview page');

      // Read the true answer so we submit a correct (gradable) answer.
      const variant = await sqldb.queryRow(
        'SELECT user_id, authn_user_id, true_answer FROM variants WHERE id = $variant_id',
        { variant_id: variantId },
        z.object({
          user_id: IdSchema.nullable(),
          authn_user_id: IdSchema.nullable(),
          true_answer: z.record(z.any()).nullable(),
        }),
      );
      const trueAnswer = variant.true_answer as { c: number };

      // Submit a grade for the variant under the effective user.
      const postRes = await fetch(previewUrl, {
        method: 'POST',
        headers: { cookie, 'Content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          __variant_id: variantId as string,
          __action: 'grade',
          __csrf_token: csrfToken as string,
          c: String(trueAnswer.c),
        }).toString(),
      });
      assert.equal(postRes.status, 200);

      // Inspect the persisted submission for this variant.
      const submission = await sqldb.queryRow(
        'SELECT id, user_id, auth_user_id FROM submissions WHERE variant_id = $variant_id ORDER BY date DESC LIMIT 1',
        { variant_id: variantId },
        z.object({
          id: IdSchema,
          user_id: IdSchema.nullable(),
          auth_user_id: IdSchema.nullable(),
        }),
      );

      // The variant correctly records both identities.
      assert.equal(
        String(variant.user_id),
        effectiveUserId,
        'variant.user_id should be the effective (staff) user',
      );
      assert.equal(
        String(variant.authn_user_id),
        instructorId,
        'variant.authn_user_id should be the real (instructor) user',
      );

      // `auth_user_id` is an AUDIT field: it must keep recording the real
      // (authenticated) user, consistent with `variants.authn_user_id`,
      // `grading_jobs.auth_user_id`, and course-issue logging. The fix must NOT
      // change this.
      assert.equal(
        String(submission.auth_user_id),
        instructorId,
        'submission.auth_user_id must remain the real (instructor) user (audit field)',
      );

      // EXPECTED-CORRECT behavior (asserts the FIX): the submission must record
      // its OWNING (effective) user in `submissions.user_id`, mirroring
      // `variants.user_id`. On the BASE branch this column does not exist /
      // is not written, so this FAILS — that is the reproduction of issue #4264.
      assert.equal(
        String(submission.user_id),
        effectiveUserId,
        'submission.user_id should be the effective (staff) user, not the real (instructor) user',
      );
    },
    60_000,
  );
});
