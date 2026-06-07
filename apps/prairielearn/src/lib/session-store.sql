-- BLOCK get_session
SELECT
  *
FROM
  user_sessions
WHERE
  key = $key
  AND expires_at > now()
  AND revoked_at IS NULL;

-- BLOCK set_session
INSERT INTO
  user_sessions (key, user_id, data, updated_at, expires_at)
VALUES
  (
    $key,
    $user_id,
    $data::jsonb,
    now(),
    $expires_at
  )
ON CONFLICT (key) DO UPDATE
SET
  user_id = $user_id,
  data = $data::jsonb,
  updated_at = now(),
  expires_at = $expires_at;

-- BLOCK destroy_session
UPDATE user_sessions
SET
  revoked_at = now()
WHERE
  key = $key;
