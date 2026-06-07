-- Add length limits to the color columns on `tags`, `topics`, and
-- `assessment_sets`. These columns store one of a fixed palette of color names
-- (see `ColorJsonSchema` in `schemas/infoCourse.ts`), whose longest value is
-- `turquoise1` (10 characters). The only writer is the sync code, which always
-- supplies an enum value (or the implicit `gray1`/`red3` fallback), so no
-- existing or future row can exceed a generous 100-character bound. This
-- continues the "put (generous) limits on everything" effort (see #7518) using
-- the same scheme already applied to `course_requests.note` and
-- `course_instance_publishing_extensions.name`.
--
-- Added in two phases for a zero-downtime deploy: first `NOT VALID` (instant, no
-- table scan, enforced for new/updated rows), then `VALIDATE CONSTRAINT` in
-- later per-table migrations.

ALTER TABLE tags
ADD CONSTRAINT tags_color_length_check CHECK (char_length(color) <= 100) NOT VALID;

ALTER TABLE topics
ADD CONSTRAINT topics_color_length_check CHECK (char_length(color) <= 100) NOT VALID;

ALTER TABLE assessment_sets
ADD CONSTRAINT assessment_sets_color_length_check CHECK (char_length(color) <= 100) NOT VALID;
