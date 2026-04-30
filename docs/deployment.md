# 部署指南

> 對象：第一次部署的維護人員。
> 整個流程約 15 分鐘。

---

## 0. 前置條件

- GitHub 帳號（已有 `alan00205-creator/lex-studio` repo）
- 一個瀏覽器（不需要本機環境）

---

## 1. 啟用 GitHub Pages

1. 開啟 `https://github.com/alan00205-creator/lex-studio/settings/pages`
2. **Source**：選 `Deploy from a branch`
3. **Branch**：選 `main`，folder 選 `/ (root)`
4. 按 **Save**
5. 等 1–2 分鐘，網址會出現在頁面上方：
   ```
   https://alan00205-creator.github.io/lex-studio/
   ```

> 若想先在 feature branch 預覽（不切換 main），可改選對應分支。確認 OK 再切回 main。

---

## 2.（選擇性）連結預覽：raw.githack

不想開 Pages 也能立即預覽：
```
https://raw.githack.com/alan00205-creator/lex-studio/main/index.html
```
任何分支都可以替換 URL 中的分支名。手機 / 桌面瀏覽器皆可。

---

## 3. 啟用 Cloudflare Web Analytics（選擇性）

詳見 `docs/monitoring.md`。簡述：

1. 註冊 Cloudflare 免費帳號
2. Web Analytics → Add a site → 輸入 Pages 網址
3. 取得 token，編輯 `index.html` 末尾，把 `REPLACE_WITH_YOUR_TOKEN` 換成實際值，反註解整段 `<script>` 標籤
4. commit + push

---

## 4. 設定每月自動更新問答集

`.github/workflows/update-data.yml` 已就緒。第一次需要：

1. 開啟 `https://github.com/alan00205-creator/lex-studio/actions`
2. 左側選 **Update Q&A data**
3. 右上 **Run workflow** → 選 main → 按綠色 Run
4. 等 5–10 分鐘（首次解析 23 大類 PDF 較慢）
5. 跑完會自動 commit `output/qa.json` 與 `output/qa_pdfs/` 到 main

之後每月 1 號 02:00 UTC（台灣時間 10:00）自動觸發，無需介入。

> ⚠️ 工作流需要 `contents: write` 權限。Repo Settings → Actions → General → Workflow permissions 確認選「Read and write permissions」。

---

## 5.（選擇性）自訂網域

1. 在你的網域 DNS 加 CNAME：`learn.example.com → alan00205-creator.github.io`
2. 在 repo 根目錄新增 `CNAME` 檔案，內容為 `learn.example.com`
3. 推到 main，Pages 會自動發 SSL 憑證
4. Settings → Pages → Custom domain 填入網址 → 勾「Enforce HTTPS」

---

## 6. 驗證部署

打開網址後依序檢查：

| 項目 | 預期 |
|---|---|
| 首頁載入 | 看到「今日挑戰」+ 進度卡片 |
| 點「題庫練習」 | 可以選分類 / 難度 / 題數 → 答題 → 看結算 |
| 點「法規導航」 | 看到 8 部法規卡片（補完前）+ 分類 chips |
| 智慧查詢「證交法 22」 | 出現命中 banner，點擊可跳到全國法規資料庫單條 |
| 點「問答集」 | 顯示「Phase 3 解析中」（在 Q&A workflow 第一次跑完前） |
| F12 看 Console | 沒有 error |
| 答 1 題 → 重新整理 | 進度仍在（localStorage） |

---

## 7. 常見問題

### Pages 出現 404？
- 確認 `index.html` 在 main 分支根目錄
- Pages 第一次發佈需 1–2 分鐘
- repo 必須是 public（private repo 的 Pages 需 GitHub Pro）

### 字型載不出來？
- 確認瀏覽器允許 `fonts.googleapis.com`
- 部門內網若擋 Google Fonts，可在 `index.html` 移除 preconnect 與 fonts.googleapis.com link，或改用 self-host（會增加維護成本）

### 工作流跑失敗？
- 檢查 Actions 頁面 log
- 多半是 `sfb.gov.tw` 短暫 5xx，等下次排程或手動重跑
- 若持續失敗，可能是 sfb 改了 HTML 結構 → 跑 `python3 scripts/explore_sfb.py` 看新結構，調 `parse_subcategory_documents`

### 部門內網擋 GitHub Pages？
- 與資安單位協調白名單
- 或換到 Cloudflare Pages（仍免費，部署方式幾乎相同）
