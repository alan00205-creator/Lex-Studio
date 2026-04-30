# 承銷研修所 / Lex Studio

供承銷輔導人員持續精進法令能力的學習工具。

> 採用「**連結為主、學習為核**」混合策略：法規條文一律連到 selaw、全國法規資料庫等官方來源；工具自身專注於題庫練習、情境模擬、問答集整合搜尋。

---

## 專案結構

```
lex-studio/
├── index.html              # 主頁面（單頁 SPA）
├── assets/
│   ├── style.css
│   └── app.js
├── data/                   # 人工維護的資料
│   ├── law_index.json      # 法規導航索引
│   └── disclaimer.md       # 免責聲明全文
├── docs/                   # 設計文件（後續補上 architecture.md / handover.md）
├── PRD MEMO/               # PRD 與原始開工指令存檔（給維護人員，不參與部署）
├── README.md
└── .gitignore
```

後續階段會新增的目錄：

- `output/`：腳本自動產生（問答集 PDF 與 JSON 索引）
- `scripts/`：Python 抓取／驗證腳本
- `.github/workflows/`：每月更新問答集

---

## 開發狀態

| 階段 | 內容 | 狀態 |
|---|---|---|
| Phase 1 | 基礎建置（檔案結構、抽出 CSS/JS、免責聲明） | ✅ 完成 |
| Phase 2 T2.1–T2.3 | 法規導航中心（卡片 UI、分類、智慧搜尋） | ✅ 完成 |
| Phase 2 T2.4 | 補完 43 部法規條目 | ✅ 完成（待你本機跑驗證） |
| Phase 2 T2.5 | URL 驗證腳本 | ✅ 完成（`scripts/validate_law_index.py`） |
| Phase 3 | 證期局問答集解析 | 🔬 前端 UI 殼完成 + 探勘腳本（`scripts/explore_sfb.py`）；待你跑探勘並回貼結果，我寫 `fetch_qa.py` |
| Phase 4 | 題庫與情境模擬 | ⏸ 未開始 |
| Phase 5 | 每日挑戰、PWA、實機測試、發佈 | ⏸ 未開始 |

詳細任務分解見 `PRD MEMO/02_PRD_Lex_Studio_v2.md` §11。

---

## 本機預覽

需要透過本機 HTTP server 開啟（`fetch()` 對 `file://` 不可用）：

```bash
# Python 3
python3 -m http.server 8000
# 開啟 http://localhost:8000/
```

或：

```bash
npx serve .
```

---

## 技術約束（PRD §3）

- 前端純 vanilla HTML / CSS / JS，**不引入框架**
- 不做 build step、不需要 Node.js
- 字型透過 Google Fonts CDN 載入
- 學習進度存於 localStorage（無帳號系統）
- 部署於 GitHub Pages

---

## 法規導航資料維護

`data/law_index.json` 收錄 43 部法規，含全國法規資料庫 PCode、selaw 連結（部分待補）、常用條文 chips 與深層連結 template。

### 驗證 URL 是否正確

```bash
pip install -r scripts/requirements.txt
python3 scripts/validate_law_index.py            # 驗證全部 43 部
python3 scripts/validate_law_index.py --only A01,A04  # 只驗證指定 id
python3 scripts/validate_law_index.py --delay 1.5     # 較慢的速率（避免被擋）
```

腳本會檢查：
- HTTP 200 OK
- 從頁面 `<title>` 抽出的法規名稱與 JSON 的 `name` 是否相符
- `article_url_template` 套入第一個 `common_articles` 是否能 deep-link

> ⚠️ **沙箱限制**：本工具的法規 URL 是 Claude Code 透過 Google site:law.moj.gov.tw 搜尋取得，但由於 law.moj.gov.tw / selaw / twse-regulation 對 cloud IP 段有 bot 防護，**驗證腳本必須在你的本機（非 cloud sandbox）環境執行**才能通過。沙箱內跑會看到 HTTP 403。

### 仍待人工處理

- 35 部新增條目的 `selaw_url` 暫設為 `null`，需要從 selaw.com.tw 逐筆查 LawID 補上
- 多數新增條目的 `common_articles` 為空陣列；可依承銷實務挑出 3–5 條代表性條文補上
- A04、A13、A29、E02 的 `common_articles` 是沿用原資料的條號，但 PCode 已更正，需確認每條對應內容無誤

---

## Phase 3：證期局問答集探勘

進入 `fetch_qa.py` 之前要先理解 sfb.gov.tw 的頁面結構。`scripts/explore_sfb.py` 會抓取入口頁（id=858）+ PRD 建議的樣本子分類（id=863 公開發行公司募集發行），列出：

- 入口頁所有 23 大類的 id 與名稱
- 子分類頁所有 PDF 文件的標題、連結、推斷發布日期、檔案路徑

```bash
python3 scripts/explore_sfb.py                   # 抓 858 + 863
python3 scripts/explore_sfb.py --all-categories  # 抓所有 23 大類
python3 scripts/explore_sfb.py --raw             # 只 dump 原始 HTML，不做解析
```

執行後：
- 原始 HTML 存於 `output/_explore/sfb_<id>.html`（已加入 `.gitignore`）
- 結構化解析結果存於 `output/_explore/explore_report.json`
- markdown 報告印到 stdout

> ⚠️ 同樣需在你本機跑（cloud sandbox 對 sfb.gov.tw 的 GET 會 HTTP 403）。跑完把報告貼給 Claude Code 看，再決定 `fetch_qa.py` 的具體寫法。

---

## 免責聲明

本工具為非官方學習輔助工具，法令引用以主管機關正式公告為準。完整聲明見 `data/disclaimer.md` 或網站頁尾「免責聲明」連結。
