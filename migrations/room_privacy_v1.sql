-- Room Privacy System v1
-- Run this against your Supabase project

-- 1. Add visibility column (public | protected | private)
--    Mirrors old is_public:
--      is_public = true  → visibility = 'public'
--      is_public = false → visibility = 'private'
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('public', 'protected', 'private'));

-- Back-fill from legacy is_public
UPDATE rooms SET visibility = CASE WHEN is_public THEN 'public' ELSE 'private' END;

-- 2. Room access requests (for protected rooms)
CREATE TABLE IF NOT EXISTS room_access_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code    TEXT        NOT NULL,
  requester_id UUID        NOT NULL,  -- supabase user id
  owner_id     UUID        NOT NULL,  -- room creator
  status       TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected')),
  message      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rar_room  ON room_access_requests(room_code);
CREATE INDEX IF NOT EXISTS idx_rar_owner ON room_access_requests(owner_id);
