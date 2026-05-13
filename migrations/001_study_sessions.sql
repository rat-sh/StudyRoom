-- ── StudyRoom Database Migration ──────────────────────────────────────────
-- Run these in Supabase SQL Editor

-- 1. Add access_mode to rooms (if not exists)
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'open';
-- Values: 'open' (anyone with code+pin) | 'authorized' (host must approve)

-- 2. Create study_sessions table
CREATE TABLE IF NOT EXISTS study_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_code     TEXT,
  room_name     TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  ended_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast per-user queries
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id
  ON study_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_study_sessions_ended_at
  ON study_sessions (ended_at DESC);

-- 3. Ensure rooms has expires_at (in case it's missing)
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 4. Optional: add topic index for lobby filtering
CREATE INDEX IF NOT EXISTS idx_rooms_topic
  ON rooms (topic)
  WHERE is_public = true;
