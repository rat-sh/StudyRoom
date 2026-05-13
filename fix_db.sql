ALTER TABLE rooms ADD COLUMN IF NOT EXISTS access_mode text DEFAULT 'open';
