import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Helper: order IDs consistently so (A,B) and (B,A) map to the same row
function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// ── List all accepted friends + pending requests ───────────────────
router.get('/', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data, error } = await supabase
      .from('friends')
      .select(`
        id, status, requested_by, created_at,
        u1:user_id_1 ( id, name, email, avatar_url ),
        u2:user_id_2 ( id, name, email, avatar_url )
      `)
      .or(`user_id_1.eq.${uid},user_id_2.eq.${uid}`);
    if (error) return res.status(500).json({ error: error.message });

    // Normalise so "friend" is always the OTHER user
    const list = (data || []).map(row => {
      const friend = row.u1.id === uid ? row.u2 : row.u1;
      return {
        relationId: row.id,
        status: row.status,
        requested_by: row.requested_by,
        friend,
        created_at: row.created_at,
      };
    });
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Send a friend request ──────────────────────────────────────────
router.post('/request', auth, async (req, res) => {
  const { targetUserId } = req.body;
  const uid = req.user.id;
  if (!targetUserId || targetUserId === uid)
    return res.status(400).json({ error: 'Invalid target user' });

  const [u1, u2] = orderedPair(uid, targetUserId);
  try {
    // Check if already exists
    const { data: existing } = await supabase
      .from('friends')
      .select('id, status')
      .eq('user_id_1', u1)
      .eq('user_id_2', u2)
      .single();

    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
      return res.status(409).json({ error: 'Request already sent' });
    }

    const { data, error } = await supabase
      .from('friends')
      .insert([{ user_id_1: u1, user_id_2: u2, status: 'pending', requested_by: uid }])
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Accept a friend request ────────────────────────────────────────
router.post('/accept/:relationId', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data: row, error: fe } = await supabase
      .from('friends')
      .select('*')
      .eq('id', req.params.relationId)
      .single();
    if (fe || !row) return res.status(404).json({ error: 'Request not found' });
    // Only the non-requester can accept
    if (row.requested_by === uid) return res.status(403).json({ error: 'Cannot accept your own request' });
    if (row.user_id_1 !== uid && row.user_id_2 !== uid)
      return res.status(403).json({ error: 'Not your request' });

    const { error } = await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .eq('id', req.params.relationId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reject / remove a friend (pending or accepted) ─────────────────
router.delete('/:relationId', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data: row, error: fe } = await supabase
      .from('friends')
      .select('user_id_1, user_id_2')
      .eq('id', req.params.relationId)
      .single();
    if (fe || !row) return res.status(404).json({ error: 'Not found' });
    if (row.user_id_1 !== uid && row.user_id_2 !== uid)
      return res.status(403).json({ error: 'Not your relationship' });

    const { error } = await supabase
      .from('friends')
      .delete()
      .eq('id', req.params.relationId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
