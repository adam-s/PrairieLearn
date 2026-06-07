-- BLOCK set_assessment_instance_date
UPDATE assessment_instances
SET
  date = $date
WHERE
  id = $assessment_instance_id;

-- BLOCK insert_variant_and_dated_submission
-- Create one variant on the first question of the instance and a single
-- submission dated $date. Together with the instance start date this yields
-- exactly two activity events => exactly one gap.
WITH
  target_iq AS (
    SELECT
      iq.id AS instance_question_id,
      aq.question_id,
      q.course_id
    FROM
      instance_questions AS iq
      JOIN assessment_questions AS aq ON (aq.id = iq.assessment_question_id)
      JOIN questions AS q ON (q.id = aq.question_id)
    WHERE
      iq.assessment_instance_id = $assessment_instance_id
    ORDER BY
      iq.id
    LIMIT
      1
  ),
  new_variant AS (
    INSERT INTO
      variants (
        instance_question_id,
        question_id,
        course_id,
        authn_user_id,
        user_id,
        variant_seed,
        params,
        true_answer
      )
    SELECT
      target_iq.instance_question_id,
      target_iq.question_id,
      target_iq.course_id,
      $authn_user_id,
      $authn_user_id,
      '1',
      '{}'::jsonb,
      '{}'::jsonb
    FROM
      target_iq
    RETURNING
      id
  )
INSERT INTO
  submissions (
    variant_id,
    auth_user_id,
    date,
    submitted_answer,
    gradable
  )
SELECT
  new_variant.id,
  $authn_user_id,
  $date,
  '{}'::jsonb,
  -- Not gradable: this submission exists only to provide a dated activity
  -- event for the duration computation, not to be scored.
  FALSE
FROM
  new_variant;

-- BLOCK select_duration_seconds
SELECT
  DATE_PART('epoch', duration)::double precision AS duration
FROM
  assessment_instances
WHERE
  id = $assessment_instance_id;
