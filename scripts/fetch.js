// scripts/fetch.js
const fs   = require('fs');
const path = require('path');

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = 'twitter-api45.p.rapidapi.com';
const USERNAME      = 'elonmusk';
const DATA_FILE     = path.join(__dirname, '..', 'data', 'tweets.json');

if (!RAPIDAPI_KEY) {
  console.error('❌ 找不到 RAPIDAPI_KEY');
  process.exit(1);
}

const HEADERS = {
  'Content-Type':    'application/json',
  'x-rapidapi-key':  RAPIDAPI_KEY,
  'x-rapidapi-host': RAPIDAPI_HOST,
};

async function fetchEndpoint(endpoint) {
  const url = `https://${RAPIDAPI_HOST}/${endpoint}?screenname=${USERNAME}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${endpoint} 回傳 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw  = data.timeline || data.tweets || data.replies || [];
  return raw.map((t) => ({
    id:         String(t.tweet_id || t.id_str || t.id),
    text:       t.text || t.full_text || '',
    created_at: t.created_at || new Date().toISOString(),
    likes:      Number(t.favorite_count)  || 0,
    retweets:   Number(t.retweet_count)   || 0,
    is_reply:   !!(t.in_reply_to_user_id || t.in_reply_to_screen_name),
  }));
}

function loadExisting() {
  try {
    if (fs.existsSync(DATA_FILE))
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  return { username: USERNAME, last_updated: null, by_date: {} };
}

function mergeAndSave(existing, tweets) {
  const db = existing;
  let added = 0;
  tweets.forEach((t) => {
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
    console.log(`🔍 抓取 @${USERNAME}：timeline + replies…`);

    // 同時發兩個請求（節省時間）
    const [timeline, replies] = await Promise.all([
      fetchEndpoint('timeline.php').catch(e => { console.warn('⚠️ timeline 失敗：', e.message); return []; }),
      fetchEndpoint('replies.php').catch(e => { console.warn('⚠️ replies 失敗：', e.message); return []; }),
    ]);

    // 合併並去重
    const seen = new Set();
    const all  = [...timeline, ...replies].filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    console.log(`  timeline: ${timeline.length} 則，replies: ${replies.length} 則，合併: ${all.length} 則`);

    const existing = loadExisting();
    const added    = mergeAndSave(existing, all);
    console.log(`✅ 完成：新增 ${added} 則，累計 ${existing.total} 則`);
  } catch (err) {
    console.error('❌ 失敗：', err.message);
    process.exit(1);
  }
})();
