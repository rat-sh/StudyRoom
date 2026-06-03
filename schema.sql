-- STUDYROOM — Optimized Database Schema (last updated: 2026-06-03)

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Enums
DO $$ BEGIN
  CREATE TYPE user_role         AS ENUM ('user', 'moderator', 'admin');
  CREATE TYPE user_status       AS ENUM ('online', 'away', 'busy', 'offline');
  CREATE TYPE room_visibility   AS ENUM ('public', 'protected', 'private');
  CREATE TYPE friend_status     AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
  CREATE TYPE request_status    AS ENUM ('pending', 'accepted', 'rejected');
  CREATE TYPE room_member_role  AS ENUM ('owner', 'moderator', 'member');
  CREATE TYPE task_status       AS ENUM ('backlog', 'todo', 'in_progress', 'done', 'archived');
  CREATE TYPE task_priority     AS ENUM ('none', 'low', 'medium', 'high', 'urgent');
  CREATE TYPE tag_scope         AS ENUM ('global', 'room', 'personal');
  CREATE TYPE notif_type        AS ENUM (
    'friend_request', 'friend_accept',
    'room_invite', 'room_request_accepted', 'room_request_rejected',
    'task_assigned', 'task_completed', 'task_commented',
    'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text          NOT NULL CHECK (char_length(name) BETWEEN 2 AND 64),
  email           text          UNIQUE NOT NULL CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  password_hash   text          NOT NULL,
  avatar_url      text,
  bio             text          CHECK (char_length(bio) <= 500),
  role            user_role     NOT NULL DEFAULT 'user',
  status          user_status   NOT NULL DEFAULT 'offline',
  is_verified     boolean       NOT NULL DEFAULT false,
  is_active       boolean       NOT NULL DEFAULT true,
  last_seen_at    timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);


ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS status user_status NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS users_email_idx     ON users(email)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_role_idx      ON users(role)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_active_idx    ON users(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_name_trgm_idx ON users USING gin(name gin_trgm_ops);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_users" ON users;
CREATE POLICY "service_all_users" ON users FOR ALL USING (true);


-- 2. USER SESSIONS
CREATE TABLE IF NOT EXISTS user_sessions (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text          UNIQUE NOT NULL,
  device_info   text,
  ip_address    inet,
  expires_at    timestamptz   NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx    ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON user_sessions(expires_at);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_sessions" ON user_sessions;
CREATE POLICY "service_all_sessions" ON user_sessions FOR ALL USING (true);


-- 3. ROOMS
CREATE TABLE IF NOT EXISTS rooms (
  id            uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text            NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  slug          text            UNIQUE DEFAULT NULL,
  code          text            UNIQUE NOT NULL CHECK (code ~ '^[A-Z0-9]{6,10}$'),
  pin           char(4)         NOT NULL DEFAULT '0000' CHECK (pin ~ '^\d{4}$'),
  visibility    room_visibility NOT NULL DEFAULT 'private',
  -- is_public kept for backwards compat with lobby.js / rooms.js
  is_public     boolean         GENERATED ALWAYS AS (visibility = 'public') STORED,
  topic         text            NOT NULL DEFAULT 'General',
  description   text            CHECK (char_length(description) <= 1000),
  max_members   int             NOT NULL DEFAULT 10 CHECK (max_members BETWEEN 1 AND 100),
  created_by    uuid            REFERENCES users(id) ON DELETE SET NULL,
  owner_id      uuid            REFERENCES users(id) ON DELETE SET NULL,
  is_active     boolean         NOT NULL DEFAULT true,
  expires_at    timestamptz     NOT NULL,
  deleted_at    timestamptz,
  created_at    timestamptz     NOT NULL DEFAULT now(),
  updated_at    timestamptz     NOT NULL DEFAULT now()
);


ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS slug text UNIQUE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS visibility room_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS rooms_code_idx       ON rooms(code)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS rooms_slug_idx       ON rooms(slug)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS rooms_visibility_idx ON rooms(visibility) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS rooms_owner_idx      ON rooms(owner_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS rooms_expires_idx    ON rooms(expires_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS rooms_name_trgm_idx  ON rooms USING gin(name gin_trgm_ops);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_rooms" ON rooms;
CREATE POLICY "service_all_rooms" ON rooms FOR ALL USING (true);


-- 4. ROOM MEMBERS
CREATE TABLE IF NOT EXISTS room_members (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid              NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id         uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            room_member_role  NOT NULL DEFAULT 'member',
  is_muted        boolean           NOT NULL DEFAULT false,
  joined_at       timestamptz       NOT NULL DEFAULT now(),
  last_active_at  timestamptz,
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS rm_room_idx ON room_members(room_id);
CREATE INDEX IF NOT EXISTS rm_user_idx ON room_members(user_id);
CREATE INDEX IF NOT EXISTS rm_role_idx ON room_members(room_id, role);

ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_rm" ON room_members;
CREATE POLICY "service_all_rm" ON room_members FOR ALL USING (true);


-- 5. ROOM ACCESS REQUESTS
-- room_code kept for backwards compat with rooms.js (request-join, respond-request)
CREATE TABLE IF NOT EXISTS room_access_requests (
  id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid            REFERENCES rooms(id) ON DELETE CASCADE,
  room_code       text            NOT NULL,   -- kept: rooms.js queries by code
  requester_id    uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id        uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_by     uuid            REFERENCES users(id) ON DELETE SET NULL,
  status          request_status  NOT NULL DEFAULT 'pending',
  message         text            CHECK (char_length(message) <= 500),
  review_note     text,
  reviewed_at     timestamptz,
  created_at      timestamptz     NOT NULL DEFAULT now(),
  UNIQUE(room_code, requester_id)
);


ALTER TABLE room_access_requests
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS rar_room_idx      ON room_access_requests(room_id);
CREATE INDEX IF NOT EXISTS rar_code_idx      ON room_access_requests(room_code);
CREATE INDEX IF NOT EXISTS rar_requester_idx ON room_access_requests(requester_id);
CREATE INDEX IF NOT EXISTS rar_owner_idx     ON room_access_requests(owner_id);
CREATE INDEX IF NOT EXISTS rar_status_idx    ON room_access_requests(status) WHERE status = 'pending';

ALTER TABLE room_access_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_rar" ON room_access_requests;
CREATE POLICY "service_all_rar" ON room_access_requests FOR ALL USING (true);


-- 6. ROOM BANS
CREATE TABLE IF NOT EXISTS room_bans (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid        NOT NULL REFERENCES rooms(id)  ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  banned_by     uuid        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  reason        text        CHECK (char_length(reason) <= 500),
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS bans_room_idx ON room_bans(room_id);
CREATE INDEX IF NOT EXISTS bans_user_idx ON room_bans(user_id);

ALTER TABLE room_bans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_bans" ON room_bans;
CREATE POLICY "service_all_bans" ON room_bans FOR ALL USING (true);


-- 7. FRIENDS
-- Keeps user_id_1 / user_id_2 / requested_by for friends.js + rooms.js compat
-- Adds sender_id / receiver_id as aliases via view
CREATE TABLE IF NOT EXISTS friends (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_1     uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2     uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        friend_status NOT NULL DEFAULT 'pending',
  requested_by  uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responded_at  timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT friends_no_self CHECK (user_id_1 <> user_id_2),
  CONSTRAINT friends_canonical CHECK (user_id_1 < user_id_2),
  UNIQUE(user_id_1, user_id_2)
);


ALTER TABLE friends
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;

CREATE INDEX IF NOT EXISTS friends_user1_idx  ON friends(user_id_1);
CREATE INDEX IF NOT EXISTS friends_user2_idx  ON friends(user_id_2);
CREATE INDEX IF NOT EXISTS friends_status_idx ON friends(status) WHERE status = 'pending';

ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_friends" ON friends;
CREATE POLICY "service_all_friends" ON friends FOR ALL USING (true);


-- 8. FRIEND BLOCKS
CREATE TABLE IF NOT EXISTS friend_blocks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id),
  UNIQUE(blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS blocks_blocker_idx ON friend_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON friend_blocks(blocked_id);

ALTER TABLE friend_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_blocks" ON friend_blocks;
CREATE POLICY "service_all_blocks" ON friend_blocks FOR ALL USING (true);


-- 9. TODOS (thin wrapper — keeps todos.js working as-is)
CREATE TABLE IF NOT EXISTS todos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
  description   text,
  is_completed  boolean     NOT NULL DEFAULT false,
  created_by    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);


ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS todos_user_idx ON todos(created_by) WHERE deleted_at IS NULL;

ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_todos" ON todos;
CREATE POLICY "service_all_todos" ON todos FOR ALL USING (true);


-- 10. TODO MEMBERS
CREATE TABLE IF NOT EXISTS todo_members (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id   uuid        NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(todo_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_todo_members_todo ON todo_members(todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_members_user ON todo_members(user_id);

ALTER TABLE todo_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_todo_members" ON todo_members;
CREATE POLICY "service_all_todo_members" ON todo_members FOR ALL USING (true);


-- 11. TODO COMPLETIONS
CREATE TABLE IF NOT EXISTS todo_completions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id       uuid        NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(todo_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_todo_completions_todo ON todo_completions(todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_completions_user ON todo_completions(user_id);

ALTER TABLE todo_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_todo_completions" ON todo_completions;
CREATE POLICY "service_all_todo_completions" ON todo_completions FOR ALL USING (true);


-- 12. TASKS (advanced kanban — future migration from todos)
CREATE TABLE IF NOT EXISTS tasks (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id       uuid          REFERENCES rooms(id) ON DELETE SET NULL,
  title         text          NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
  description   text,
  status        task_status   NOT NULL DEFAULT 'todo',
  priority      task_priority NOT NULL DEFAULT 'none',
  position      int           NOT NULL DEFAULT 0,
  due_at        timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_creator_idx     ON tasks(created_by)             WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_room_idx        ON tasks(room_id)                WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_status_idx      ON tasks(status)                 WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_due_idx         ON tasks(due_at)                 WHERE deleted_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_room_status_idx ON tasks(room_id, status, priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx  ON tasks USING gin(title gin_trgm_ops);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_tasks" ON tasks;
CREATE POLICY "service_all_tasks" ON tasks FOR ALL USING (true);


-- 13. TASK ASSIGNMENTS
CREATE TABLE IF NOT EXISTS task_assignments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, user_id)
);

CREATE INDEX IF NOT EXISTS ta_task_idx ON task_assignments(task_id);
CREATE INDEX IF NOT EXISTS ta_user_idx ON task_assignments(user_id);

ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_ta" ON task_assignments;
CREATE POLICY "service_all_ta" ON task_assignments FOR ALL USING (true);


-- 14. TASK COMPLETIONS
CREATE TABLE IF NOT EXISTS task_completions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note          text        CHECK (char_length(note) <= 500),
  completed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, user_id)
);

CREATE INDEX IF NOT EXISTS tc_task_idx ON task_completions(task_id);
CREATE INDEX IF NOT EXISTS tc_user_idx ON task_completions(user_id);

ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_tc" ON task_completions;
CREATE POLICY "service_all_tc" ON task_completions FOR ALL USING (true);


-- 15. TASK COMMENTS
CREATE TABLE IF NOT EXISTS task_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tcom_task_idx ON task_comments(task_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tcom_user_idx ON task_comments(user_id) WHERE deleted_at IS NULL;

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_tcom" ON task_comments;
CREATE POLICY "service_all_tcom" ON task_comments FOR ALL USING (true);


-- 16. TAGS
CREATE TABLE IF NOT EXISTS tags (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  color       text        NOT NULL DEFAULT '#6366f1' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  scope       tag_scope   NOT NULL DEFAULT 'personal',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tags_user_idx  ON tags(created_by);
CREATE INDEX IF NOT EXISTS tags_scope_idx ON tags(scope);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_tags" ON tags;
CREATE POLICY "service_all_tags" ON tags FOR ALL USING (true);


-- 17. TASK TAGS
CREATE TABLE IF NOT EXISTS task_tags (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE INDEX IF NOT EXISTS tt_tag_idx ON task_tags(tag_id);

ALTER TABLE task_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_tt" ON task_tags;
CREATE POLICY "service_all_tt" ON task_tags FOR ALL USING (true);


-- 18. ACTIVITY LOGS
-- room_code kept for socket/core.js + activity.js compat; room_id added for FK integrity
CREATE TABLE IF NOT EXISTS activity_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id           uuid        REFERENCES rooms(id) ON DELETE SET NULL,
  room_code         text,       -- kept: socket/core.js and activity.js log by code
  duration_minutes  int         NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  source            text        NOT NULL DEFAULT 'session'
                                CHECK (source IN ('session', 'manual', 'import')),
  metadata          jsonb       DEFAULT '{}',
  log_date          date        NOT NULL DEFAULT CURRENT_DATE,
  created_at        timestamptz NOT NULL DEFAULT now()
);


ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'session' CHECK (source IN ('session', 'manual', 'import')),
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS log_date date NOT NULL DEFAULT CURRENT_DATE;

CREATE INDEX IF NOT EXISTS al_user_idx      ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS al_room_idx      ON activity_logs(room_id);
CREATE INDEX IF NOT EXISTS al_date_idx      ON activity_logs(log_date);
CREATE INDEX IF NOT EXISTS al_user_date_idx ON activity_logs(user_id, log_date);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_activity" ON activity_logs;
CREATE POLICY "service_all_activity" ON activity_logs FOR ALL USING (true);


-- 19. AUDIT LOGS (append-only)
CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
  entity_type   text        NOT NULL,
  entity_id     uuid        NOT NULL,
  action        text        NOT NULL CHECK (action IN (
                              'created','updated','deleted','restored',
                              'banned','unbanned','transferred','joined','left',
                              'accepted','rejected'
                            )),
  before_data   jsonb,
  after_data    jsonb,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aud_actor_idx  ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS aud_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS aud_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS aud_time_idx   ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_aud" ON audit_logs;
CREATE POLICY "service_all_aud" ON audit_logs FOR ALL USING (true);

CREATE OR REPLACE RULE audit_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;


-- 20. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
  type          notif_type  NOT NULL,
  entity_type   text,
  entity_id     uuid,
  payload       jsonb       DEFAULT '{}',
  is_read       boolean     NOT NULL DEFAULT false,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notif_user_idx   ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notif_unread_idx ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS notif_entity_idx ON notifications(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS notif_time_idx   ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_notif" ON notifications;
CREATE POLICY "service_all_notif" ON notifications FOR ALL USING (true);


-- Auto-update triggers
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','rooms','tasks'] LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
      CREATE TRIGGER trg_%1$s_updated_at
        BEFORE UPDATE ON %1$s
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    ', t);
  END LOOP;
END $$;


-- Views
CREATE OR REPLACE VIEW v_active_rooms AS
SELECT r.*, u.name AS owner_name, u.avatar_url AS owner_avatar
FROM   rooms r
LEFT JOIN users u ON u.id = r.owner_id
WHERE  r.deleted_at IS NULL
AND    r.is_active  = true
AND    r.expires_at > now()
AND    r.visibility IN ('public','protected');

-- Bidirectional friendships view (matches friends.js getFriendIds pattern)
CREATE OR REPLACE VIEW v_friendships AS
SELECT user_id_1 AS user_id, user_id_2 AS friend_id, status, requested_by, created_at FROM friends
UNION ALL
SELECT user_id_2 AS user_id, user_id_1 AS friend_id, status, requested_by, created_at FROM friends;

CREATE OR REPLACE VIEW v_user_task_summary AS
SELECT   created_by AS user_id, status, count(*) AS total
FROM     tasks
WHERE    deleted_at IS NULL
GROUP BY created_by, status;


-- Cleanup functions (schedule via pg_cron or Edge Functions)
CREATE OR REPLACE FUNCTION purge_expired_sessions()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM user_sessions WHERE expires_at < now();
$$;

CREATE OR REPLACE FUNCTION purge_old_rooms()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM rooms WHERE deleted_at < now() - interval '30 days';
$$;

CREATE OR REPLACE FUNCTION purge_old_users()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM users WHERE deleted_at < now() - interval '90 days';
$$;


NOTIFY pgrst;

-- ─── Storage / non-SQL notes ─────────────────────────────────────────────────
-- MongoDB:     Chat, ChatUser, Message → server/models/chat.js
--              Media                   → server/models/media.js
-- In-memory:   Timer, Whiteboard
-- External:    Chess (Stockfish), Music (YouTube Data API)
-- Storage:     "room-files" bucket     → server/routes/features/files.js