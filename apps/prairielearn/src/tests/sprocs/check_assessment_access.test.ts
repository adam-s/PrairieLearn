import { afterAll, assert, beforeAll, describe, it } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { type EnumMode } from '../../lib/db-types.js';
import * as helperDb from '../helperDb.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const CheckAssessmentAccessResultSchema = z.object({
  authorized: z.boolean(),
  show_closed_assessment: z.boolean(),
  show_closed_assessment_score: z.boolean(),
});

async function checkAssessmentAccessResult(params: {
  assessment_id: string;
  authz_mode: EnumMode;
  course_role: string;
  course_instance_role: string;
  user_id: string;
  uid: string;
  date: string;
  display_timezone: string;
}): Promise<z.infer<typeof CheckAssessmentAccessResultSchema>> {
  return await sqldb.callRow(
    'check_assessment_access',
    [
      params.assessment_id,
      params.authz_mode,
      params.course_role,
      params.course_instance_role,
      params.user_id,
      params.uid,
      params.date,
      params.display_timezone,
    ],
    CheckAssessmentAccessResultSchema,
  );
}

async function checkAssessmentAccess(params: {
  assessment_id: string;
  authz_mode: EnumMode;
  course_role: string;
  course_instance_role: string;
  user_id: string;
  uid: string;
  date: string;
  display_timezone: string;
}): Promise<boolean> {
  const result = await checkAssessmentAccessResult(params);
  return result.authorized;
}

