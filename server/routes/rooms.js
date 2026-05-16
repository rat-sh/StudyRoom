import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';

const router = express.Router();

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 6}, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

router.post('/create', auth, async (req, res) => {
  try {
    const { name, is_public, topic, max_members } = req.body;
    const code = genCode();
    const pin = genPin();
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('rooms')
      .insert([{
        name: name || 'Study Room',
        code, pin,
        is_public: is_public || false,
        topic: topic || 'General',
        max_members: max_members || 10,
        created_by: req.user.id,
        expires_at
      }])
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/validate', async (req, res) => {
  try {
    const { code, pin } = req.body;
    const { data, error } = await supabase.from('rooms').select('*').eq('code', code.toUpperCase()).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Room expired' });
    if (data.pin !== pin) return res.status(401).json({ error: 'Wrong PIN' });
    res.json({ code: data.code, name: data.name, topic: data.topic });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/join-public', async (req, res) => {
  try {
    const { code } = req.body;
    const { data, error } = await supabase.from('rooms').select('*').eq('code', code.toUpperCase()).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    if (!data.is_public) return res.status(403).json({ error: 'Room is private' });
    if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Room expired' });
    res.json({ code: data.code, name: data.name, topic: data.topic });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/mine', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('rooms').select('*')
      .eq('created_by', req.user.id)
      .order('created_at', { ascending: false }).limit(20);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET room info (for in-room share panel) ────────────────────
// Returns public info always; returns PIN only for the room creator.
router.get('/info/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { data, error } = await supabase.from('rooms').select('*').eq('code', code).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Room expired' });

    // Check if requester is the creator (optional auth header)
    const authHeader = req.headers.authorization;
    let isCreator = false;
    if (authHeader) {
      try {
        const jwt = (await import('jsonwebtoken')).default;
        const JWT_SECRET = process.env.JWT_SECRET || 'studyroom-secret';
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        isCreator = decoded.id === data.created_by;
      } catch { /* not authenticated or bad token — fine, just skip pin */ }
    }

    res.json({
      code: data.code,
      name: data.name,
      topic: data.topic,
      is_public: data.is_public,
      expires_at: data.expires_at,
      // Only expose PIN to the room creator
      pin: isCreator ? data.pin : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE room (creator only) ─────────────────────────────────
router.delete('/:code', auth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    // Verify the room belongs to the authenticated user
    const { data, error } = await supabase.from('rooms').select('id, created_by').eq('code', code).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    if (data.created_by !== req.user.id) return res.status(403).json({ error: 'Only the creator can delete this room' });

    const { error: delError } = await supabase.from('rooms').delete().eq('code', code);
    if (delError) return res.status(500).json({ error: delError.message });
    res.json({ success: true, message: 'Room deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
