-- BLOCK select_variant_by_id
SELECT
  *
FROM
  variants
WHERE
  id = $variant_id;
