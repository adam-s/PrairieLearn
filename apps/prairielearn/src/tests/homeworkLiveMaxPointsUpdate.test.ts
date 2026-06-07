import fetch from 'node-fetch';
import { afterAll, assert, beforeAll, describe, it } from 'vitest';
import z from 'zod';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { config } from '../lib/config.js';
import { AssessmentInstanceSchema } from '../lib/db-types.js';
import { selectAssessmentByTid } from '../models/assessment.js';

import * as helperServer from './helperServer.js';

// Regression test for PrairieLearn/PrairieLearn#757:
//   "Changing points/maxPoints does not immediately update live Homeworks"
//
// For a Homework, changing a question's maxPoints in course content and
// re-syncing should update the max_points of an already-open student instance
// the next time the student views it. The post-sync DB state is exactly an
// increased assessment_questions.max_points / max_auto_points; we apply that
// directly and assert the live instance picks it up on the next page GET.
//
// The fix path is studentAssessmentInstance GET -> ensureUpToDate() ->
// updateAssessmentInstance(), which recomputes assessment_instances.max_points
// from assessment_questions. Disabling that call (the resolving mechanism)
// makes this test go red, proving the bug was real.

const siteUrl = 'http://localhost:' + config.serverPort;
const baseUrl = siteUrl + '/pl';
const courseInstanceBaseUrl = baseUrl + '/course_instance/1';

const MAX_POINTS_DELTA = 10;

describe(
  'Homework live max_points update after re-sync (issue #757)',
  { timeout: 60_000 },
  function () {
    beforeAll(helperServer.before(), 120_000);
    afterAll(helperServer.after);

    let assessmentId: string;
    let assessmentInstanceUrl: string;
    let originalMaxPoints = 0;

    it('starts a Homework instance as a student', async () => {
      const { id } = await selectAssessmentByTid({
        course_instance_id: '1',
        tid: 'hw1-automaticTestSuite',
      });
      assessmentId = id;

      // GET the assessment URL: auto-creates the HW instance and redirects to it.
      const res = await fetch(`${courseInstanceBaseUrl}/assessment/${assessmentId}/`);
      assert.equal(res.status, 200);
      assessmentInstanceUrl = res.url;
      assert.match(res.url, /assessment_instance\/\d+$/);
    });

    it('records the original instance max_points snapshot', async () => {
      const ai = await sqldb.queryRow(
        'SELECT * FROM assessment_instances WHERE id = 1;',
        AssessmentInstanceSchema,
      );
      assert.isAbove(ai.max_points ?? 0, 0);
      originalMaxPoints = ai.max_points ?? 0;
    });

    it("simulates a re-sync that raises one question's maxPoints", async () => {
      // This is the net effect of editing maxAutoPoints in infoAssessment.json
      // and re-syncing: assessment_questions for this assessment gains points.
      const result = await sqldb.queryRow(
        `UPDATE assessment_questions AS aq
       SET max_points = aq.max_points + $delta,
           max_auto_points = aq.max_auto_points + $delta
       FROM alternative_groups ag, zones z
       WHERE aq.alternative_group_id = ag.id
         AND ag.zone_id = z.id
         AND aq.assessment_id = $assessment_id
         AND aq.number = 1
       RETURNING aq.id;`,
        { assessment_id: assessmentId, delta: MAX_POINTS_DELTA },
        z.object({ id: IdSchema }),
      );
      assert.isDefined(result.id);
    });

    it('still shows the OLD instance max_points before the student revisits', async () => {
      const ai = await sqldb.queryRow(
        'SELECT * FROM assessment_instances WHERE id = 1;',
        AssessmentInstanceSchema,
      );
      // The snapshot has not been touched yet — the bug's premise.
      assert.equal(ai.max_points ?? 0, originalMaxPoints);
    });

    it('updates the live instance max_points when the student revisits (the fix)', async () => {
      const res = await fetch(assessmentInstanceUrl);
      assert.equal(res.status, 200);

      const ai = await sqldb.queryRow(
        'SELECT * FROM assessment_instances WHERE id = 1;',
        AssessmentInstanceSchema,
      );
      assert.equal(
        ai.max_points ?? 0,
        originalMaxPoints + MAX_POINTS_DELTA,
        'live Homework instance max_points should pick up the re-synced maxPoints',
      );
    });

    // Sibling (red-team): a *decrease* in maxPoints must also propagate, not just
    // an increase. The resolving SQL uses `IS DISTINCT FROM`, so it does.
    it('also propagates a DECREASE in maxPoints to the live instance', async () => {
      await sqldb.execute(
        `UPDATE assessment_questions AS aq
       SET max_points = aq.max_points - $delta,
           max_auto_points = aq.max_auto_points - $delta
       WHERE aq.assessment_id = $assessment_id
         AND aq.number = 1;`,
        { assessment_id: assessmentId, delta: MAX_POINTS_DELTA },
      );

      const res = await fetch(assessmentInstanceUrl);
      assert.equal(res.status, 200);

      const ai = await sqldb.queryRow(
        'SELECT * FROM assessment_instances WHERE id = 1;',
        AssessmentInstanceSchema,
      );
      assert.equal(
        ai.max_points ?? 0,
        originalMaxPoints,
        'decreasing maxPoints back to the original should also be reflected live',
      );
    });
  },
);
