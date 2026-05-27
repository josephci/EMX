// scripts/fetch.js
// 每次由 GitHub Actions 執行，抓取最新推文並合併到 data/tweets.json

const fs   = require('fs');
const path = require('path');

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = 'twitter-api45.p.rapidapi.com';
const USERNAME      = 'elonmusk';
const DATA_FILE     = path.join(__dirname, '..', 'data', 'tweets.json');

if (!RAPIDAPI_KEY) {
  console.error('❌ 找不到 RAPIDAPI_KEY，請在 GitHub Secrets 設定');
  process.exit(1);
}

async function fetchTweets() {
  const url = `https://${RAPIDAPI_HOST}/timeline.php?screenname=${USERNAME}`;
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

  const data = await res.json();
  const raw  = data.timeline || data.tweets || [];

  return raw.slice(0, 40).map((t) => ({
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
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch {}
  // 初始結構
  return { username: USERNAME, last_updated: null, by_date: {} };
}

function mergeAndSave(existing, newTweets) {
  const db = existing;
  let added = 0;

  newTweets.forEach((t) => {
    const date = new Date(t.created_at).toISOString().slice(0, 10);
    if (!db.by_date[date]) db.by_date[date] = [];
    // 用 id 去重
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
    console.log(`🔍 正在抓取 @${USERNAME} 的推文…`);
    const tweets   = await fetchTweets();
    const existing = loadExisting();
    const added    = mergeAndSave(existing, tweets);
    console.log(`✅ 完成：新增 ${added} 則，共 ${existing.total} 則累計`);
  } catch (err) {
    console.error('❌ 失敗：', err.message);
    process.exit(1);
  }
})();
