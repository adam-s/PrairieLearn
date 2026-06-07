import { afterEach, assert, beforeEach, describe, it } from 'vitest';
import { z } from 'zod';

import { execute, queryRow, queryScalar } from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

const ScoreStatSchema = z.object({
  number: z.coerce.number(),
  mean: z.coerce.number(),
});
import { selectAssessmentByTid } from '../models/assessment.js';
import * as helperCourse from '../tests/helperCourse.js';
import * as helperDb from '../tests/helperDb.js';
import { getOrCreateUser } from '../tests/utils/auth.js';

import {
  deleteAllAssessmentInstancesForAssessment,
  deleteAssessmentInstance,
  updateAssessmentStatistics,
} from './assessment.js';

const COURSE_INSTANCE_ID = '1';
const ASSESSMENT_TID = 'hw1-automaticTestSuite';

async function enrollAndAddInstance({
  assessmentId,
  uid,
  scorePerc,
  number,
}: {
  assessmentId: string;
  uid: string;
  scorePerc: number;
  number: number;
}): Promise<string> {
  const user = await getOrCreateUser({ uid, name: uid, uin: uid, email: uid });
  await execute(
    `INSERT INTO enrollments (user_id, course_instance_id, first_joined_at)
     VALUES ($user_id, $course_instance_id, now())
     ON CONFLICT DO NOTHING`,
    { user_id: user.id, course_instance_id: COURSE_INSTANCE_ID },
  );
  return await queryScalar(
    `INSERT INTO assessment_instances
       (assessment_id, user_id, auth_user_id, number, score_perc, points, max_points,
        include_in_statistics, date, modified_at, open)
     VALUES ($assessment_id, $user_id, $user_id, $number, $score_perc, 0, 10,
        true, now() - interval '1 day', now() - interval '1 day', false)
     RETURNING id`,
    {
      assessment_id: assessmentId,
      user_id: user.id,
      number,
      score_perc: scorePerc,
    },
    IdSchema,
  );
}

async function getScoreStat(assessmentId: string) {
  return await queryRow(
    `SELECT score_stat_number AS number, score_stat_mean AS mean
       FROM assessments WHERE id = $id`,
    { id: assessmentId },
    ScoreStatSchema,
  );
}

describe('assessment statistics after instance deletion (issue #11060)', () => {
  let assessmentId: string;

  beforeEach(async () => {
    await helperDb.before();
    await helperCourse.syncCourse();
    const assessment = await selectAssessmentByTid({
      course_instance_id: COURSE_INSTANCE_ID,
      tid: ASSESSMENT_TID,
    });
    assessmentId = assessment.id;
  });

  afterEach(async () => {
    await helperDb.after();
  });

  it('recomputes stats after a single instance is deleted', async () => {
    const id1 = await enrollAndAddInstance({
      assessmentId,
      uid: 's1_11060@example.com',
      scorePerc: 40,
      number: 1,
    });
    await enrollAndAddInstance({
      assessmentId,
      uid: 's2_11060@example.com',
      scorePerc: 80,
      number: 2,
    });

    await updateAssessmentStatistics(assessmentId);
    let stat = await getScoreStat(assessmentId);
    assert.equal(Number(stat.number), 2);
    assert.equal(Math.round(Number(stat.mean)), 60);

    // Delete one instance; stats must drop to reflect the single remaining one.
    await deleteAssessmentInstance(assessmentId, id1, '1');

    stat = await getScoreStat(assessmentId);
    assert.equal(Number(stat.number), 1);
    assert.equal(Math.round(Number(stat.mean)), 80);
  });

  it('zeroes stats after the last instance is deleted', async () => {
    const id1 = await enrollAndAddInstance({
      assessmentId,
      uid: 's3_11060@example.com',
      scorePerc: 40,
      number: 1,
    });

    await updateAssessmentStatistics(assessmentId);
    let stat = await getScoreStat(assessmentId);
    assert.equal(Number(stat.number), 1);

    // Deleting the only instance leaves zero rows; the modified-time heuristic
    // alone could never detect this, so stats must still recompute to zero.
    await deleteAssessmentInstance(assessmentId, id1, '1');

    stat = await getScoreStat(assessmentId);
    assert.equal(Number(stat.number), 0);
    assert.equal(Number(stat.mean), 0);
  });

  it('zeroes stats after deleting all instances at once', async () => {
    await enrollAndAddInstance({
      assessmentId,
      uid: 's4_11060@example.com',
      scorePerc: 40,
      number: 1,
    });
    await enrollAndAddInstance({
      assessmentId,
      uid: 's5_11060@example.com',
      scorePerc: 80,
      number: 2,
    });

    await updateAssessmentStatistics(assessmentId);
    let stat = await getScoreStat(assessmentId);
    assert.equal(Number(stat.number), 2);

    await deleteAllAssessmentInstancesForAssessment(assessmentId, '1');

    stat = await getScoreStat(assessmentId);
    assert.equal(Number(stat.number), 0);
    assert.equal(Number(stat.mean), 0);
  });
});
