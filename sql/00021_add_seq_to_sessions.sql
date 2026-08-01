-- Manual display ordering for sessions. `seq` ascending is the display order,
-- rewritten wholesale when the user drags to reorder.
ALTER TABLE sessions ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;

-- Seed so the existing newest-first order is preserved: the newest session gets
-- seq 0, the next 1, and so on, per user. Deterministic tie-break by id so the
-- seeding is stable.
UPDATE sessions SET seq = (
  SELECT COUNT(*) FROM sessions s2
  WHERE s2.user_id = sessions.user_id
    AND (s2.started_at > sessions.started_at
         OR (s2.started_at = sessions.started_at AND s2.id > sessions.id))
);
