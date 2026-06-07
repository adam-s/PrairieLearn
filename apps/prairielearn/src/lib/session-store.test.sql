-- BLOCK select_user_session_by_key
SELECT
  *
FROM
  user_sessions
WHERE
  key = $key;
