-- Functional index on LOWER(uid) so that case-insensitive UID lookups
-- (see models/user.sql select_user_by_uid / select_or_insert_user_by_uid)
-- remain index-backed instead of degrading to a sequential scan.
-- The existing UNIQUE (uid) index only supports case-sensitive equality.
CREATE INDEX IF NOT EXISTS users_lower_uid_idx ON users (LOWER(uid));
