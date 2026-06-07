-- BLOCK select_audit_events_by_enrollment_id_table_names
SELECT
  *
FROM
  audit_events
WHERE
  enrollment_id = $enrollment_id
  AND table_name = ANY ($table_names::text[])
ORDER BY
  date DESC;

-- BLOCK select_audit_events_by_subject_user_id_table_names_course_instance_id
SELECT
  *
FROM
  audit_events
WHERE
  subject_user_id = $subject_user_id
  AND table_name = ANY ($table_names::text[])
  AND course_instance_id = $course_instance_id
ORDER BY
  date DESC;

-- BLOCK select_audit_events_by_agent_authn_user_id_table_names_course_instance_id
SELECT
  *
FROM
  audit_events
WHERE
  agent_authn_user_id = $agent_authn_user_id
  AND table_name = ANY ($table_names::text[])
  AND course_instance_id = $course_instance_id
ORDER BY
  date DESC;

-- BLOCK select_audit_events_by_institution_id_table_names
SELECT
  *
FROM
  audit_events
WHERE
  institution_id = $institution_id
  AND table_name = ANY ($table_names::text[])
ORDER BY
  date DESC,
  id DESC;

-- BLOCK insert_audit_event
WITH
  assessment_instance_meta AS (
    SELECT
      id,
      team_id,
      assessment_id
    FROM
      assessment_instances
    WHERE
      id = $assessment_instance_id
      AND id IS NOT NULL
  ),
  enrollment_meta AS (
    SELECT
      id,
      course_instance_id
    FROM
      enrollments
    WHERE
      id = $enrollment_id
      AND id IS NOT NULL
  ),
  team_meta AS (
    SELECT
      id,
      (
        SELECT
          assessment_id
        FROM
          team_configs
        WHERE
          id = g.team_config_id
      ) AS assessment_id,
      course_instance_id
    FROM
      teams AS g
    WHERE
      id = coalesce(
        $team_id,
        (
          SELECT
            team_id
          FROM
            assessment_instance_meta
        )
      )
      AND id IS NOT NULL
  ),
  assessment_question_meta AS (
    SELECT
      id,
      assessment_id
    FROM
      assessment_questions
    WHERE
      id = $assessment_question_id
      AND id IS NOT NULL
  ),
  assessment_meta AS (
    SELECT
      id,
      course_instance_id
    FROM
      assessments
    WHERE
      id = coalesce(
        $assessment_id,
        (
          SELECT
            assessment_id
          FROM
            assessment_instance_meta
        ),
        (
          SELECT
            assessment_id
          FROM
            assessment_question_meta
        ),
        (
          SELECT
            assessment_id
          FROM
            team_meta
        )
      )
      AND id IS NOT NULL
  ),
  course_instance_meta AS (
    SELECT
      id,
      course_id
    FROM
      course_instances
    WHERE
      id = coalesce(
        $course_instance_id,
        (
          SELECT
            course_instance_id
          FROM
            enrollment_meta
        ),
        (
          SELECT
            course_instance_id
          FROM
            team_meta
        ),
        (
          SELECT
            course_instance_id
          FROM
            assessment_meta
        )
      )
      AND id IS NOT NULL
  ),
  course_meta AS (
    SELECT
      id,
      institution_id
    FROM
      courses
    WHERE
      id = coalesce(
        $course_id,
        (
          SELECT
            course_id
          FROM
            course_instance_meta
        )
      )
      AND id IS NOT NULL
  ),
  institution_meta AS (
    SELECT
      id
    FROM
      institutions
    WHERE
      id = coalesce(
        $institution_id,
        (
          SELECT
            institution_id
          FROM
            course_meta
        )
      )
      AND id IS NOT NULL
  )
INSERT INTO
  audit_events (
    action,
    action_detail,
    table_name,
    subject_user_id,
    course_instance_id,
    row_id,
    context,
    old_row,
    new_row,
    agent_authn_user_id,
    agent_user_id,
    institution_id,
    course_id,
    enrollment_id,
    assessment_id,
    assessment_instance_id,
    assessment_question_id,
    team_id
  )
SELECT
  $action,
  $action_detail,
  $table_name,
  $subject_user_id,
  course_instance_meta.id AS course_instance_id,
  $row_id,
  $context,
  $old_row,
  $new_row,
  $agent_authn_user_id,
  $agent_user_id,
  institution_meta.id AS institution_id,
  course_meta.id AS course_id,
  enrollment_meta.id AS enrollment_id,
  assessment_meta.id AS assessment_id,
  -- We coalesce here since it is possible that assessment_instance_meta.id is null, and $assessment_instance_id is not null.
  -- There is no foreign key constraint on assessment_instance_id since it can be hard-deleted, and we want to preserve the nonexistent ID for auditing.
  coalesce(
    assessment_instance_meta.id,
    $assessment_instance_id
  ) AS assessment_instance_id,
  assessment_question_meta.id AS assessment_question_id,
  team_meta.id AS team_id
