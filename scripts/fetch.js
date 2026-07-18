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

// ── 上/下機：xtracker 冇公開 flights endpoint，改用 ADS-B 社群源 ────────────
// 每次 run 查詢飛機當前狀態，同上次狀態比較：地面→空中 = 起飛，空中→地面/消失 = 降落
const JETS = [
  { reg: 'N628TS', label: 'G650ER（主力）' },
  { reg: 'N272BG', label: 'G550' },
  { reg: 'N502SX', label: 'G550' },
];
const ADSB_SOURCES = [
  (reg) => `https://api.adsb.lol/v2/reg/${reg}`,
  (reg) => `https://api.airplanes.live/v2/reg/${reg}`,
];
const STATE_FILE   = path.join(__dirname, '..', 'data', 'jet_state.json');
const FLIGHTS_FILE = path.join(__dirname, '..', 'data', 'flights.json');

async function fetchJetEvents() {
  let state = {};
  let events = [];
  try { state  = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  try { events = JSON.parse(fs.readFileSync(FLIGHTS_FILE, 'utf8')); if (!Array.isArray(events)) events = []; } catch {}

  const now = new Date().toISOString();
  for (const jet of JETS) {
    // 兩個源逐個試，攞到就停
    let seen = null; // null = 兩個源都失敗（唔好郁 state）；否則 { flying: bool }
    for (const mk of ADSB_SOURCES) {
      try {
        const res = await fetch(mk(jet.reg), { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const j  = await res.json();
        const ac = (j.ac || j.aircraft || [])[0];
        if (!ac) { seen = { flying: false, tracked: false }; }
        else {
          const alt = ac.alt_baro;
          const airborne = alt !== 'ground' && (typeof alt !== 'number' || alt > 300 || (ac.gs || 0) > 80);
          seen = { flying: airborne, tracked: true };
        }
        break;
      } catch {}
    }
    if (seen === null) { console.log(`✈️ ${jet.reg}：兩個 ADS-B 源都查唔到，跳過`); continue; }

    const prev = state[jet.reg] || { flying: false, misses: 0 };
    let flying = seen.flying;
    let misses = 0;
    // 收唔到訊號 ≠ 已降落（可能飛緊出咗接收範圍）：連續 2 次（約 40 分鐘）冇影先當落地
    if (prev.flying && !seen.tracked) {
      misses = (prev.misses || 0) + 1;
      if (misses < 2) flying = true;
    }
    if (!prev.flying && flying)  { events.push({ time: now, type: 'takeoff', reg: jet.reg }); console.log(`🛫 ${jet.reg} 起飛`); }
    if (prev.flying && !flying)  { events.push({ time: now, type: 'landing', reg: jet.reg }); console.log(`🛬 ${jet.reg} 降落`); }
    state[jet.reg] = { flying, misses, at: now };
  }

  // 只保留 35 日內事件
  const cutoff = Date.now() - 35 * 86400000;
  events = events.filter((e) => new Date(e.time).getTime() > cutoff);
  fs.writeFileSync(STATE_FILE,   JSON.stringify(state,  null, 2));
  fs.writeFileSync(FLIGHTS_FILE, JSON.stringify(events, null, 2));
  console.log(`✈️ 上下機追蹤完成：累計 ${events.length} 個事件`);
}

// ── SpaceX 發射排程（Launch Library 2 by TheSpaceDevs，免費；限流時保留舊檔） ──
const LAUNCHES_FILE = path.join(__dirname, '..', 'data', 'launches.json');

async function fetchLaunches() {
  try {
    const url = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?lsp__name=SpaceX&limit=12&mode=list';
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`LL2 回傳 ${res.status}`);
    const json = await res.json();
    const launches = (json.results || []).map((l) => ({
      name:     l.name || '',
      net:      l.net  || null,                       // 預計發射時間（ISO，可能改期）
      status:   (l.status && (l.status.abbrev || l.status.name)) || '',
      pad:      typeof l.pad === 'string' ? l.pad : (l.pad && l.pad.name) || l.pad_name || '',
      location: typeof l.location === 'string' ? l.location : (l.pad && l.pad.location && l.pad.location.name) || '',
    })).filter((l) => l.net);
    fs.writeFileSync(LAUNCHES_FILE, JSON.stringify({ last_updated: new Date().toISOString(), launches }, null, 2));
    console.log(`🚀 SpaceX 排程：${launches.length} 個即將發射`);
  } catch (err) {
    // LL2 免費層每小時 15 次限流；失敗就保留上次嘅檔案
    console.warn(`🚀 排程抓取失敗（保留舊檔）：${err.message}`);
  }
}

(async () => {
  try {
    await fetchJetEvents();
    await fetchLaunches();
    const posts    = await fetchPosts();
    const existing = loadExisting();
    const added    = mergeAndSave(existing, posts);
    console.log(`✅ 完成：本次抓到 ${posts.length} 則，新增 ${added} 則，累計 ${existing.total} 則`);
  } catch (err) {
    console.error('❌ 失敗：', err.message);
    process.exit(1);
  }
})();
