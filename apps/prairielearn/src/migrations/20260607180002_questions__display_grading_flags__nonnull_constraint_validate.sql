-- Validate the previously-added `NOT VALID` constraints, promote them to real
-- `NOT NULL` column constraints, and drop the now-redundant CHECK constraints.
-- `VALIDATE CONSTRAINT` scans the table but takes only a SHARE UPDATE EXCLUSIVE
-- lock (it does not block reads or writes), and the subsequent `SET NOT NULL`
-- is cheap because the validated CHECK already proves the absence of NULLs.

ALTER TABLE questions VALIDATE CONSTRAINT questions_partial_credit_not_null;

ALTER TABLE questions
ALTER COLUMN partial_credit
SET NOT NULL;

ALTER TABLE questions
DROP CONSTRAINT questions_partial_credit_not_null;

ALTER TABLE questions VALIDATE CONSTRAINT questions_show_correct_answer_not_null;

ALTER TABLE questions
ALTER COLUMN show_correct_answer
SET NOT NULL;

ALTER TABLE questions
DROP CONSTRAINT questions_show_correct_answer_not_null;

ALTER TABLE questions VALIDATE CONSTRAINT questions_single_variant_not_null;

ALTER TABLE questions
ALTER COLUMN single_variant
SET NOT NULL;

ALTER TABLE questions
DROP CONSTRAINT questions_single_variant_not_null;
