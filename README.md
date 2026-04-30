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
| Phase 2 T2.4 | 補完 43 部法規條目 | ⏳ 進行中（人工） |
| Phase 2 T2.5 | URL 驗證腳本 | ⏳ 待開發 |
| Phase 3 | 證期局問答集解析 | ⏸ 未開始 |
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

`data/law_index.json` 為人工維護。新增 / 修正法規條目流程請見該檔的 `_instructions_for_maintainer` 區塊，或參考 `PRD MEMO/02_PRD_Lex_Studio_v2.md` §4.4.1。

---

## 免責聲明

本工具為非官方學習輔助工具，法令引用以主管機關正式公告為準。完整聲明見 `data/disclaimer.md` 或網站頁尾「免責聲明」連結。
