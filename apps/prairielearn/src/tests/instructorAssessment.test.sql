-- BLOCK select_instance_question
SELECT
  iq.*
FROM
  instance_questions AS iq
WHERE
  iq.id = $instance_question_id;

-- BLOCK select_submissions_for_instance_question
SELECT
  s.*
FROM
  submissions AS s
  JOIN variants AS v ON (v.id = s.variant_id)
WHERE
  v.instance_question_id = $instance_question_id
ORDER BY
  s.date;

-- BLOCK select_grading_jobs_for_instance_question
SELECT
  gj.*
FROM
  grading_jobs AS gj
  JOIN submissions AS s ON (s.id = gj.submission_id)
  JOIN variants AS v ON (v.id = s.variant_id)
WHERE
  v.instance_question_id = $instance_question_id
ORDER BY
  gj.id;

-- BLOCK select_unanswered_instance_question
SELECT
  iq.id,
  q.qid,
  aq.max_points,
  aq.max_manual_points,
  aq.max_auto_points
FROM
  instance_questions AS iq
  JOIN assessment_questions AS aq ON (aq.id = iq.assessment_question_id)
  JOIN questions AS q ON (q.id = aq.question_id)
  LEFT JOIN variants AS v ON (v.instance_question_id = iq.id)
  LEFT JOIN submissions AS s ON (s.variant_id = v.id)
WHERE
  iq.assessment_instance_id = $assessment_instance_id
GROUP BY
  iq.id,
  q.qid,
  aq.max_points,
  aq.max_manual_points,
  aq.max_auto_points
HAVING
  count(s.id) = 0
ORDER BY
  q.qid
LIMIT
  1;
