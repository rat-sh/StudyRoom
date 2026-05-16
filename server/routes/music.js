// server/routes/music.js
// GET /api/music/search?q=<query>
// Returns { videoId, title, channel, thumbnail, duration } or 404

import express from 'express';
import axios   from 'axios';

const router = express.Router();

const YT_SEARCH = 'https://www.googleapis.com/youtube/v3/search';
const YT_VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';

// Convert ISO 8601 duration (PT3M45S) → seconds
function parseDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) +
         (parseInt(m[2] || 0) * 60)  +
          parseInt(m[3] || 0);
}

// Simple ranking so we prefer official/audio uploads
function rankScore(item) {
  const t = item.snippet.title.toLowerCase();
  const c = item.snippet.channelTitle.toLowerCase();
  let s = 0;
  if (t.includes('official'))  s += 5;
  if (t.includes('audio'))     s += 3;
  if (t.includes('video'))     s += 2;
  if (t.includes('live'))      s -= 3;
  if (t.includes('cover'))     s -= 4;
  if (t.includes('remix'))     s -= 2;
  if (t.includes('nightcore')) s -= 5;
  if (c.includes('vevo'))      s += 4;
  if (c.includes('official'))  s += 2;
  return s;
}

function cleanTitle(title) {
  return title
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();
}

router.get('/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing query' });

  const key = process.env.YT_API_KEY;
  if (!key) return res.status(500).json({ error: 'YT_API_KEY not configured' });

  try {
    // ── Step 1: Search ──────────────────────────────────────
    const searchRes = await axios.get(YT_SEARCH, {
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        videoCategoryId: 10, // Music
        maxResults: 5,
        key,
      },
    });

    const items = searchRes.data.items || [];
    if (!items.length) return res.status(404).json({ error: 'No results' });

    // Sort by our ranking heuristic
    items.sort((a, b) => rankScore(b) - rankScore(a));
    const best = items[0];
    const videoId = best.id.videoId;

    // ── Step 2: Fetch duration from Videos endpoint ─────────
    const videoRes = await axios.get(YT_VIDEOS, {
      params: {
        part: 'contentDetails,snippet',
        id: videoId,
        key,
      },
    });

    const vItem = videoRes.data.items?.[0];
    const duration = vItem
      ? parseDuration(vItem.contentDetails?.duration)
      : 0;

    return res.json({
      videoId,
      title:     cleanTitle(best.snippet.title),
      channel:   best.snippet.channelTitle,
      thumbnail: best.snippet.thumbnails?.medium?.url || '',
      duration,  // seconds
      url:       `https://www.youtube.com/watch?v=${videoId}`,
    });

  } catch (err) {
    console.error('Music search error:', err.message);
    return res.status(500).json({ error: 'YouTube API error' });
  }
});

export default router;
