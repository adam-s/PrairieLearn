-- Add `NOT NULL` constraints to the question display/grading boolean flags.
--
-- These columns have a column-level DEFAULT, are populated on every sync (the
-- info.json schema defaults `single_variant`/`show_correct_answer` and the
-- sync code always computes a concrete `partial_credit`), and a read-only
-- production scan found zero NULLs across all rows. We add the constraints in
-- two phases for a zero-downtime deploy: first `NOT VALID` (instant, no table
-- scan, enforced for new/updated rows), then `VALIDATE` + `SET NOT NULL` in a
-- later migration.
--
-- Defensive backfill for `partial_credit`: a 2017 migration set this column with
-- `partial_credit = (type = 'Freeform')`, which would have yielded NULL for any
-- row that had `type IS NULL` at that time. Our production scan shows zero such
-- rows survive, but a self-hosted/old database could still carry one, which would
-- make the later `VALIDATE CONSTRAINT` fail. We backfill any straggler from the
-- always-present `grading_method` (NOT NULL) before adding the constraint. This
-- affects 0 rows on a clean database and mirrors the backfill-before-NOT-NULL
-- precedent used for `tags.description` (20250210225102).
UPDATE questions
SET
  partial_credit = (grading_method = 'Internal')
WHERE
  partial_credit IS NULL;

ALTER TABLE questions
ADD CONSTRAINT questions_partial_credit_not_null CHECK (partial_credit IS NOT NULL) NOT VALID;

ALTER TABLE questions
ADD CONSTRAINT questions_show_correct_answer_not_null CHECK (show_correct_answer IS NOT NULL) NOT VALID;

ALTER TABLE questions
ADD CONSTRAINT questions_single_variant_not_null CHECK (single_variant IS NOT NULL) NOT VALID;
