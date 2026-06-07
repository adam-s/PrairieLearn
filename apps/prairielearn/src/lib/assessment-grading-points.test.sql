-- BLOCK seed_points_instance
WITH
  -- A dedicated assessment so there are no question conflicts with existing
  -- fixtures. Homework type, real-time grading on.
  new_assessment AS (
    INSERT INTO
      assessments (
        course_instance_id,
        tid,
        type,
        title,
        number,
        max_points
      )
    SELECT
      a.course_instance_id,
      'issue-10928-points-accumulation',
      'Homework',
      'issue-10928 points accumulation',
      '99999',
      NULL
    FROM
      assessments AS a
    WHERE
      a.id = $assessment_id
    RETURNING
      id,
      course_instance_id
  ),
  -- A fresh zone with no max-points cap and no best_questions limit, so every
  -- question's points contribute to the per-zone sum.
  new_zone AS (
    INSERT INTO
      zones (
        assessment_id,
        number,
        title,
        max_points,
        best_questions
      )
    SELECT
      new_assessment.id,
      999,
      'issue-10928 zone',
      NULL,
      NULL
    FROM
      new_assessment
    RETURNING
      id,
      assessment_id
  ),
  new_ag AS (
    INSERT INTO
      alternative_groups (assessment_id, zone_id, number)
    SELECT
      new_zone.assessment_id,
      new_zone.id,
      999
    FROM
      new_zone
    RETURNING
      id,
      assessment_id
  ),
  -- One assessment question per (qid, points) pair from the issue's example.
  -- max_points carries the intended per-question value; points_list mirrors it.
  question_points AS (
    SELECT
      q.qid,
      q.id AS question_id,
      pts.points,
      pts.ord
    FROM
      unnest($qids::text[], $points::double precision[]) WITH ORDINALITY AS pts (qid, points, ord)
      JOIN questions AS q ON (q.qid = pts.qid)
  ),
  new_aqs AS (
    INSERT INTO
      assessment_questions (
        assessment_id,
        question_id,
        alternative_group_id,
        number_in_alternative_group,
        number,
        max_points,
        init_points,
        points_list,
        max_auto_points,
        max_manual_points,
        allow_real_time_grading
      )
    SELECT
      new_ag.assessment_id,
      qp.question_id,
      new_ag.id,
      qp.ord,
      qp.ord,
      qp.points,
      qp.points,
      ARRAY[qp.points],
      qp.points,
      0,
      TRUE
    FROM
      question_points AS qp,
      new_ag
    RETURNING
      id,
      max_points,
      number
  ),
  new_ai AS (
    INSERT INTO
      assessment_instances (assessment_id, user_id, number, open, date)
    SELECT
      new_ag.assessment_id,
      $user_id,
      999,
      TRUE,
      now()
    FROM
      new_ag
    RETURNING
      id
  ),
  -- All questions answered fully correctly: instance_question.points equals the
  -- assessment_question.max_points.
  new_iqs AS (
    INSERT INTO
      instance_questions (
        assessment_instance_id,
        assessment_question_id,
        status,
        points,
        auto_points,
        manual_points,
        score_perc,
        used_for_grade
      )
    SELECT
      new_ai.id,
      aq.id,
      'complete',
      aq.max_points,
      aq.max_points,
      0,
      100,
      TRUE
    FROM
      new_aqs AS aq,
      new_ai
    RETURNING
      id
  )
SELECT
  id
FROM
  new_ai;

-- BLOCK select_assessment_instance
SELECT
  *
FROM
  assessment_instances
WHERE
  id = $assessment_instance_id;
