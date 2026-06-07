-- BLOCK select_recent_images
SELECT DISTINCT
  q.external_grading_image
FROM
  submissions AS s
  JOIN variants AS v ON (v.id = s.variant_id)
  JOIN instance_questions AS iq ON (iq.id = v.instance_question_id)
  JOIN assessment_questions AS aq ON (aq.id = iq.assessment_question_id)
  JOIN questions AS q ON (q.id = aq.question_id)
WHERE
  q.grading_method = 'External'
  AND q.external_grading_image IS NOT NULL
  AND s.date >= (NOW() - interval '1 hour')
  AND EXISTS (
    SELECT
      1
    FROM
      grading_jobs AS gj
    WHERE
      gj.submission_id = s.id
  );
