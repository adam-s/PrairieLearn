-- BLOCK select_question_id
SELECT
  id
FROM
  questions
WHERE
  course_id = 1
  AND qid = 'addNumbers';

-- BLOCK select_open_issues
SELECT
  *
FROM
  issues
WHERE
  issues.open = TRUE;

-- BLOCK select_latest_issue
SELECT
  id
FROM
  issues
ORDER BY
  id DESC
LIMIT
  1;

-- BLOCK select_assessment_with_set
SELECT
  a.id
FROM
  assessments AS a
  JOIN course_instances AS ci ON (ci.id = a.course_instance_id)
WHERE
  ci.course_id = 1
  AND a.deleted_at IS NULL
  AND a.assessment_set_id IS NOT NULL
ORDER BY
  a.id
LIMIT
  1;

-- BLOCK attach_issue_to_assessment
UPDATE issues AS i
SET
  assessment_id = $assessment_id,
  course_instance_id = a.course_instance_id
FROM
  assessments AS a
WHERE
  a.id = $assessment_id
  AND i.id = $issue_id;

-- BLOCK soft_delete_assessment_and_clear_set
-- Reproduce the post-delete state: the assessment is soft-deleted and its
-- assessment_set_id has been nulled (the assessments_assessment_set_id_fkey is
-- ON DELETE SET NULL, and sync removes the now-unused implicit set).
UPDATE assessments
SET
  deleted_at = now(),
  assessment_set_id = NULL
WHERE
  id = $assessment_id;
