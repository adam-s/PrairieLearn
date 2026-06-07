-- BLOCK select_instance_question_id
SELECT
  iq.id
FROM
  instance_questions AS iq
  JOIN assessment_questions AS aq ON (aq.id = iq.assessment_question_id)
  JOIN questions AS q ON (q.id = aq.question_id)
WHERE
  iq.assessment_instance_id = $assessment_instance_id
  AND q.qid = $qid;

-- BLOCK select_submissions_for_variant
SELECT
  s.id,
  s.gradable
FROM
  submissions AS s
WHERE
  s.variant_id = $variant_id
ORDER BY
  s.date DESC,
  s.id DESC;

-- BLOCK select_instance_question_for_variant
SELECT
  iq.points,
  iq.score_perc,
  iq.status
FROM
  instance_questions AS iq
  JOIN variants AS v ON (v.instance_question_id = iq.id)
WHERE
  v.id = $variant_id;
