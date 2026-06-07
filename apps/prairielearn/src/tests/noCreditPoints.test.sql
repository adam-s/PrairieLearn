-- BLOCK read_assessment_instance_points_by_id
SELECT
  ai.points,
  ai.score_perc
FROM
  assessment_instances AS ai
WHERE
  ai.id = $assessment_instance_id;

-- BLOCK set_assessment_instance_points
UPDATE assessment_instances AS ai
SET
  points = $points,
  score_perc = $score_perc
WHERE
  ai.id = $assessment_instance_id;

-- BLOCK read_instance_question_points
SELECT
  iq.points
FROM
  instance_questions AS iq
  JOIN assessment_questions AS aq ON (aq.id = iq.assessment_question_id)
WHERE
  iq.assessment_instance_id = $assessment_instance_id
ORDER BY
  aq.number;

-- BLOCK read_instance_question_point_breakdown
SELECT
  iq.id,
  iq.points,
  iq.auto_points,
  iq.manual_points
FROM
  instance_questions AS iq
  JOIN assessment_questions AS aq ON (aq.id = iq.assessment_question_id)
WHERE
  iq.assessment_instance_id = $assessment_instance_id
ORDER BY
  aq.number;
