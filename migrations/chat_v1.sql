-- ═══════════════════════════════════════════════════════════════════
-- STUDYROOM — Chat System v1 Migration
-- Adapted from GrouPMeet's architecture (MongoDB → Supabase)
-- Run this in your Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. Chats (DMs + Group chats)
CREATE TABLE IF NOT EXISTS chats (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group      boolean NOT NULL DEFAULT false,
  name          text,                        -- group chat name only
  avatar_url    text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  last_message_at timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);

-- 2. Chat participants (many-to-many)
CREATE TABLE IF NOT EXISTS chat_participants (
  chat_id   uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin  boolean DEFAULT false,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- 3. Messages
CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        text DEFAULT '',
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  attachments text[] DEFAULT '{}',
  is_deleted  boolean DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- 4. Read receipts
CREATE TABLE IF NOT EXISTS message_reads (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     timestamptz DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- 5. Emoji reactions
CREATE TABLE IF NOT EXISTS message_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_chat ON chat_participants(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_msg ON message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(message_id);

-- Function: get unread count per chat for a user
CREATE OR REPLACE FUNCTION unread_count(p_chat_id uuid, p_user_id uuid)
RETURNS bigint AS $$
  SELECT COUNT(*)
  FROM messages m
  WHERE m.chat_id = p_chat_id
    AND m.sender_id != p_user_id
    AND m.is_deleted = false
    AND NOT EXISTS (
      SELECT 1 FROM message_reads r
      WHERE r.message_id = m.id AND r.user_id = p_user_id
    );
$$ LANGUAGE sql STABLE;
