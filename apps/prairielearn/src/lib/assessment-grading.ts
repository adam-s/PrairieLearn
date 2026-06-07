import z from 'zod';

import {
  execute,
  loadSqlEquiv,
  queryOptionalScalar,
  queryRow,
  queryRows,
  runInTransactionAsync,
} from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { AssessmentInstanceSchema, SubmissionSchema } from './db-types.js';

const sql = loadSqlEquiv(import.meta.url);

const AssessmentInstanceZonePointsSchema = z.object({
  zone_id: IdSchema,
  points: z.number(),
  iq_ids: IdSchema.array(),
  max_points: z.number(),
  max_iq_ids: IdSchema.array(),
});
type AssessmentInstanceZonePoints = z.infer<typeof AssessmentInstanceZonePointsSchema>;

export async function updateAssessmentInstanceGrade({
  assessment_instance_id,
  authn_user_id,
  credit = null,
  onlyLogIfScoreUpdated = false,
  allowDecrease = false,
  precomputedPointsByZone,
}: {
  assessment_instance_id: string;
  authn_user_id: string | null;
  credit?: number | null;
  onlyLogIfScoreUpdated?: boolean;
  allowDecrease?: boolean;
  precomputedPointsByZone?: AssessmentInstanceZonePoints[];
}): Promise<{ updated: boolean; points: number; score_perc: number }> {
  return await runInTransactionAsync(async () => {
    const assessmentInstance = await queryRow(
      sql.select_and_lock_assessment_instance,
      { assessment_instance_id },
      AssessmentInstanceSchema,
    );

    if (credit == null) {
      // If credit was not explicitly set (the regrade/recompute paths), resolve
      // it from the highest credit the instance's submitted work counts under --
      // NOT the most recent submission's credit. A later no-credit practice
      // submission must not suppress a regrade of points the student earned under
      // an earlier for-credit rule. An instance whose submissions are all
      // no-credit (or have a NULL credit) resolves to 0.
      credit =
        (await queryOptionalScalar(
          sql.select_max_credit_of_submissions,
          { assessment_instance_id },
          SubmissionSchema.shape.credit,
        )) ?? 0;
    }

    const pointsByZone =
      precomputedPointsByZone ??
      (await computeAssessmentInstanceScoreByZone({ assessment_instance_id }));
    const instanceQuestionsUsedForGrade = pointsByZone.flatMap((zone) => zone.iq_ids);
    const totalPoints = pointsByZone.reduce((sum, zone) => sum + zone.points, 0);

    // If the effective access rule grants no credit, working a question must not
    // change the recorded points -- preserve the existing value (left unset for
    // students who never attempted for credit) rather than overwriting it with
    // the uncredited earned points (issue #958). Only the points value is gated:
    // the bookkeeping below (used_for_grade, modified_at, the score log) still
    // runs so a no-credit attempt is recorded consistently. Staff actions that
    // should always apply (e.g. manual grading) pass an explicit non-zero credit,
    // and a regrade now resolves the for-credit rule above, so neither is gated.
    const computedPoints = Math.min(
      totalPoints,
      (assessmentInstance.max_points ?? 0) + (assessmentInstance.max_bonus_points ?? 0),
    );
    const points = credit === 0 ? (assessmentInstance.points ?? 0) : computedPoints;

    // Compute the score as a percentage, applying credit bonus/limits. If
    // max_points is zero (or null), points will typically also be zero, so we
    // avoid division by zero by using 1 as denominator in that case. If points
    // happens to have a positive value (which can only happen if bonus points
    // is positive), for legacy reasons we still compute a percentage score
    // based on 1 point total (with the usual credit bonus/limit applied),
    // though we don't expect this to be commonly used.
    let score_perc = (points * 100) / (assessmentInstance.max_points || 1);
    if (credit < 100) {
      score_perc = Math.min(score_perc, credit);
    } else if (credit > 100 && points >= (assessmentInstance.max_points ?? 0)) {
      score_perc = (credit * score_perc) / 100;
    }
    if (!allowDecrease) {
      score_perc = Math.max(score_perc, assessmentInstance.score_perc ?? 0);
    }

    const updated =
      points !== assessmentInstance.points || score_perc !== assessmentInstance.score_perc;

    await execute(sql.update_assessment_instance_grade, {
      assessment_instance_id,
      points,
      score_perc,
      authn_user_id,
      insert_log: updated || !onlyLogIfScoreUpdated,
      instance_questions_used_for_grade: instanceQuestionsUsedForGrade,
    });

    return { updated, points, score_perc };
  });
}

export async function computeAssessmentInstanceScoreByZone({
  assessment_instance_id,
}: {
  assessment_instance_id: string;
}) {
  return await queryRows(
    sql.compute_assessment_instance_points_by_zone,
    { assessment_instance_id },
    AssessmentInstanceZonePointsSchema,
  );
}
