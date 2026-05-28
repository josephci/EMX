// scripts/fetch.js
const fs   = require('fs');
const path = require('path');

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = 'twitter-api45.p.rapidapi.com';
const USERNAME      = 'elonmusk';
const DATA_FILE     = path.join(__dirname, '..', 'data', 'tweets.json');
const MAX_TWEETS    = 100; // 每次最多抓 100 則

if (!RAPIDAPI_KEY) {
  console.error('❌ 找不到 RAPIDAPI_KEY');
  process.exit(1);
}

async function fetchTimeline(cursor = null) {
  let url = `https://${RAPIDAPI_HOST}/timeline.php?screenname=${USERNAME}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-key':  RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API 回傳 ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function parseTweets(raw) {
  return raw.map((t) => ({
    id:         String(t.tweet_id || t.id_str || t.id),
    text:       t.text || t.full_text || '',
    created_at: t.created_at || new Date().toISOString(),
    likes:      Number(t.favorite_count)  || 0,
    retweets:   Number(t.retweet_count)   || 0,
    is_reply:   !!(t.in_reply_to_user_id || t.in_reply_to_screen_name),
  }));
}

async function fetchAllRecent() {
  const allTweets = [];
  let cursor = null;
  let pages = 0;

  // 最多抓 3 頁（避免超額），每頁約 20-40 則
  while (pages < 3 && allTweets.length < MAX_TWEETS) {
    const data = await fetchTimeline(cursor);
    const raw  = data.timeline || data.tweets || [];
    if (!raw.length) break;

    allTweets.push(...parseTweets(raw));
    pages++;

    // 如果有 next_cursor 就繼續翻頁
    cursor = data.next_cursor || data.cursor || null;
    if (!cursor) break;

    // 避免太快請求
    await new Promise(r => setTimeout(r, 500));
  }

  return allTweets.slice(0, MAX_TWEETS);
}

function loadExisting() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch {}
  return { username: USERNAME, last_updated: null, by_date: {} };
}

function mergeAndSave(existing, newTweets) {
  const db = existing;
  let added = 0;

  newTweets.forEach((t) => {
    const date = new Date(t.created_at).toISOString().slice(0, 10);
    if (!db.by_date[date]) db.by_date[date] = [];
    if (!db.by_date[date].find((x) => x.id === t.id)) {
      db.by_date[date].push(t);
      added++;
    }
  });

  db.last_updated = new Date().toISOString();
  db.total = Object.values(db.by_date).reduce((a, b) => a + b.length, 0);

  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  return added;
}

(async () => {
  try {
    console.log(`🔍 正在抓取 @${USERNAME} 的推文（最多 ${MAX_TWEETS} 則，最多 3 頁）…`);
    const tweets   = await fetchAllRecent();
    const existing = loadExisting();
    const added    = mergeAndSave(existing, tweets);
    console.log(`✅ 完成：新增 ${added} 則，共 ${existing.total} 則累計（本次抓到 ${tweets.length} 則）`);
  } catch (err) {
    console.error('❌ 失敗：', err.message);
    process.exit(1);
  }
})();
