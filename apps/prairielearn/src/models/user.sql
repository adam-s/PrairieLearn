-- BLOCK select_user_by_id
SELECT
  *
FROM
  users
WHERE
  id = $user_id;

-- BLOCK select_user_by_uid
-- UIDs are email-like and may differ only by case between identity providers and
-- instructor-entered values (issue #5757), so match case-insensitively. Backed by
-- the users_lower_uid_idx functional index to stay index-scan, not seq-scan.
SELECT
  *
FROM
  users
WHERE
  LOWER(uid) = LOWER($uid)
-- Prefer an exact-case match (backward compatible), then the oldest row, so the
-- result is deterministic even if legacy data has rows differing only by case.
ORDER BY
  (uid = $uid) DESC,
  id ASC
LIMIT
  1;

-- BLOCK select_user_by_uin
SELECT
  *
FROM
  users
WHERE
  uin = $uin
  AND institution_id = $institution_id;

-- BLOCK select_and_lock_user_by_id
SELECT
  *
FROM
  users
WHERE
  id = $user_id
FOR NO KEY UPDATE;

-- BLOCK select_or_insert_user_by_uid
-- Match an existing user case-insensitively (issue #5757) so that adding staff or
-- students with a differently-cased UID reuses the existing user instead of
-- creating a duplicate orphan row. A brand-new user is still inserted with the
-- UID exactly as provided. LOWER(uid) is backed by users_lower_uid_idx.
WITH
  existing_user AS (
    SELECT
      *
    FROM
      users
    WHERE
      LOWER(uid) = LOWER($uid)
    -- Prefer an exact-case match, then the oldest row, so a brand-new user is
    -- inserted only when no case-insensitive match exists, and the result stays
    -- deterministic even with legacy rows differing only by case.
    ORDER BY
      (uid = $uid) DESC,
      id ASC
    LIMIT
      1
  ),
  inserted_user AS (
    INSERT INTO
      users (uid)
    SELECT
      $uid
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          existing_user
      )
    RETURNING
      *
  )
SELECT
  *
FROM
  existing_user
UNION ALL
SELECT
  *
FROM
  inserted_user;

-- BLOCK update_user_uid
UPDATE users
SET
  uid = $uid
WHERE
  id = $user_id
RETURNING
  *;

-- BLOCK insert_user
INSERT INTO
  users (uid, name, email)
VALUES
  ($uid, $name, $email)
ON CONFLICT DO NOTHING
RETURNING
  *;
