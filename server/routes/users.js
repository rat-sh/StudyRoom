import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// ── Search users by name or email (for friend search) ─────────────
router.get('/search', auth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, avatar_url')
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .neq('id', req.user.id)
      .limit(10);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Get own profile ────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, avatar_url, created_at')
      .eq('id', req.user.id)
      .single();
    if (error) return res.status(404).json({ error: 'User not found' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Update avatar URL ──────────────────────────────────────────────
// Expects client to first upload to Supabase Storage directly, then
// POST the resulting public URL here to persist it on the user record.
router.post('/avatar', auth, async (req, res) => {
  const { avatar_url } = req.body;
  if (!avatar_url) return res.status(400).json({ error: 'avatar_url required' });
  try {
    const { error } = await supabase
      .from('users')
      .update({ avatar_url })
      .eq('id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, avatar_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Delete avatar (set to null) ────────────────────────────────────
router.delete('/avatar', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('users')
      .update({ avatar_url: null })
      .eq('id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
