// scripts/fetch.js — 直接抓 Polymarket 官方結算源 XTracker（免 API key）
const fs   = require('fs');
const path = require('path');

const USERNAME  = 'elonmusk';
const DATA_FILE = path.join(__dirname, '..', 'data', 'tweets.json');
const API_BASE  = 'https://xtracker.polymarket.com/api';

// 抓過去 8 天的資料（每次都補齊近期歷史，錯過也能補回）
function dateStr(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function fetchPosts() {
  const url = `${API_BASE}/users/${USERNAME}/posts?platform=x&startDate=${dateStr(-8)}&endDate=${dateStr(1)}`;
  console.log(`🔍 ${url}`);
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`XTracker 回傳 ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  // 回應格式：{ success: true, data: [...] }，容錯處理不同欄位名稱
  const raw = json.data || json.posts || (Array.isArray(json) ? json : []);
  if (!raw.length) console.warn('⚠️ 回傳 0 則，回應樣本：', JSON.stringify(json).slice(0, 300));

  return raw.map((p) => ({
    id:         String(p.platformPostId || p.postId || p.id),
    text:       p.text || p.content || '',
    created_at: p.createdAt || p.created_at || p.sourceCreatedAt || null,
    imported_at: p.importedAt || p.imported_at || null,
  })).filter(p => p.created_at);
}

function loadExisting() {
  try {
    if (fs.existsSync(DATA_FILE))
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  return { username: USERNAME, source: 'xtracker.polymarket.com', last_updated: null, by_date: {} };
}

function mergeAndSave(existing, posts) {
  const db = existing;
  db.source = 'xtracker.polymarket.com';
  let added = 0;
  posts.forEach((p) => {
    const date = new Date(p.created_at).toISOString().slice(0, 10);
    if (!db.by_date[date]) db.by_date[date] = [];
    if (!db.by_date[date].find((x) => x.id === p.id)) {
      db.by_date[date].push(p);
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
    const posts    = await fetchPosts();
    const existing = loadExisting();
    const added    = mergeAndSave(existing, posts);
    console.log(`✅ 完成：本次抓到 ${posts.length} 則，新增 ${added} 則，累計 ${existing.total} 則`);
  } catch (err) {
    console.error('❌ 失敗：', err.message);
    process.exit(1);
  }
})();
