# 架構設計記錄（Architecture Decision Record）

> 文件目的：記錄本專案的核心設計決策與其理由，方便未來維護者快速理解「為什麼這樣做」。
> 版本：與 `data/law_index.json.version` 同步維護。

---

## 1. 核心策略：連結為主、學習為核（v2.0）

### 決策

法規條文不自建資料庫，一律外連到全國法規資料庫 / selaw / 證交所等官方來源。
工具自身專注於「題庫練習＋情境模擬＋問答集整合搜尋」。

### 為什麼

1. **selaw.com.tw** 已經是業界公認的法規查詢入口，且明確禁止未授權轉載
2. **全國法規資料庫**每日更新，自建只能月更——延遲對法令工具是致命
3. PCode 驗證、HTML 解析、版本追蹤等工程量高，對「學習工具」核心價值貢獻有限
4. 工具的真正差異化價值在「題庫＋問答集」，不在「再做一個法規查詢」

### 取捨

- 體驗：使用者點連結會跳離工具（用 `target="_blank"` 緩解）
- 法律安全：極低（不存任何官方原文）
- 即時性：永遠看到官方當下版本
- 工程量：低（只維護一張對應表）

---

## 2. 技術棧：純 Vanilla（沒有 build step）

### 決策

前端純 HTML / CSS / JavaScript，**完全不使用** React / Vue / Tailwind / Bootstrap / Node.js / TypeScript。

### 為什麼

1. **零 build step**：直接 `python3 -m http.server` 或丟到 GitHub Pages 就能跑
2. **檔案小**：沒有 framework runtime，首頁載入 < 200 KB
3. **易維護**：未來接手者不需要學任何工具鏈
4. **長期穩定**：vanilla JS 標準不會 deprecation；framework 會

### 取捨

- 元件複用較弱（用 template literal + 字串拼接）
- 但本工具規模小，沒有複雜狀態，無框架反而更清楚

---

## 3. 資料儲存：localStorage，無帳號系統

### 決策

學習進度（答題統計、錯題本、連續天數、六軸熟練度、徽章、每日挑戰完成紀錄）全部存在使用者瀏覽器的 `localStorage`：

- `underwriter_lex_quiz_progress`：主進度檔（**v2 schema**，PRD §9.5.4）
- `underwriter_lex_daily_challenge`：當日 daily challenge 暫存（換日自動 reset）
- `underwriter_lex_exam_progress`：高業考古題進度
- `underwriter_lex_quiz_unified_v1` / `underwriter_lex_scenario_purged_v1`：一次性 migration 旗標

### 為什麼

1. **無後端**：減少維運成本與法律風險（不蒐集個資）
2. **PRD §13.3** 要求不蒐集個資、不用 GA / FB Pixel
3. **手機優先**：localStorage 在 iOS Safari / Android Chrome 都穩定可用

### Progress schema v2（PRD §9.5.4）

```js
{
  version: 2,
  user_nickname: "",
  streak: {
    current_days, longest_days, this_month_days, lifetime_days,
    last_active_date, last_compensation_month,
    compensation_used_this_month, compensation_remaining,
    compensation_pending: { previous_streak, questions_done, target, started_date }
  },
  stats: {
    total_answered, total_correct, questions_answered_today, questions_today_date,
    streak_days, last_practice_date           // legacy mirror，由 streak.* 同步
  },
  category_mastery: {                         // 六軸（PRD §9.5.2）
    issuance, governance, disclosure, tender_offer, insider, asset_acq
    // 每個都是 { answered, correct, mastery }
  },
  category_progress: { ... },                 // legacy 中文鍵分類（首頁進度區仍用）
  wrong_questions: [],
  daily_records: { "YYYY-MM-DD": { completed, theme, correct } },
  daily_completed: { ... },                   // legacy
  badges: { earned: [{id, earned_at}], progress: {id: {current, target}}, notified: [] }
}
```

### v1 → v2 migration

`migrateProgressV1ToV2(p)` in `assets/app.js` 自動執行（loadProgress 內判斷 version）。
- `stats.streak_days` → `streak.current_days`
- `stats.last_practice_date` → `streak.last_active_date`
- 既有 `category_progress`（中文鍵）保留；新增 `category_mastery`（英文六軸鍵）並依 `CATEGORY_TO_AXIS` 映射累計
- 為避免破壞首頁 `renderProgress()`，`stats.streak_days` / `stats.last_practice_date` 在 `recordAnswer()` 內持續鏡像同步

