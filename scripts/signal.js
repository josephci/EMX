// scripts/signal.js — 每小時執行：記錄領先者價格 + 條件滿足時 Telegram 提醒
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const TWEETS     = path.join(DATA_DIR, 'tweets.json');
const PRICE_LOG  = path.join(DATA_DIR, 'price_log.csv');
const STATE_FILE = path.join(DATA_DIR, 'signal_state.json');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

// 策略條件（同 Dashboard / 回測一致）
const SETTLE_MAX_H  = 10;
const SILENCE_MIN_H = 2;
const LEAD_MIN      = 0.30;
const LEAD_MAX      = 0.88;
const ALERT_COOLDOWN_H = 6; // 同一市場最多每 6 小時提醒一次

async function gammaSearch() {
  const url = 'https://gamma-api.polymarket.com/public-search?q=' +
    encodeURIComponent('elon musk tweets') + '&limit_per_type=30&events_status=active';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gamma ${res.status}`);
  const js  = await res.json();
  const now = new Date();
  const evs = (js.events || []).filter(e => {
    const t = (e.title || '').toLowerCase();
    if (!(t.includes('elon') && (t.includes('tweet') || t.includes('post')))) return false;
    try {
      const s = new Date(e.startDate), en = new Date(e.endDate);
      return en > now && (en - s) / 86400000 <= 8;
    } catch { return false; }
  });
  if (!evs.length) return null;
  return evs.sort((a, b) => new Date(a.endDate) - new Date(b.endDate))[0];
}

function leaderOf(ev) {
  let name = null, price = -1;
  (ev.markets || []).forEach(m => {
    try {
      const p = parseFloat(JSON.parse(m.outcomePrices || '[]')[0]);
      if (p > price) { price = p; name = m.groupItemTitle || m.question || '?'; }
    } catch {}
  });
  return { name, price };
}

function silenceHours() {
  try {
    const db = JSON.parse(fs.readFileSync(TWEETS, 'utf8'));
    let latest = null;
    Object.values(db.by_date || {}).flat().forEach(p => {
      const d = new Date(p.created_at);
      if (!latest || d > latest) latest = d;
    });
    return latest ? (Date.now() - latest) / 3600000 : null;
  } catch { return null; }
}

function marketWindowStart(ev) {
  // 窗口開始 = 標題日期的 12:00（固定UTC-5）= 17:00 UTC；Gamma startDate 只作後備
  const MONTHS = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
  const tm = (ev.title || '').match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i);
  const ym = (ev.title || '').match(/(\d{4})/);
  if (tm) {
    const y = ym ? parseInt(ym[1]) : new Date().getUTCFullYear();
    return new Date(Date.UTC(y, MONTHS[tm[1].toLowerCase()], parseInt(tm[2]), 17, 0, 0));
  }
  return new Date(ev.startDate);
}

function periodCount(ev) {
  try {
    const db = JSON.parse(fs.readFileSync(TWEETS, 'utf8'));
    const s = marketWindowStart(ev), now = new Date();
    return Object.values(db.by_date || {}).flat().filter(p => {
      const d = new Date(p.created_at);
      return d >= s && d <= now;
    }).length;
  } catch { return null; }
}

function appendPriceLog(row) {
  const header = 'timestamp_utc,market,hours_to_settle,leader_bucket,leader_price,silence_h,period_count,signal\n';
  if (!fs.existsSync(PRICE_LOG)) fs.writeFileSync(PRICE_LOG, header);
  fs.appendFileSync(PRICE_LOG, row + '\n');
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.log('ℹ️ 未設定 Telegram secrets，略過提醒');
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
  });
  console.log(res.ok ? '✅ Telegram 已發送' : `⚠️ Telegram 失敗 ${res.status}`);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

(async () => {
  try {
    const ev = await gammaSearch();
    if (!ev) { console.log('無進行中市場'); return; }

    const now = new Date();
    const hoursToSettle = (new Date(ev.endDate) - now) / 3600000;
    const { name: leader, price } = leaderOf(ev);
    const silence = silenceHours();
    const count   = periodCount(ev);

    const c1 = hoursToSettle <= SETTLE_MAX_H;
    const c2 = silence !== null && silence >= SILENCE_MIN_H;
    const c3 = price > LEAD_MIN && price < LEAD_MAX;
    const signal = c1 && c2 && c3;

    // ③ 每小時記錄價格
    appendPriceLog([
      now.toISOString(), `"${ev.title}"`, hoursToSettle.toFixed(1),
      `"${leader}"`, price.toFixed(3),
      silence === null ? '' : silence.toFixed(1),
      count === null ? '' : count,
      signal ? 1 : 0,
    ].join(','));
    console.log(`📝 已記錄：${leader} @ ${price.toFixed(3)}，距結算 ${hoursToSettle.toFixed(1)}h，沉默 ${silence?.toFixed(1)}h，訊號=${signal}`);

    // ② 條件滿足 → Telegram（有冷卻期避免轟炸）
    if (signal) {
      const state = loadState();
      const last  = state[ev.title] ? new Date(state[ev.title]) : null;
      if (!last || (now - last) / 3600000 >= ALERT_COOLDOWN_H) {
        await sendTelegram(
          `🟢 <b>進場訊號</b>\n` +
          `市場：${ev.title}\n` +
          `距結算：${hoursToSettle.toFixed(1)} 小時\n` +
          `Elon 沉默：${silence.toFixed(1)} 小時\n` +
          `領先：${leader} @ ${(price * 100).toFixed(1)}¢\n` +
          `本期已計：${count} 則\n\n` +
          `策略：掛 maker 買單（mid−1¢），4h 後或結算前 1h 出場`
        );
        state[ev.title] = now.toISOString();
        saveState(state);
      } else {
        console.log('⏳ 冷卻期內，唔重複提醒');
      }
    }
  } catch (e) {
    console.error('❌', e.message);
    // 訊號功能失敗唔應該令成個 workflow 失敗
  }
})();
