import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// ── Get activity logs for last 6 months (grouped by month) ────────
router.get('/', auth, async (req, res) => {
  const uid = req.user.id;
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const { data, error } = await supabase
      .from('activity_logs')
      .select('duration_minutes, created_at')
      .eq('user_id', uid)
      .gte('created_at', sixMonthsAgo.toISOString())
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Group by month label (e.g. "Jan", "Feb")
    const monthMap = {};
    (data || []).forEach(log => {
      const d = new Date(log.created_at);
      const label = d.toLocaleString('en', { month: 'short' });
      monthMap[label] = (monthMap[label] || 0) + (log.duration_minutes || 0);
    });

    // Build ordered array for the last 6 calendar months
    const result = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleString('en', { month: 'short' });
      result.push({ month: label, minutes: monthMap[label] || 0 });
    }

    // Total hours
    const totalMinutes = (data || []).reduce((s, r) => s + (r.duration_minutes || 0), 0);
    res.json({ chart: result, totalHours: +(totalMinutes / 60).toFixed(1) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Internal: log a session (called by socket disconnect handler) ──
// Not a public HTTP route — exported as a helper so socket/core.js
// can import and call it directly without going through HTTP.
export async function logActivity(userId, durationMinutes, roomCode) {
  if (!userId || durationMinutes < 1) return;
  try {
    await supabase.from('activity_logs').insert([{
      user_id: userId,
      duration_minutes: Math.round(durationMinutes),
      room_code: roomCode || null,
    }]);
  } catch { /* silent — never crash the socket */ }
}

export default router;