### 取捨

- 跨裝置不同步：使用者換手機進度會消失（PRD 接受）
- Schema 演進需小心：`loadProgress()` 既支援 v1（自動 migrate）也補齊 v2 後續新增欄位

---

## 4. 法規導航資料：人工維護的 JSON

### 決策

`data/law_index.json` 採人工維護，不自動抓取。schema 詳見 PRD §4.4.1。

### 為什麼

- selaw 禁止爬取（§13.1）
- 全國法規資料庫的 PCode 不會頻繁變動，人工查一次後可長期使用
- `scripts/validate_law_index.py` 提供半自動驗證：fetch 每筆 URL 確認 200 OK 且法規名稱與 `name` 欄位一致

### 取捨

- 新增法規或 PCode 變更需手動更新
- `selaw_url` 多數設為 `null`（仰賴 `primary_url` 即可），避免維護兩條 URL

---

## 5. 問答集解析：嚴格保留主管機關原文

### 決策

`scripts/fetch_qa.py` 從證期局抓 23 大類問答集 PDF，用 pdfplumber 抽出原文存入 `output/qa.json`。**前端絕不對 raw_text 做任何 AI 改寫、摘要、重新格式化**。

### 為什麼

- PRD §1.3 第 2 條核心原則
- 法令工具最重要的是「正確性」，不是「可讀性」
- 問答集是主管機關的官方解釋，改寫會造成歧義或法律風險

### 實作機制

- `qa.json` 的 `raw_text` 經 `escapeHTML()` 後直接放入 `<pre class="qa-raw-text">`
- CSS `white-space: pre-wrap` 保留段落結構
- 前端 search 只做關鍵字命中片段顯示，不重排原文

### PDF 下載策略

所有「下載原始 PDF」按鈕的 `href` 直接指向 sfb.gov.tw 原網址，**不從 GitHub Pages 提供下載**。理由：
- 節省自家頻寬（GitHub Pages 月限 100 GB）
- 保證使用者拿到主管機關當下最新版
- 法律安全（不替主管機關散佈其文件）

---

## 6. 題庫：人工種子 + 半自動產題

### 決策

第一階段純人工編寫 5–30 題種子題目（`data/quiz.json`），每題綁定 `source.url` 深層連結到具體法源。後續可用 `scripts/generate_quiz.py`（待實作）以 AI 半自動產題，但**必須人工審閱才上線**。

### 為什麼

- 題目品質直接影響工具可信度
- 法律題的「微妙差異」AI 容易出錯
- 種子題目奠定 schema 與難度分布基準

### Schema

```json
{
  "id": "Q001",
  "type": "knowledge | scenario",
  "category": "募集發行",
  "difficulty": "basic | medium | advanced",
  "question": "...",
  "options": ["...", "...", "...", "..."],
  "correct_index": 1,
  "explanation": "...",
  "source": {
    "law_id": "A04",
    "law_name": "...",
    "article": "7",
    "url": "https://law.moj.gov.tw/LawClass/LawSingle.aspx?Pcode=...&FLNO=7"
  }
}
```

---

## 7. 視覺設計：現代金融專業白（v2.1）

### 決策

從 v1 的「深色＋金色」改為「米白底 + 純白卡片 + 深靛藍主色 + 點綴金」，靈感來自 Bloomberg、Stripe 文件。

### 為什麼

- 部門內專業使用，需「明亮專業」而非「炫技深色」
- 白底長時間閱讀較不疲勞
- 深靛藍 `#1e3a5f` 是國際金融業常見的權威色

### 設計變數

見 `assets/style.css` 開頭的 `:root` 區塊。改色系時統一改變數即可。

### 字型混搭

- 中文襯線：Noto Serif TC（內文）
- 英文襯線：Cormorant Garamond（裝飾性 brand / heading）
- 等寬：JetBrains Mono（技術數字）

---

## 8. 部署：GitHub Pages + GitHub Actions

### 決策

