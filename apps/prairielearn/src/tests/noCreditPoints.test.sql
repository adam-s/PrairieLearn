-- BLOCK read_assessment_instance_points_by_id
SELECT
  ai.points,
  ai.score_perc
FROM
  assessment_instances AS ai
WHERE
  ai.id = $assessment_instance_id;
