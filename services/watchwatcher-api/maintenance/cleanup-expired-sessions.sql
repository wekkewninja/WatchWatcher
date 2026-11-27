DELETE FROM sessions
WHERE id IN (
  SELECT id FROM sessions
  WHERE expires_at <= clock_timestamp()
  ORDER BY expires_at
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
);

DELETE FROM deletion_receipts
WHERE session_hash IN (
  SELECT session_hash FROM deletion_receipts
  WHERE expires_at <= clock_timestamp()
  ORDER BY expires_at
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
);