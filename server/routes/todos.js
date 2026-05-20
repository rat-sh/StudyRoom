import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// ── Helper: build full todo with members + per-user completions ────────────
async function buildTodo(id, requestingUserId) {
  const { data: todo, error } = await supabase
    .from('todos')
    .select(`id, title, description, created_at, creator:created_by(id, name, avatar_url)`)
    .eq('id', id)
    .single();
  if (error || !todo) return null;

  // Members list (includes creator automatically via insert on create)
  const { data: members } = await supabase
    .from('todo_members')
    .select(`user:user_id(id, name, avatar_url), added_at`)
    .eq('todo_id', id)
    .order('added_at', { ascending: true });

  // Completion states
  const { data: completions } = await supabase
    .from('todo_completions')
    .select(`user_id, completed_at`)
    .eq('todo_id', id);

  const completedSet = new Set((completions || []).map(c => c.user_id));
  const memberList = (members || []).map(m => ({
    ...m.user,
    completed: completedSet.has(m.user.id),
    completed_at: completions?.find(c => c.user_id === m.user.id)?.completed_at || null
  }));

  const totalMembers = memberList.length;
  const completedCount = memberList.filter(m => m.completed).length;

  return {
    ...todo,
    members: memberList,
    total_members: totalMembers,
    completed_count: completedCount,
    my_completed: completedSet.has(requestingUserId),
    completion_pct: totalMembers ? Math.round((completedCount / totalMembers) * 100) : 0
  };
}

// ── GET / — list all todos where I am creator or member ───────────────────
router.get('/', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    // Get todo IDs where I'm a member
    const { data: memberRows } = await supabase
      .from('todo_members')
      .select('todo_id')
      .eq('user_id', uid);

    const memberTodoIds = (memberRows || []).map(r => r.todo_id);

    // Get todos I created OR am a member of
    const { data: todos, error } = await supabase
      .from('todos')
      .select('id')
      .or(`created_by.eq.${uid}${memberTodoIds.length ? `,id.in.(${memberTodoIds.join(',')})` : ''}`)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Enrich each todo with members + completion
    const enriched = await Promise.all((todos || []).map(t => buildTodo(t.id, uid)));
    res.json(enriched.filter(Boolean));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST / — create a todo + add creator as first member ─────────────────
router.post('/', auth, async (req, res) => {
  const { title, description, member_ids = [] } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const uid = req.user.id;

  try {
    const { data: todo, error } = await supabase
      .from('todos')
      .insert([{ title: title.trim(), description: description?.trim() || null, created_by: uid }])
      .select('id')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Always add creator as first member
    const uniqueMembers = [...new Set([uid, ...member_ids])];
    await supabase.from('todo_members').insert(
      uniqueMembers.map(user_id => ({ todo_id: todo.id, user_id }))
    );

    const enriched = await buildTodo(todo.id, uid);
    // Broadcast new todo to all members via socket
    if (req.io) {
      uniqueMembers.forEach(memberId => {
        req.io.to(`user:${memberId}`).emit('todo-created', enriched);
      });
    }
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /:id/members — add a collaborator ───────────────────────────────
router.post('/:id/members', auth, async (req, res) => {
  const uid = req.user.id;
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    // Only creator can add members
    const { data: todo } = await supabase.from('todos').select('created_by').eq('id', req.params.id).single();
    if (!todo) return res.status(404).json({ error: 'Not found' });
    if (todo.created_by !== uid) return res.status(403).json({ error: 'Only creator can add members' });

    const { error } = await supabase.from('todo_members')
      .upsert({ todo_id: req.params.id, user_id }, { onConflict: 'todo_id,user_id' });
    if (error) return res.status(500).json({ error: error.message });

    const enriched = await buildTodo(req.params.id, uid);
    if (req.io) req.io.to(`todo:${req.params.id}`).emit('todo-updated', enriched);
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /:id/members/:userId — remove a collaborator ─────────────────
router.delete('/:id/members/:userId', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data: todo } = await supabase.from('todos').select('created_by').eq('id', req.params.id).single();
    if (!todo) return res.status(404).json({ error: 'Not found' });
    // Creator can remove anyone; users can remove themselves
    if (todo.created_by !== uid && req.params.userId !== uid)
      return res.status(403).json({ error: 'Forbidden' });

    await supabase.from('todo_members')
      .delete().eq('todo_id', req.params.id).eq('user_id', req.params.userId);
    // Also remove their completion state
    await supabase.from('todo_completions')
      .delete().eq('todo_id', req.params.id).eq('user_id', req.params.userId);

    const enriched = await buildTodo(req.params.id, uid);
    if (req.io) req.io.to(`todo:${req.params.id}`).emit('todo-updated', enriched);
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /:id/toggle — toggle MY OWN completion (independent per-user) ──
router.patch('/:id/toggle', auth, async (req, res) => {
  const uid = req.user.id;
  const todoId = req.params.id;

  try {
    // Check membership
    const { data: membership } = await supabase
      .from('todo_members').select('user_id').eq('todo_id', todoId).eq('user_id', uid).single();
    if (!membership) return res.status(403).json({ error: 'Not a member of this todo' });

    // Toggle: if completion exists → delete it (uncomplete), else insert (complete)
    const { data: existing } = await supabase
      .from('todo_completions').select('id').eq('todo_id', todoId).eq('user_id', uid).single();

    if (existing) {
      await supabase.from('todo_completions').delete().eq('id', existing.id);
    } else {
      await supabase.from('todo_completions').insert({ todo_id: todoId, user_id: uid });
    }

    const enriched = await buildTodo(todoId, uid);
    // Broadcast update to all members watching this todo
    if (req.io) req.io.to(`todo:${todoId}`).emit('todo-updated', enriched);
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /:id — delete todo (creator only) ──────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data: todo } = await supabase.from('todos').select('created_by').eq('id', req.params.id).single();
    if (!todo) return res.status(404).json({ error: 'Not found' });
    if (todo.created_by !== uid) return res.status(403).json({ error: 'Only creator can delete' });

    await supabase.from('todos').delete().eq('id', req.params.id);
    if (req.io) req.io.to(`todo:${req.params.id}`).emit('todo-deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /:id/members — get member list for a todo ────────────────────────
router.get('/:id/members', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const enriched = await buildTodo(req.params.id, uid);
    if (!enriched) return res.status(404).json({ error: 'Not found' });
    res.json(enriched.members);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
