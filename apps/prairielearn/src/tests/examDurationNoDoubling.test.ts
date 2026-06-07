import { afterAll, assert, beforeAll, describe, test } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { gradeAssessmentInstance, makeAssessmentInstance } from '../lib/assessment.js';
import type { Assessment } from '../lib/db-types.js';
import { selectAssessmentByTid } from '../models/assessment.js';
import { selectUserByUid } from '../models/user.js';

import * as helperServer from './helperServer.js';

// Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/669
//
// "Incorrect assessment instance duration for Exam?" — reporters saw a timed
// exam's duration come out at roughly TWICE the real elapsed time (e.g. a
// student who went 13:00 -> 13:45, a 45-minute span, was shown ~1h31m).
//
// An assessment instance's `duration` is the sum of the time gaps between
// consecutive activity events (the instance start plus each submission). It is
// computed once, from scratch, in `close_assessment_instance`
// (apps/prairielearn/src/lib/assessment.sql) and that recomputed value REPLACES
// the stored `ai.duration`. Historically `ai.duration` was instead accumulated
// incrementally as the student worked, and closing added a fresh recompute on
// top of that running total — doubling it (fixed upstream in 684f19e0c, "shift
// exam grading into lib/question", which made closing recompute-and-replace).
//
// This test pins the no-doubling guarantee through the real
// `gradeAssessmentInstance({ close: true })` code path: it builds a multi-
// submission exam spanning a known wall-clock window, PRE-LOADS a non-zero
// stored duration (standing in for the historical incremental total), closes
// the instance, and asserts the closed duration equals the wall-clock span —
// i.e. the recompute replaced the stale value rather than adding to it.

const sql = sqldb.loadSqlEquiv(import.meta.url);

const START = new Date('2024-01-01T13:00:00Z');
// Submissions at +15, +30, +44, +45 minutes => last activity event at 13:45,
// so the true wall-clock span (and the correct duration) is exactly 45 minutes.
const SUBMISSION_OFFSETS_MIN = [15, 30, 44, 45];
const WALL_CLOCK_MIN = 45;
// A bogus pre-existing stored duration. If the close path added the recompute to
// this (the #669 bug) instead of replacing it, the result would be inflated by
// this amount; the wall-clock assertion below would then fail.
const STALE_DURATION = '40 minutes';

describe('Exam instance duration is not doubled (issue #669)', { timeout: 60_000 }, () => {
  const context: Record<string, any> = {};

  beforeAll(async () => {
    await helperServer.before()();
    const user = await selectUserByUid('dev@example.com');
    context.userId = user.id;
    context.examAssessment = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'exam1-automaticTestSuite',
    });
  });

  afterAll(helperServer.after);

  // Build an instance started at START with one submission at each offset in
  // `offsets` (minutes after START), pre-load a stale stored duration, close it
  // (which recomputes `duration`), and return the stored duration in seconds.
  async function closedDurationSeconds(
    assessment: Assessment,
    offsets: number[],
  ): Promise<number> {
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

    // Stand in for the historical incrementally-accumulated duration.
    await sqldb.execute(sql.preload_stale_duration, {
      assessment_instance_id,
      duration: STALE_DURATION,
    });

    for (const offsetMin of offsets) {
      await sqldb.execute(sql.insert_dated_submission, {
        assessment_instance_id,
        authn_user_id: context.userId,
        date: new Date(START.getTime() + offsetMin * 60 * 1000),
      });
    }

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

  test.sequential(
    'a multi-submission exam reports the true wall-clock span, not double',
    async () => {
      const seconds = await closedDurationSeconds(context.examAssessment, SUBMISSION_OFFSETS_MIN);
      // Exactly the 45-minute span; NOT ~90 minutes, and NOT 45 + the 40-minute
      // stale value. The recompute must replace the stored duration, not add.
      assert.closeTo(seconds, WALL_CLOCK_MIN * 60, 5);
    },
  );
});
