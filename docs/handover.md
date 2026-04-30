# 交接指南

> 對象：未來接手本工具的維護人員。
> 目標：1 小時內理解架構、3 小時內可獨立修小 bug。

---

## 1. 30 秒概覽

**承銷研修所 / Lex Studio** 是一個給承銷輔導人員的法令學習工具。

- 部署在 GitHub Pages，純前端 vanilla HTML/CSS/JS
- 法規條文不自建，連結到全國法規資料庫 / selaw / 證交所等官方來源
- 自建內容：題庫、情境模擬、問答集索引（從證期局每月自動更新）
- 學習進度存在使用者瀏覽器的 localStorage（無帳號系統）

完整理念見 `PRD MEMO/02_PRD_Lex_Studio_v2.md` §1–2。
重大設計決策見 `docs/architecture.md`。

---

## 2. 程式碼地圖

```
lex-studio/
├── index.html               主頁面（單檔 SPA，5 個分頁）
├── manifest.json            PWA 設定
├── assets/
│   ├── style.css            設計變數 + 元件樣式（按區塊註記）
│   ├── app.js               所有前端邏輯，分模組：
│   │                        • 法規導航（loadData / renderLawCard / parseSmartQuery）
│   │                        • 問答集（ensureQaLoaded / qaSearchAll）
│   │                        • 題庫（startSession / selectAnswer / renderQuiz*）
│   │                        • 進度（loadProgress / recordAnswer）
│   │                        • 首頁（getDailyQuestion / renderProgress）
│   └── icon.svg             PWA icon（純 SVG，純 brand 文字無依賴）
├── data/                    人工維護的資料
│   ├── law_index.json       43 部法規導航索引（schema 見 PRD §4.4.1）
│   ├── quiz.json            題庫（schema 見 PRD §4.4.3）
│   └── disclaimer.md        免責聲明全文
├── output/                  腳本自動產生（GitHub Actions commit）
│   ├── qa.json              問答集索引（schema 見 PRD §4.4.2）
│   └── qa_pdfs/             原始 PDF 備份（解析用）
├── scripts/
│   ├── requirements.txt
│   ├── validate_law_index.py  驗證 law_index 中每筆 URL
│   ├── explore_sfb.py         證期局站台結構探勘（fetch_qa.py 前置）
│   └── fetch_qa.py            抓問答集 PDF + 抽文字
├── .github/workflows/
│   └── update-data.yml      每月 1 號 UTC 02:00 自動跑 fetch_qa.py
├── docs/
│   ├── architecture.md      設計決策
│   ├── deployment.md        部署步驟
│   ├── monitoring.md        Cloudflare 監控設定
│   └── handover.md          本檔
├── PRD MEMO/                原始 PRD 與開工指令存檔
└── README.md
```

---

## 3. 常見維護任務

### 3.1 修正 / 新增法規條目

1. 編輯 `data/law_index.json`
2. （建議）跑 `python3 scripts/validate_law_index.py` 確認新 URL 200 OK 且名稱對得上
3. commit + push 到 main，Pages 自動更新

### 3.2 新增題目

1. 編輯 `data/quiz.json`
2. 新題目 `id` 取下一個流水號（不重用刪除過的 id）
3. **必須**填 `source.url` 深層連結（用 `article_url_template` 從 `law_index.json` 拼）
4. commit + push

### 3.3 問答集解析失敗

如果證期局改了 HTML 結構，`fetch_qa.py` 可能抓不到 PDF。debug 步驟：

```bash
# 1. 先用 explore 看新結構
python3 scripts/explore_sfb.py
# 2. 開 output/_explore/sfb_858.html 看實際 HTML
# 3. 對照 fetch_qa.py 的 find_subcategories / parse_subcategory_documents
#    調整解析邏輯
# 4. 本機測試：python3 scripts/fetch_qa.py --only 863
# 5. 確認 output/qa.json 內容正確
# 6. commit fetch_qa.py 修正，下次工作流會跑新版
```

### 3.4 視覺改色 / 字型

`assets/style.css` 開頭的 `:root` 區塊集中所有設計變數。改色只動這裡。

字型載入位於 `index.html` 的 `<link>` Google Fonts CDN。

### 3.5 PWA icon 換圖

替換 `assets/icon.svg`。manifest 已用 `"sizes": "any"` 接受任何 SVG 尺寸。
若要 PNG，新增 192×192 + 512×512 兩張，再修 `manifest.json`。

---

## 4. 不要做的事（紅線）

- ❌ **不要爬取 selaw.com.tw**：明確禁止未授權轉載
- ❌ **不要對問答集 raw_text 做 AI 改寫 / 摘要**：法律工具最重正確性
- ❌ **不要在 GitHub Pages 提供 PDF 下載**：頻寬與法律考量，PDF 一律連回主管機關原網址
- ❌ **不要加入帳號系統 / Google Analytics / Facebook Pixel**：個資紅線
- ❌ **不要引入 React / Vue / Tailwind 等框架**：違反「無 build step」原則
- ❌ **不要手動 commit `output/qa.json`**：應由工作流產生

---

## 5. 監控與健康度

詳見 `docs/monitoring.md`。每月 1 次 Cloudflare 後台檢查 + URL 驗證腳本。

---

## 6. 緊急聯絡

- GitHub repo：<https://github.com/alan00205-creator/lex-studio>
- 資料源若失效：
  - 全國法規資料庫：法務部 02-2191-0189
  - 證期局問答集：02-8773-5100
  - selaw：證基會 02-2357-4830

---

## 7. 進階：本機開發環境

```bash
git clone https://github.com/alan00205-creator/lex-studio.git
cd lex-studio
pip install -r scripts/requirements.txt    # 只有跑腳本時才需要
python3 -m http.server 8000                # 開 http://localhost:8000/
```

修改 → 重新整理瀏覽器 → 看效果。沒有 build step、沒有 hot reload，就是這麼樸素。
