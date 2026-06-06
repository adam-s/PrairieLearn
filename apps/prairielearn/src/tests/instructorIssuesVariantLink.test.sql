-- BLOCK select_question_id
SELECT
  id
FROM
  questions
WHERE
  qid = 'addNumbers'
  AND deleted_at IS NULL
ORDER BY
  id
LIMIT
  1;

-- BLOCK insert_issue_without_variant
INSERT INTO
  issues (
    course_id,
    question_id,
    variant_id,
    student_message,
    course_caused,
    manually_reported,
    open
  )
VALUES
  (
    1,
    $question_id,
    NULL,
    'variant-less issue (1980 repro)',
    TRUE,
    TRUE,
    TRUE
  );
