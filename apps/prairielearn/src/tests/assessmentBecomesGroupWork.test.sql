-- BLOCK select_assessment_instance
SELECT
  *
FROM
  assessment_instances
ORDER BY
  id DESC
LIMIT
  1;

-- BLOCK enable_team_work
WITH
  flip AS (
    UPDATE assessments
    SET
      team_work = TRUE
    WHERE
      id = $assessment_id
    RETURNING
      course_instance_id
  )
INSERT INTO
  team_configs (
    assessment_id,
    course_instance_id,
    minimum,
    maximum
  )
SELECT
  $assessment_id,
  flip.course_instance_id,
  1,
  5
FROM
  flip
ON CONFLICT (assessment_id) DO UPDATE
SET
  deleted_at = NULL;

-- BLOCK select_team_work
SELECT
  team_work
FROM
  assessments
WHERE
  id = $assessment_id;
