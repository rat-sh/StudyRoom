import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import supabase from '../supabase.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'studyroom-secret';

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users')
      .insert([{ name, email, password_hash: hash }])
      .select('id,name,email').single();
    if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'Email already exists' : error.message });
    // Return success WITHOUT a token — force them to log in
    res.json({ success: true, message: 'Account created! Please log in.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'All fields required' });
    const { data: user, error } = await supabase.from('users').select('*').eq('email', email).single();
    if (error || !user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

export default router;
