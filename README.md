# EMX — Elon Tweet Tracker（Polymarket 輔助）

追蹤 @elonmusk 發推數量，輔助 Polymarket「Elon Musk # tweets」市場落注決策。
純靜態頁面（GitHub Pages），資料由 GitHub Actions 定時抓取，頁面亦會直連
xtracker 即時更新。

**網址**：https://josephci.github.io

---

## 功能

### 📊 計數同視覺化
- **市場日口徑**：以美東時間 ET 中午 12:00 為每日界線（自動處理夏令
  EDT/EST），同 Polymarket / xtracker 結算口徑一致。
- 統計卡（本市場日推文、7 日平均、高峰時段、累計）、14 日長條圖、
  本期每小時圖、每小時熱力圖（含星期標籤、週末標色）。
- **賠率走勢圖**：領先 bucket 近 7 日價格，訊號亮燈時刻以橙點標示。

### 🎯 進場訊號 + 預測
- **策略檢查**：距結算 ≤10h、Elon 沉默 ≥2h、領先者 30–88¢。
- **落點預測**：本期已計數 ＋ 按「同星期幾」同時段 pace 推算餘下時間，
  預測結算落邊個 bucket（範圍 lo–hi，隨剩餘時間收窄）。
- **Edge 量化**：用常態分佈計每個 bucket 命中機率，揀 edge 最大嗰個
  （模型機率 − 市價），並按 ¼ Kelly（封頂 10% 本金）建議注碼。
- **自我校準**：leave-one-out 計出模型近期同時段誤差 ±X 則。
- **真實往績**：每個市場結算後對比預測 vs 實際（鎖定結算前約 10h 嗰次
  預測），累積命中率，夠 5 場先顯示百分比。

### ✈️ 航班 / 🚀 發射
- **私人機上落**：ADS-B 追蹤 N628TS(G650ER)、N8628(G800)、N272BG、
  N502SX(G550)；起降時間用「兩次 check 中點」估算並標 ±不確定範圍。
  頁面開啟時直連 ADS-B 顯示即時飛行狀態。
- **SpaceX 排程**：Launch Library 2 抓未來發射（發射前後 Elon 常唔訓、
  推文易爆）。

### 📲 Telegram 提醒（需設 secrets）
進場訊號、爆推（30 分鐘 ≥5 則）、上下機、發射前 12h 倒數。

### 🩺 每日健康檢查
每日 09:30 HKT 驗證各資料檔新鮮度，有問題先 Telegram 通知。

---

## 架構

| 檔案 | 作用 |
|---|---|
| `index.html` | 整個前端（單檔，內嵌 JS，Chart.js CDN） |
| `scripts/fetch.js` | 抓推文（xtracker）、航班（ADS-B）、發射（LL2） |
| `scripts/signal.js` | 記賠率、進場訊號、各種 Telegram 提醒、預測往績追蹤 |
| `scripts/healthcheck.js` | 每日 pipeline 健康檢查 |
| `data/*.json` `.csv` | 抓取結果（Actions 自動 commit） |
| `.github/workflows/` | `fetch-tweets`（每 20 分排程）、`healthcheck`（每日） |

## 資料流

```
GitHub Actions（cron）→ fetch.js / signal.js → commit data/ → Pages
                                                      ↓
頁面載入 → 讀 data/*.json + 直連 xtracker/ADS-B（繞過排程延遲）→ 渲染
```

> 註：GitHub 免費排程係 best-effort，實際約每 1–2 小時先 fire 一次；
> 頁面直連 xtracker（左上「⚡ xtracker 直連」）先係即時更新嘅主力。

## 本地開發

```bash
python3 -m http.server 8000   # 然後開 http://localhost:8000
node scripts/fetch.js         # 手動抓一次（需網絡）
node scripts/healthcheck.js   # 跑健康檢查
```

## 免責

所有預測、edge、建議注碼僅供參考，唔構成投資建議。發推 pace、賠率、
航班時間隨時變；ADS-B 起降係估算，精準時間以 xtracker 為準。
