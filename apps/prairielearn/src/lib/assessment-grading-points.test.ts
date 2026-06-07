import { afterAll, assert, beforeAll, describe, it } from 'vitest';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { selectAssessmentByTid } from '../models/assessment.js';
import { generateAndEnrollUsers } from '../models/enrollment.js';
import * as helperServer from '../tests/helperServer.js';

import { updateAssessmentInstanceGrade } from './assessment-grading.js';
import { updateAssessmentInstance } from './assessment.js';
import { AssessmentInstanceSchema } from './db-types.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

/**
 * Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/10928
 *
 * The example from the issue: a single zone whose question point values are
 * [1.2, 2, 1.6, 1.2, 2, 1.6, 0.4], which should total exactly 10. Summed in
 * IEEE-754 double precision (the order the grading code uses), the total drifts
 * to 9.999999999999998, and that drifted value is stored as the assessment
 * instance's points / max_points and cascades into score_perc.
 */

// The issue's exact point values.
const QUESTION_POINTS = [1.2, 2, 1.6, 1.2, 2, 1.6, 0.4];
const EXPECTED_TOTAL = 10;

// Seven existing test-course questions to attach the points to.
const QIDS = [
  'addNumbers',
  'addVectors',
  'partialCredit1',
  'partialCredit2',
  'partialCredit3',
  'orderBlocks',
  'fossilFuelsRadio',
];

describe(
  'assessment instance points float accumulation (issue #10928)',
  { timeout: 60_000 },
  () => {
    beforeAll(helperServer.before(), 120_000);
    afterAll(helperServer.after);

    it('stores an exact total when fractional question points sum to a round number', async () => {
      // Use an existing Homework assessment as the container.
      const assessment = await selectAssessmentByTid({
        course_instance_id: '1',
        tid: 'hw3-partialCredit',
      });

      const [student] = await generateAndEnrollUsers({ count: 1, course_instance_id: '1' });

      // Build a fresh zone with seven questions carrying the issue's exact point
      // values, then create an assessment instance whose instance questions are
      // all fully correct (instance_question.points == assessment_question.max_points).
      const assessment_instance_id = await sqldb.queryScalar(
        sql.seed_points_instance,
        {
          assessment_id: assessment.id,
          user_id: student.id,
          qids: QIDS,
          points: QUESTION_POINTS,
        },
        IdSchema,
      );

      // Run the real production grading path. updateAssessmentInstance recomputes
      // and stores max_points (sum of zone max_points); updateAssessmentInstanceGrade
      // recomputes and stores points + score_perc (sum of zone points).
      await updateAssessmentInstance(assessment_instance_id, student.id, true);
      await updateAssessmentInstanceGrade({
        assessment_instance_id,
        authn_user_id: student.id,
        credit: 100,
        allowDecrease: true,
      });

      const ai = await sqldb.queryRow(
        sql.select_assessment_instance,
        { assessment_instance_id },
        AssessmentInstanceSchema,
      );

      // Strict equality: any floating-point drift makes these fail.
      assert.strictEqual(ai.max_points, EXPECTED_TOTAL, `max_points drifted: ${ai.max_points}`);
      assert.strictEqual(ai.points, EXPECTED_TOTAL, `points drifted: ${ai.points}`);
      assert.strictEqual(ai.score_perc, 100, `score_perc drifted: ${ai.score_perc}`);
    });
  },
);
