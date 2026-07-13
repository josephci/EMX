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

  // 抓取窗口內的日子：以 API 回傳為準「整個重建」（可同步 Elon 刪文 / XTracker audit 剔除）
  // 窗口以外的舊歷史保持不動
  const windowStart = dateStr(-8);
  const grouped = {};
  posts.forEach((p) => {
    const date = new Date(p.created_at).toISOString().slice(0, 10);
    if (!grouped[date]) grouped[date] = [];
    if (!grouped[date].find((x) => x.id === p.id)) grouped[date].push(p);
  });

  let added = 0, removed = 0;
  // 收集需要重建的日子：窗口內已存在的 + 本次抓到的
  const datesToRebuild = new Set([
    ...Object.keys(db.by_date).filter((d) => d >= windowStart),
    ...Object.keys(grouped),
  ]);
  datesToRebuild.forEach((date) => {
    const before = (db.by_date[date] || []).length;
    const fresh  = grouped[date] || [];
    if (fresh.length > before) added   += fresh.length - before;
    if (fresh.length < before) removed += before - fresh.length;
    if (fresh.length === 0) delete db.by_date[date];
    else db.by_date[date] = fresh;
  });

  db.last_updated = new Date().toISOString();
  db.total = Object.values(db.by_date).reduce((a, b) => a + b.length, 0);
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  console.log(`   同步：+${added} 則新增，-${removed} 則剔除（跟隨結算源）`);
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