describe('sproc check_assessment_access* tests', function () {
  beforeAll(helperDb.before);
  afterAll(helperDb.after);

  beforeAll(async () => {
    await sqldb.execute(sql.setup_caa_scheduler_tests);
  });

  describe('without PrairieTest', () => {
    it('should allow access when mode, uid, start_date, and end_date matches', async () => {
      const authorized = await checkAssessmentAccess({
        assessment_id: '50',
        authz_mode: 'Public',
        course_role: 'None',
        course_instance_role: 'None',
        user_id: '1000',
        uid: 'valid@example.com',
        date: '2010-07-07 06:06:06-00',
        display_timezone: 'America/Chicago',
      });
      assert.isTrue(authorized);
    });

    it('should not allow access in Exam mode without an exam_uuid', async () => {
      const authorized = await checkAssessmentAccess({
        assessment_id: '10',
        authz_mode: 'Exam',
        course_role: 'None',
        course_instance_role: 'None',
        user_id: '1000',
        uid: 'valid@example.com',
        date: '2010-07-07 06:06:06-00',
        display_timezone: 'America/Chicago',
      });
      assert.isFalse(authorized);
    });

    it('should not allow access when mode does not match', async () => {
      const authorized = await checkAssessmentAccess({
        assessment_id: '50',
        authz_mode: 'Exam',
        course_role: 'None',
        course_instance_role: 'None',
        user_id: '1000',
        uid: 'valid@example.com',
        date: '2010-07-07 06:06:06-00',
        display_timezone: 'America/Chicago',
      });
      assert.isFalse(authorized);
    });

    it('should not allow access when uid not in uids', async () => {
      const authorized = await checkAssessmentAccess({
        assessment_id: '50',
        authz_mode: 'Exam',
        course_role: 'None',
        course_instance_role: 'None',
        user_id: '1000',
        uid: 'invalid@example.com',
        date: '2010-07-07 06:06:06-00',
        display_timezone: 'America/Chicago',
      });
      assert.isFalse(authorized);
    });

    it('should not allow access when attempt date is before start_date', async () => {
      const authorized = await checkAssessmentAccess({
        assessment_id: '50',
        authz_mode: 'Exam',
        course_role: 'None',
        course_instance_role: 'None',
        user_id: '1000',
        uid: 'valid@example.com',
        date: '2008-07-07 06:06:06-00',
        display_timezone: 'America/Chicago',
      });
      assert.isFalse(authorized);
    });

    it('should not allow access when attempt date is after end_date', async () => {
      const authorized = await checkAssessmentAccess({
        assessment_id: '50',
        authz_mode: 'Exam',
        course_role: 'None',
        course_instance_role: 'None',
        user_id: '1000',
        uid: 'valid@example.com',
        date: '2012-07-07 06:06:06-00',
        display_timezone: 'America/Chicago',
      });
      assert.isFalse(authorized);
    });

    it('should not allow access when access rule mode is Public and exam_uuid is present', async () => {
      const authorized = await checkAssessmentAccess({
        assessment_id: '52',
        authz_mode: 'Public',
        course_role: 'None',
        course_instance_role: 'None',
        user_id: '1000',
        uid: 'valid@example.com',
        date: '2010-07-07 06:06:06-00',
        display_timezone: 'America/Chicago',
      });
      assert.isFalse(authorized);
    });
  });

  describe('with PrairieTest', () => {
    describe('without checked-in reservation', () => {
      it('should not allow access to an exam without exam_uuid', async () => {
        const authorized = await checkAssessmentAccess({
          assessment_id: '10',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: '2010-07-07 06:06:06-00',
          display_timezone: 'America/Chicago',
        });
        assert.isFalse(authorized);
      });

      it('should not allow access to an exam with exam_uuid', async () => {
        const authorized = await checkAssessmentAccess({
          assessment_id: '11',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: '2010-07-07 06:06:06-00',
          display_timezone: 'America/Chicago',
        });
        assert.isFalse(authorized);
      });
    });

    describe('with checked-in reservation', () => {
      beforeAll(async () => {
        // Create checked-in reservation for student
        await sqldb.execute(sql.insert_pt_reservation, { exam_id: 1 });
      });
      afterAll(async () => {
        // Delete checked-in reservation for student
        await sqldb.execute(sql.delete_pt_reservation, { exam_id: 1 });
      });

      it('should not allow access to an exam without exam_uuid', async () => {
        const authorized = await checkAssessmentAccess({
          assessment_id: '10',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: '2010-07-07 06:06:06-00',
          display_timezone: 'America/Chicago',
        });
        assert.isFalse(authorized);
      });

      it('should allow access to an exam with a matching exam_uuid', async () => {
        const authorized = await checkAssessmentAccess({
          assessment_id: '11',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: '2010-07-07 06:06:06-00',
          display_timezone: 'America/Chicago',
        });
        assert.isTrue(authorized);
      });

      it('should not allow access to an exam with a not matching exam_uuid', async () => {
        const authorized = await checkAssessmentAccess({
          assessment_id: '12',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: '2010-07-07 06:06:06-00',
          display_timezone: 'America/Chicago',
        });
        assert.isFalse(authorized);
      });

      it('should not allow access in Exam mode when access rule mode is null and exam_uuid is present', async () => {
        const authorized = await checkAssessmentAccess({
          assessment_id: '53',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: '2010-07-07 06:06:06-00',
          display_timezone: 'America/Chicago',
        });
        assert.isFalse(authorized);
      });

      it('should not allow access in Exam mode when access rule has no explicit mode or exam_uuid', async () => {
        const authorized = await checkAssessmentAccess({
          assessment_id: '54',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: '2010-07-07 06:06:06-00',
          display_timezone: 'America/Chicago',
        });
        assert.isFalse(authorized);
      });
    });

    // Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/12579
    //
    // Assessment 60 mirrors the CBTF allowAccess from the issue: a PT-gated Exam
    // rule plus an `active: false` fallback, both with
    // showClosedAssessment(Score): false. After the student finishes the exam and
    // the reservation is ended, PrairieLearn keeps them in Exam mode for a ~30 min
    // grace period. During that window the date is past the reservation's
    // access_end, so:
    //   - the exam_uuid rule fails (no active reservation for the date), and
    //   - the active:false fallback is rejected because Exam mode disallows
    //     non-PrairieTest rules.
    // No rule matches, and access must be denied WITHOUT revealing the closed
    // score. The bug: the "no access rules found" fallback defaulted the
    // show-closed flags to TRUE, leaking the score for the just-finished exam.
    describe('post-reservation Exam-mode grace period (issue #12579)', () => {
      // The reservation seeded for exam 1 runs 2010-07-01..2010-07-31. This date
      // is just past access_end — the student is still treated as Exam mode by
      // the grace period, but no reservation is active.
      const gracePeriodDate = '2010-08-01 00:10:00-00';

      beforeAll(async () => {
        await sqldb.execute(sql.insert_pt_reservation, { exam_id: 1 });
      });
      afterAll(async () => {
        await sqldb.execute(sql.delete_pt_reservation, { exam_id: 1 });
      });

      it('denies access during the grace period', async () => {
        const result = await checkAssessmentAccessResult({
          assessment_id: '60',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: gracePeriodDate,
          display_timezone: 'America/Chicago',
        });
        assert.isFalse(result.authorized);
      });

      it('does not reveal the closed score when no rule matches', async () => {
        const result = await checkAssessmentAccessResult({
          assessment_id: '60',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: gracePeriodDate,
          display_timezone: 'America/Chicago',
        });
        // Every applicable rule sets showClosedAssessmentScore: false, so a denied
        // student must NOT see their score.
        assert.isFalse(result.show_closed_assessment_score);
        assert.isFalse(result.show_closed_assessment);
      });

      it('still reveals the score while a reservation is active (matching exam_uuid)', async () => {
        // Sanity check the neighbor: with an active reservation the exam_uuid rule
        // matches, so the student has normal access and the score is shown (the
        // closed-score flags only gate the post-completion view).
        const result = await checkAssessmentAccessResult({
          assessment_id: '60',
          authz_mode: 'Exam',
          course_role: 'None',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: '2010-07-15 06:06:06-00',
          display_timezone: 'America/Chicago',
        });
        assert.isTrue(result.authorized);
      });

      it('still shows the score to course staff during the grace period', async () => {
        // The staff override must be unaffected: an instructor viewing the same
        // assessment still sees the closed score even when no student rule matches.
        const result = await checkAssessmentAccessResult({
          assessment_id: '60',
          authz_mode: 'Exam',
          course_role: 'Editor',
          course_instance_role: 'None',
          user_id: '1000',
          uid: 'valid@example.com',
          date: gracePeriodDate,
          display_timezone: 'America/Chicago',
        });
        assert.isTrue(result.authorized);
        assert.isTrue(result.show_closed_assessment_score);
      });
    });
  });
});
