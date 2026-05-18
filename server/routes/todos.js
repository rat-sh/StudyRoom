import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// ── List todos (own + shared with me) ─────────────────────────────
router.get('/', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data, error } = await supabase
      .from('todos')
      .select(`
        id, title, is_completed, created_at, shared_with_user_id,
        creator:created_by ( id, name, avatar_url ),
        shared_with:shared_with_user_id ( id, name, avatar_url )
      `)
      .or(`created_by.eq.${uid},shared_with_user_id.eq.${uid}`)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Create a todo ──────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  const { title, shared_with_user_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
  try {
    const { data, error } = await supabase
      .from('todos')
      .insert([{
        title: title.trim(),
        created_by: req.user.id,
        shared_with_user_id: shared_with_user_id || null,
      }])
      .select(`
        id, title, is_completed, created_at, shared_with_user_id,
        creator:created_by ( id, name, avatar_url ),
        shared_with:shared_with_user_id ( id, name, avatar_url )
      `)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Toggle completion ──────────────────────────────────────────────
router.patch('/:id/toggle', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data: todo, error: fe } = await supabase
      .from('todos')
      .select('id, is_completed, created_by, shared_with_user_id')
      .eq('id', req.params.id)
      .single();
    if (fe || !todo) return res.status(404).json({ error: 'Not found' });
    // Only creator or the person it's shared with can toggle
    if (todo.created_by !== uid && todo.shared_with_user_id !== uid)
      return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await supabase
      .from('todos')
      .update({ is_completed: !todo.is_completed })
      .eq('id', req.params.id)
      .select('id, is_completed')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Delete a todo ──────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data: todo, error: fe } = await supabase
      .from('todos')
      .select('created_by')
      .eq('id', req.params.id)
      .single();
    if (fe || !todo) return res.status(404).json({ error: 'Not found' });
    if (todo.created_by !== uid)
      return res.status(403).json({ error: 'Only the creator can delete' });

    const { error } = await supabase.from('todos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
