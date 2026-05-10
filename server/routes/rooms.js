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

export default router;
