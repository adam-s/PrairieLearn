-- BLOCK select_group_work_assessments
SELECT
  a.id
FROM
  assessments AS a
  JOIN assessment_sets AS aset ON (aset.id = a.assessment_set_id)
WHERE
  a.course_instance_id = 1
  AND aset.abbreviation = 'HW'
  AND a.team_work IS TRUE
ORDER BY
  a.id;

-- BLOCK disable_student_group_authz
UPDATE team_configs
SET
  student_authz_create = FALSE,
  student_authz_join = FALSE
WHERE
  assessment_id = $assessment_id
  AND deleted_at IS NULL;

-- BLOCK count_groups_for_assessment
SELECT
  count(*)::int
FROM
  teams
WHERE
  team_config_id IN (
    SELECT
      id
    FROM
      team_configs
    WHERE
      assessment_id = $assessment_id
  )
  AND deleted_at IS NULL;
