-- ═══════════════════════════════════════════════════════════════════
-- STUDYROOM — Todo System v2 Migration
-- Run this in your Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. Keep the existing todos table, add a group/description field
ALTER TABLE todos ADD COLUMN IF NOT EXISTS description text;

-- 2. todo_members — unlimited collaborators per task
-- Each row = one user who is a member of a todo
CREATE TABLE IF NOT EXISTS todo_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id     uuid NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at    timestamptz DEFAULT now(),
  UNIQUE(todo_id, user_id)
);

-- 3. todo_completions — per-user independent completion state
-- Each row = one user marking one task done
CREATE TABLE IF NOT EXISTS todo_completions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id     uuid NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at timestamptz DEFAULT now(),
  UNIQUE(todo_id, user_id)
);

-- Enable RLS
ALTER TABLE todo_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_completions ENABLE ROW LEVEL SECURITY;

-- RLS: todo_members — visible to anyone who is a member or creator
CREATE POLICY "members can see todo members"
  ON todo_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM todos t
      WHERE t.id = todo_id
        AND (t.created_by = auth.uid() OR user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM todo_members tm2 WHERE tm2.todo_id = t.id AND tm2.user_id = auth.uid()))
    )
  );

CREATE POLICY "creator can manage members"
  ON todo_members FOR ALL
  USING (
    EXISTS (SELECT 1 FROM todos t WHERE t.id = todo_id AND t.created_by = auth.uid())
  );

-- RLS: todo_completions — users manage their own completion state
CREATE POLICY "user manages own completion"
  ON todo_completions FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "members can read completions"
  ON todo_completions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM todo_members tm WHERE tm.todo_id = todo_id AND tm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM todos t WHERE t.id = todo_id AND t.created_by = auth.uid()
    )
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_todo_members_todo ON todo_members(todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_members_user ON todo_members(user_id);
CREATE INDEX IF NOT EXISTS idx_todo_completions_todo ON todo_completions(todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_completions_user ON todo_completions(user_id);
