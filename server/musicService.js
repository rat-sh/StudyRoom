// server/musicService.js

import axios from "axios";

const YT_BASE_URL = "https://www.googleapis.com/youtube/v3/search";

// ----------------------------
// 🔍 MAIN SEARCH FUNCTION
// ----------------------------
export async function searchSong(query) {
  try {
    const res = await axios.get(YT_BASE_URL, {
      params: {
        part: "snippet",
        q: query,
        type: "video",
        videoCategoryId: 10, // 🎵 Music category
        maxResults: 5,
        key: process.env.YT_API_KEY
      }
    });

    const items = res.data.items;

    if (!items || items.length === 0) return null;

    const ranked = rankResults(items);

    const best = ranked[0];

    return {
      videoId: best.id.videoId,
      title: cleanTitle(best.snippet.title),
      channel: best.snippet.channelTitle,
      thumbnail: best.snippet.thumbnails?.medium?.url || "",
      url: `https://www.youtube.com/watch?v=${best.id.videoId}`
    };

  } catch (err) {
    console.error("YouTube Search Error:", err.message);
    return null;
  }
}

// ----------------------------
// 🧠 RESULT RANKING LOGIC
// ----------------------------
function rankResults(items) {
  return items.sort((a, b) => score(b) - score(a));
}

// ----------------------------
// 🎯 SCORING FUNCTION
// ----------------------------
function score(video) {
  const title = video.snippet.title.toLowerCase();
  const channel = video.snippet.channelTitle.toLowerCase();

  let score = 0;

  // ✅ Prefer official content
  if (title.includes("official")) score += 5;
  if (title.includes("audio")) score += 3;
  if (title.includes("video")) score += 2;

  // ❌ Avoid unwanted versions
  if (title.includes("live")) score -= 3;
  if (title.includes("cover")) score -= 4;
  if (title.includes("remix")) score -= 2;
  if (title.includes("nightcore")) score -= 5;

  // 🎤 Prefer artist channels (basic heuristic)
  if (channel.includes("vevo")) score += 4;
  if (channel.includes("official")) score += 2;

  return score;
}

// ----------------------------
// 🧼 CLEAN TITLE (optional)
// ----------------------------
function cleanTitle(title) {
  return title
    .replace(/\(.*?\)/g, "") // remove brackets
    .replace(/\[.*?\]/g, "")
    .trim();
}
