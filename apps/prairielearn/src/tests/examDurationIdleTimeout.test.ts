import { afterAll, assert, beforeAll, describe, test } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { gradeAssessmentInstance, makeAssessmentInstance } from '../lib/assessment.js';
import type { Assessment } from '../lib/db-types.js';
import { selectAssessmentByTid } from '../models/assessment.js';
import { selectUserByUid } from '../models/user.js';

import * as helperServer from './helperServer.js';

// Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/2364
//
// "Don't use 1-hour idle timeout when computing duration of timed exams."
//
// An assessment instance's `duration` is the sum of the time gaps between
// consecutive activity events (the instance start plus each submission). Gaps
// longer than a 1-hour idle window are dropped so a student who walks away from
// a *Homework* overnight isn't billed for the idle time. That idle window must
// apply to Homework ONLY. For an Exam the entire elapsed window is legitimate
// working time, so a single >1-hour gap (start -> one late submission) must be
// counted in full. If the idle filter were (mis)applied to Exams, that single
// gap would be dropped and the duration would collapse to 0 — the symptom the
// issue reports.
//
// The duration is computed in `close_assessment_instance`
// (apps/prairielearn/src/lib/assessment.sql), exercised here through the real
// `gradeAssessmentInstance({ close: true })` code path.

const sql = sqldb.loadSqlEquiv(import.meta.url);

const GAP_MINUTES = 90; // > 1 hour, so a homework idle filter would drop it
const START = new Date('2024-01-01T10:00:00Z');
const LATE_SUBMISSION = new Date(START.getTime() + GAP_MINUTES * 60 * 1000);

describe('Assessment instance duration vs the 1-hour idle timeout', { timeout: 60_000 }, () => {
  const context: Record<string, any> = {};

  beforeAll(async () => {
    await helperServer.before()();
    const user = await selectUserByUid('dev@example.com');
    context.userId = user.id;
    context.examAssessment = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'exam1-automaticTestSuite',
    });
    context.homeworkAssessment = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'hw1-automaticTestSuite',
    });
  });

  afterAll(helperServer.after);

  // Build an assessment instance that started at START and has exactly one
  // submission GAP_MINUTES later, then close it (which computes `duration`) and
  // return the stored duration in seconds.
  async function durationSecondsWithSingleLateSubmission(assessment: Assessment): Promise<number> {
    const assessment_instance_id = await makeAssessmentInstance({
      assessment,
      user_id: context.userId,
      authn_user_id: context.userId,
      mode: 'Public',
      time_limit_min: null,
      date: START,
      client_fingerprint_id: null,
    });

    // Force the instance start to START (makeAssessmentInstance stamps now()).
    await sqldb.execute(sql.set_assessment_instance_date, {
      assessment_instance_id,
      date: START,
    });

    // Attach a single submission dated GAP_MINUTES after START, on the first of
    // the instance's questions. With the instance start, this yields exactly two
    // activity events and therefore exactly one >1-hour gap.
    await sqldb.execute(sql.insert_variant_and_dated_submission, {
      assessment_instance_id,
      authn_user_id: context.userId,
      date: LATE_SUBMISSION,
    });

    await gradeAssessmentInstance({
      assessment_instance_id,
      user_id: context.userId,
      authn_user_id: context.userId,
      requireOpen: true,
      close: true,
      ignoreGradeRateLimit: true,
      ignoreRealTimeGradingDisabled: true,
      client_fingerprint_id: null,
    });

    return await sqldb.queryScalar(
      sql.select_duration_seconds,
      { assessment_instance_id },
      z.number(),
    );
  }

  test.sequential('a timed exam counts a >1-hour gap in full', async () => {
    const seconds = await durationSecondsWithSingleLateSubmission(context.examAssessment);
    // The full 90-minute gap must be counted: ~5400s, NOT 0.
    assert.closeTo(seconds, GAP_MINUTES * 60, 5);
  });

  test.sequential('homework still drops a >1-hour idle gap', async () => {
    const seconds = await durationSecondsWithSingleLateSubmission(context.homeworkAssessment);
    // The idle window legitimately discards the overnight gap for homework.
    assert.equal(seconds, 0);
  });
});
