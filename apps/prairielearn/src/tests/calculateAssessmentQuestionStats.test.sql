-- BLOCK select_assessment_and_user
SELECT
  (
    SELECT
      id
    FROM
      assessments
    ORDER BY
      id
    LIMIT
      1
  ) AS assessment_id,
  (
    SELECT
      id
    FROM
      users
    ORDER BY
      id
    LIMIT
      1
  ) AS user_id;

-- BLOCK insert_assessment_instance
INSERT INTO
  assessment_instances (assessment_id, user_id, number, open)
VALUES
  ($assessment_id, $user_id, 1, TRUE);

-- BLOCK null_stats_last_updated
UPDATE assessments
SET
  stats_last_updated = NULL
WHERE
  id = $assessment_id;

-- BLOCK select_stats_recalculated
SELECT
  stats_last_updated IS NOT NULL AS recalculated
FROM
  assessments
WHERE
  id = $assessment_id;
