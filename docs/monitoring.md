# 用量監控指南

> 對象：負責監看網站健康度的維護人員。
> PRD §16 對應實作。

---

## 1. 為什麼需要監控

GitHub Pages 對免費部署的軟性限制：

- 每月頻寬 100 GB（軟性，超過會先收警告信）
- Repo 建議 1 GB 以下
- 每小時 10 次 build

對部門內共用 + 同業分享的使用量，這些限制非常寬鬆。但仍需監控避免突發狀況。

---

## 2. 工具：Cloudflare Web Analytics

**首選方案**：Cloudflare Web Analytics
- 完全免費、無流量上限
- 不使用 cookie，不需要顯示同意彈窗（符合個資法）
- 不追蹤個別使用者
- 比 Plausible 簡單

**不要使用**：
- ❌ Google Analytics（PRD §13.3）
- ❌ Facebook Pixel
- ❌ 任何需要 cookie banner 的服務

---

## 3. 啟用步驟

1. 註冊免費 Cloudflare 帳號：<https://dash.cloudflare.com/sign-up>
2. 左側選 **Web Analytics**
3. 點 **Add a site**
4. 輸入網址：`alan00205-creator.github.io/lex-studio` 或你的自訂網域
5. 取得 token（`<token>` 為 32 字元）
6. 編輯 `index.html` 結尾的 Cloudflare 區塊：

   原本：
   ```html
   <!--
   <script defer src='https://static.cloudflareinsights.com/beacon.min.js'
           data-cf-beacon='{"token": "REPLACE_WITH_YOUR_TOKEN"}'></script>
   -->
   ```
   改為：
   ```html
   <script defer src='https://static.cloudflareinsights.com/beacon.min.js'
           data-cf-beacon='{"token": "你的token"}'></script>
   ```
   （把外層 HTML comment 拿掉、token 換進去）
7. commit + push 到 main
8. 開啟網站，30 分鐘後 Cloudflare 後台應出現第一筆數據

---

## 4. 監控指標與閾值

| 指標 | 綠燈 | 黃燈 | 紅燈 |
|---|---|---|---|
| 每月頁面瀏覽 | < 10K | 10K–50K | > 50K |
| 每月不重複訪客 | < 500 | 500–2K | > 2K |
| 預估月頻寬 | < 5 GB | 5–30 GB | > 30 GB |
| 平均載入時間 | < 2 秒 | 2–5 秒 | > 5 秒 |

> 「頻寬」可從 Cloudflare 的 Visits × 平均頁面大小估算。本工具首頁約 200 KB（含字型），其他分頁 < 50 KB（純資料）。

---

## 5. 接近上限時的應對

### 方案 A：減少自家頻寬消耗
- 確認 PDF 走證期局網站不走自家頻寬（已是預設）
- `data/quiz.json` / `output/qa.json` 體積過大時拆分 lazy load
- 啟用 Cloudflare CDN 代理（在 Cloudflare 把網域 proxy 起來）

### 方案 B：搬家到 Cloudflare Pages
- 仍免費，無流量上限
- 部署方式：在 Cloudflare Pages 連結同一個 GitHub repo，build command 留空，output dir 設為 `/`
- DNS 改指 Cloudflare 後即生效

### 方案 C：付費升級
- 最後手段。GitHub Pro 或 Enterprise 提供更高頻寬

---

## 6. 健康度日常檢查清單

每月一次：

- [ ] Cloudflare 後台看 Page Views / 訪客 / Top pages
- [ ] 跑 `python3 scripts/validate_law_index.py` 確認所有法規 URL 仍 200 OK 且名稱對得上
- [ ] 抽查首頁 / 題庫 / 法規 / 問答集 4 個分頁無 console error
- [ ] 確認 `.github/workflows/update-data.yml` 上次跑成功（Actions 頁面）

每季一次：

- [ ] 看 Lighthouse 行動版分數（Performance > 80、Accessibility > 90 為達標）
- [ ] 抽 5 題題庫的 `source.url` 確認還能開
- [ ] 確認部門內網仍能存取（白名單可能會被刷新）

---

## 7. 隱私聲明（給使用者看的）

- 本工具不蒐集任何使用者個資
- 不使用 cookie 追蹤
- 學習進度僅存於使用者瀏覽器的 localStorage，不上傳
- 流量統計由 Cloudflare Web Analytics 提供（aggregate-only，不識別個人）

完整聲明見 `data/disclaimer.md` 與網站頁尾「免責聲明」連結。