FROM
  (
    SELECT
      1
  ) AS tmp -- dummy row to make the LEFT JOINs work
  LEFT JOIN course_instance_meta ON (TRUE)
  LEFT JOIN institution_meta ON (TRUE)
  LEFT JOIN course_meta ON (TRUE)
  LEFT JOIN enrollment_meta ON (TRUE)
  LEFT JOIN assessment_meta ON (TRUE)
  LEFT JOIN assessment_instance_meta ON (TRUE)
  LEFT JOIN assessment_question_meta ON (TRUE)
  LEFT JOIN team_meta ON (TRUE)
RETURNING
  *;

-- BLOCK insert_audit_events
-- Bulk version of insert_audit_event: inserts every event in $events (a JSON
-- array of already-resolved audit-event params) in a single statement, running
-- the same per-row ID inference as the singular block via LEFT JOIN LATERAL.
INSERT INTO
  audit_events (
    action,
    action_detail,
    table_name,
    subject_user_id,
    course_instance_id,
    row_id,
    context,
    old_row,
    new_row,
    agent_authn_user_id,
    agent_user_id,
    institution_id,
    course_id,
    enrollment_id,
    assessment_id,
    assessment_instance_id,
    assessment_question_id,
    team_id
  )
SELECT
  e.action,
  e.action_detail,
  e.table_name,
  e.subject_user_id,
  course_instance_meta.id AS course_instance_id,
  e.row_id,
  e.context,
  e.old_row,
  e.new_row,
  e.agent_authn_user_id,
  e.agent_user_id,
  institution_meta.id AS institution_id,
  course_meta.id AS course_id,
  enrollment_meta.id AS enrollment_id,
  assessment_meta.id AS assessment_id,
  -- We coalesce here since it is possible that assessment_instance_meta.id is null, and e.assessment_instance_id is not null.
  -- There is no foreign key constraint on assessment_instance_id since it can be hard-deleted, and we want to preserve the nonexistent ID for auditing.
  coalesce(
    assessment_instance_meta.id,
    e.assessment_instance_id
  ) AS assessment_instance_id,
  assessment_question_meta.id AS assessment_question_id,
  team_meta.id AS team_id
FROM
  jsonb_to_recordset($events::jsonb) AS e (
    ordinality bigint,
    action audit_event_action,
    action_detail text,
    table_name text,
    subject_user_id bigint,
    course_instance_id bigint,
    row_id bigint,
    context jsonb,
    old_row jsonb,
    new_row jsonb,
    agent_authn_user_id bigint,
    agent_user_id bigint,
    institution_id bigint,
    course_id bigint,
    enrollment_id bigint,
    assessment_id bigint,
    assessment_instance_id bigint,
    assessment_question_id bigint,
    team_id bigint
  )
  LEFT JOIN LATERAL (
    SELECT
      id,
      team_id,
      assessment_id
    FROM
      assessment_instances
    WHERE
      id = e.assessment_instance_id
      AND id IS NOT NULL
  ) AS assessment_instance_meta ON (TRUE)
  LEFT JOIN LATERAL (
    SELECT
      id,
      course_instance_id
    FROM
      enrollments
    WHERE
      id = e.enrollment_id
      AND id IS NOT NULL
  ) AS enrollment_meta ON (TRUE)
  LEFT JOIN LATERAL (
    SELECT
      id,
      (
        SELECT
          assessment_id
        FROM
          team_configs
        WHERE
          id = g.team_config_id
      ) AS assessment_id,
      course_instance_id
    FROM
      teams AS g
    WHERE
      id = coalesce(e.team_id, assessment_instance_meta.team_id)
      AND id IS NOT NULL
  ) AS team_meta ON (TRUE)
  LEFT JOIN LATERAL (
    SELECT
      id,
      assessment_id
    FROM
      assessment_questions
    WHERE
      id = e.assessment_question_id
      AND id IS NOT NULL
  ) AS assessment_question_meta ON (TRUE)
  LEFT JOIN LATERAL (
    SELECT
      id,
      course_instance_id
    FROM
      assessments
    WHERE
      id = coalesce(
        e.assessment_id,
        assessment_instance_meta.assessment_id,
        assessment_question_meta.assessment_id,
        team_meta.assessment_id
      )
      AND id IS NOT NULL
  ) AS assessment_meta ON (TRUE)
  LEFT JOIN LATERAL (
    SELECT
      id,
      course_id
    FROM
      course_instances
    WHERE
      id = coalesce(
        e.course_instance_id,
        enrollment_meta.course_instance_id,
        team_meta.course_instance_id,
        assessment_meta.course_instance_id
      )
      AND id IS NOT NULL
  ) AS course_instance_meta ON (TRUE)
  LEFT JOIN LATERAL (
    SELECT
      id,
      institution_id
    FROM
      courses
    WHERE
      id = coalesce(e.course_id, course_instance_meta.course_id)
      AND id IS NOT NULL
  ) AS course_meta ON (TRUE)
  LEFT JOIN LATERAL (
    SELECT
      id
    FROM
      institutions
    WHERE
      id = coalesce(e.institution_id, course_meta.institution_id)
      AND id IS NOT NULL
  ) AS institution_meta ON (TRUE)
ORDER BY
  e.ordinality
RETURNING
  *;
