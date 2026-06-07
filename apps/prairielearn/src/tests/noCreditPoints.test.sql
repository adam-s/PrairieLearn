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