- 主站：GitHub Pages（`main` 分支根目錄）
- 資料同步：GitHub Actions（`.github/workflows/update-data.yml`）每月 1 號自動跑 `fetch_qa.py`
- 監控：Cloudflare Web Analytics（隱私友善、免費、無 cookie）

### 為什麼

- 完全免費（PRD §1.3 第 7 條）
- 與 GitHub 同生態，不用額外服務
- Cloudflare Web Analytics 不蒐集個資（PRD §13.3）

### 部署流程

詳見 `docs/deployment.md`。

---

## 9. 法律與合規

詳見 PRD §13 與 `data/disclaimer.md`。

關鍵紅線：
- ❌ 不抓取 selaw.com.tw 內容
- ❌ 不用 Google Analytics / Facebook Pixel
- ❌ 不對問答集原文做 AI 改寫
- ❌ 不在 GitHub Pages 提供 PDF 下載（一律連回主管機關）

---

## 10. 黏著度設計：每週題型輪播 + 個人儀表板（v2.2）

### 決策

新增「個人」分頁（PRD §9.5），含三大區塊：
1. **連續精進天數** + 補卡機制（每月最多 3 次，補答 2 題即可延續）
2. **熟練度六軸雷達圖**（SVG 自繪，不引入 D3）
3. **6 個 MVP 徽章**（金色描邊 + 月桂葉 SVG，律所執業證書質感）

每日挑戰加入**每週題型輪播**（PRD §9.2）：週一 IPO ／ 週二 SPO ／ 週三 治理 ／ 週四 內線 ／ 週五 本月焦點 ／ 週六 錯題本 ／ 週日 資深挑戰。

### 設計紅線（PRD §12.3）

- ❌ 個人儀表板不得使用 emoji（🔥／🌅 等）
- ❌ 不得使用「Combo」「連勝」「連敗」等遊戲化字眼
- ❌ 徽章視覺不得卡通化，必須金色描邊 + 拉丁文 + 中文襯線體

### 六軸 → 中文 category 映射

`CATEGORY_TO_AXIS` 常數（`assets/app.js`）：

| 六軸 key | label | 對應中文 category |
|---|---|---|
| issuance | 募集發行 | IPO募集發行、證交法核心、上市櫃規範 |
| governance | 公司治理 | 公司治理、內部控制、公司法 |
| disclosure | 財務揭露 | 財報與IFRS、其他 |
| tender_offer | 公開收購 | 公開收購與庫藏股 |
| insider | 內線交易 | 重大訊息與操縱 |
| asset_acq | 取得處分 | 證券商管理 |

熟練度公式：`accuracy × min(log10(total+1)/2, 1) × 100`（PRD §9.5.2）。
低題量者熟練度被壓低，避免「答對 3/3 = 100%」的偽精通。

### 每週題型 tag 推導

`quiz_extended.json` 既有 200 題尚無 explicit `tags`（PRD §9.3 v2.2 schema）。
過渡方案：`deriveQuestionTags(q)` 由 category + difficulty + 內容關鍵字自動推導。
未來題目 JSON 可顯式給 `tags: [...]`，會直接覆蓋自動推導。

對應 tag：`IPO`、`SPO`、`governance`、`insider`、`advanced`。
週五 `regulation_update` 與週六 `wrong_review` 為特殊 tag：
- 週五：尚無此 tag，fallback 全題庫並依 `_added_at` 倒序
- 週六：從 `progress.wrong_questions` 取題；錯題不足時 fallback advanced

### 補卡機制（streak compensation）

實作於 `tickStreakOnActivity(p)`：
1. 若 gapDays === 1 → 正常 +1
2. 若 gapDays >= 2 且 `compensation_remaining > 0` → 進入 `compensation_pending`，`current_days` 暫設 1，紀錄斷掉前 streak
3. 同日續答到 `target=2` 題時，還原 `current_days = previous_streak + 1`，扣一次補卡額度
4. 跨月自動 reset `compensation_remaining = 3`

### 修法日（雷達軸標註）

`AXIS_AMENDMENT_DATES` 常數內目前以維護人手動標註的代表性日期填入。
TODO（之後迭代）：在 `data/law_index.json` 加入 `last_amendment_date` 欄位後改為動態抓取。
