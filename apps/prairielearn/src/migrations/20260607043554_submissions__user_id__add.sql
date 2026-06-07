-- Add a nullable `user_id` column to `submissions`, mirroring `variants.user_id`.
--
-- Until now, `submissions` only had `auth_user_id`, which records the
-- *authenticated* (real) user who performed the submission action. When an
-- instructor submits under a different *effective* user, `auth_user_id` is the
-- real user, so the submission's owning user was not recorded on the row (it was
-- only recoverable via `variants.user_id`). This column lets a submission record
-- its owning (effective) user directly, the same way `variants` already does.
--
-- The column is nullable (not backfilled, no NOT NULL): like `variants.user_id`,
-- it is NULL for group/team submissions, and existing rows pre-date the feature.
ALTER TABLE submissions
ADD COLUMN user_id BIGINT;

ALTER TABLE submissions
ADD FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE;
