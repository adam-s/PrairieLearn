-- BLOCK select_assessments
SELECT
  a.id
FROM
  assessments AS a
WHERE
  EXISTS (
    SELECT
      *
    FROM
      assessment_instances AS ai
    WHERE
      (ai.assessment_id = a.id)
      -- Recalculate when stats have never been computed (stats_last_updated IS NULL),
      -- not only when an instance is newer than the last computation. `x > NULL` is
      -- NULL (never true), so without the NULL check these assessments are never picked.
      AND (
        a.stats_last_updated IS NULL
        OR ai.modified_at > a.stats_last_updated
      )
  );
