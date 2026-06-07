-- Having both `id` and `session_id` on `user_sessions` is confusing. Rename
-- `session_id` to `key` (the opaque session key from the signed cookie); `id`
-- remains the surrogate primary key.
ALTER TABLE user_sessions
RENAME COLUMN session_id TO key;

-- `RENAME COLUMN` updates the column references inside the unique index but not
-- the constraint/index identifier itself, which would otherwise be left as the
-- stale `user_sessions_session_id_key`. Rename it to match the new column.
ALTER TABLE user_sessions
RENAME CONSTRAINT user_sessions_session_id_key TO user_sessions_key_key;
