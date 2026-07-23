// scripts/healthcheck.js — 每日健康檢查：驗證成條 pipeline 有冇斷，有問題就 Telegram 通知
// 檢查對象係 repo 入面已 commit 嘅資料檔——佢哋新鮮，即係 fetch → commit → push 成條鏈都正常
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

const problems = [];  // 嚴重：pipeline 斷咗
const warnings = [];  // 輕微：值得留意但唔一定係壞

function ageH(iso) { return (Date.now() - new Date(iso).getTime()) / 3600000; }
function readJSON(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); } catch { return null; }
}

// 1) tweets.json：20 分鐘 cron，超過 90 分鐘未更新 = fetch/commit 鏈有事
const tweets = readJSON('tweets.json');
if (!tweets || !tweets.last_updated) {
  problems.push('tweets.json 讀唔到或者冇 last_updated');
} else {
  const h = ageH(tweets.last_updated);
  // GitHub 免費排程實際 ~1.5-3 小時先 fire 一次（best-effort，會 drop 觸發），
  // 所以 4 小時先當 pipeline 有事；即時資料靠頁面直連 xtracker，唔靠呢個檔案
  if (h > 4) problems.push(`推文資料已 ${h.toFixed(1)} 小時未更新（GitHub 排程可能停咗）`);
  else console.log(`✅ tweets.json 新鮮（${(h * 60).toFixed(0)} 分鐘前）`);
}

// 2) launches.json：LL2 有限流，容忍啲；超過 36 小時就有事
const launches = readJSON('launches.json');
if (!launches || !launches.last_updated) {
  warnings.push('launches.json 未產生（SpaceX 排程未有數據）');
} else {
  const h = ageH(launches.last_updated);
  if (h > 36) problems.push(`SpaceX 排程已 ${h.toFixed(0)} 小時未更新（LL2 可能一直限流或改咗格式）`);
  else console.log(`✅ launches.json 新鮮（${h.toFixed(1)} 小時前，${(launches.launches || []).length} 個發射）`);
}

// 3) jet_state.json：上下機追蹤有冇行緊（每次 fetch 都會寫）
const jetState = readJSON('jet_state.json');
if (!jetState || !Object.keys(jetState).length) {
  warnings.push('jet_state.json 未產生（上下機追蹤未開始）');
} else {
  const newest = Math.min(...Object.values(jetState).map(s => ageH(s.at || 0)));
  if (newest > 2) problems.push(`上下機追蹤已 ${newest.toFixed(1)} 小時冇更新（ADS-B 源可能兩個都死咗）`);
  else console.log(`✅ 上下機追蹤運作中（${Object.keys(jetState).length} 架機）`);
}

// 4) price_log.csv：signal.js 冇進行中市場時會跳過，所以只當警告
try {
  const lines = fs.readFileSync(path.join(DATA_DIR, 'price_log.csv'), 'utf8').trim().split('\n');
  const lastTs = (lines[lines.length - 1] || '').split(',')[0];
  const h = ageH(lastTs);
  if (!lastTs || isNaN(h)) warnings.push('price_log.csv 最後一行解析唔到');
  else if (h > 24) warnings.push(`price_log 已 ${h.toFixed(0)} 小時冇記錄（可能真係冇進行中市場，或者 gamma API 有問題）`);
  else console.log(`✅ price_log 有寫入（${h.toFixed(1)} 小時前）`);
} catch { warnings.push('price_log.csv 讀唔到'); }

// ── 匯報 ──────────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) { console.log('ℹ️ 未設定 Telegram secrets，略過通知'); return; }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
  });
  console.log(res.ok ? '✅ Telegram 已發送' : `⚠️ Telegram 失敗 ${res.status}`);
}

(async () => {
  if (!problems.length && !warnings.length) {
    console.log('🩺 全部正常，唔使嘈你');
    return;
  }
  const msg = ['🩺 <b>EMX 每日健康檢查</b>'];
  if (problems.length) msg.push('', '❌ <b>有問題</b>：', ...problems.map(p => '・' + p));
  if (warnings.length) msg.push('', '⚠️ 留意：', ...warnings.map(w => '・' + w));
  msg.push('', 'Actions log：https://github.com/josephci/EMX/actions');
  await sendTelegram(msg.join('\n'));
  // 有嚴重問題就令 workflow 變紅，GitHub 都會 email 你
  if (problems.length) process.exit(1);
})();
