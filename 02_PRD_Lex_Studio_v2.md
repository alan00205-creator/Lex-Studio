# PRD：承銷研修所 / Lex Studio

> 文件版本：**v2.1**  
> 最後更新：2026-04-29  
> 對象：開發執行者（Claude Code）  
> 預期狀態:本文件用於指導 AI agent 從零建置整個系統

> **v2.1 變更紀錄**  
> - 工具正式命名定案：中文「承銷研修所」、英文「Lex Studio」  
> - 視覺色系從深色（金色 + 暗黑）改為**現代金融專業白**：米白底 + 純白卡片 + 深靛藍主色 + 點綴金  
> - 主視覺色 `--primary: #1e3a5f`（深靛藍），取代原本的金色作為主色  
> - 金色保留為點綴色（brand 字樣、section number）  
> - 加入陰影系統（`--shadow-sm`、`--shadow-md`），強化白底版的層次感  
> - 頂部導航 sticky 黏在頂部，方便長頁面切換  
> - 移除暗色版的雜訊紋理，採乾淨設計  
> - 視覺參考檔：`underwriter_lex_studio_light.html`
>
> **v2.0 變更紀錄（重大架構調整）**  
> 採用「**連結為主、學習為核**」混合策略，取代原本「自建法規資料庫」設計：
> - 移除自建法規條文 JSON（不再需要 `fetch_laws.py`、`fetch_exchange_rules.py`）
> - 法規條文一律連結到 **selaw.com.tw**（證基會證券暨期貨法令判解查詢系統）或主管機關官網
> - 工具核心定位：「題庫練習＋情境模擬＋問答集整合搜尋」，不重做法規查詢
> - 工程時程從 8 週縮短為 5 週
> - 法律授權風險降至最低
> - 法規資料即時性：使用者點擊看到的永遠是 selaw 最新版

---

## 0. 文件導讀（給 Claude Code）

這是一份**重新架構過的 PRD**，讀完應該能直接動手。建議閱讀順序：

1. §1 願景與目標（理解這個工具為什麼存在）
2. §2 核心架構決策（v2.0 最重要的章節，理解為什麼放棄自建法規）
3. §3 系統架構（理解模組邊界）
4. §4 資料來源與管線（注意：法規不再自建，問答集仍要解析）
5. §5–§9 各功能模組詳細規格
6. §11 開發任務分解（依照這個順序實作）
7. §12 驗收標準（確認完工）

開發過程中如有任何架構決策衝突，以 §1.3「核心原則」為準。

---

## 1. 願景與目標

### 1.1 願景

打造一個**手機友善、可分享網址**的承銷法令學習工具。讓使用者透過題庫、情境、問答集等學習方式持續精進承銷法令能力，**法規條文本身則導向官方權威來源**。

### 1.2 目標使用者

- 新進承銷輔導人員（剛入行）
- 資深承銷輔導人員（複習用）
- 證券業相關證照考試準備者
- 部門外的相關人員（透過網址分享使用）

### 1.3 核心原則（衝突時的優先順序）

1. **法令正確性最高優先**：寧可少功能，不能錯誤引用法條
2. **問答集嚴格保留主管機關原文**：不得用 AI 改寫
3. **法規條文不自建、直接導向官方來源**：使用者看到的永遠是 selaw、全國法規資料庫、證交所等官方版本
4. **所有引用必須可追溯回原始來源**：每個法條、問答、題目都要有官方連結
5. **手機優先**：所有 UI 在 480px 寬以下必須完整可用
6. **無使用者帳號系統**：學習進度存在 localStorage
7. **完全免費部署**：不採用任何需要付費的服務（網域除外）

### 1.4 非目標（不要做的事）

- ❌ 不自建法規條文資料庫（v2.0 變更）
- ❌ 不重做法規搜尋系統（selaw 已經做得很好）
- ❌ 不做使用者註冊／登入系統
- ❌ 不做後端 API、不做資料庫
- ❌ 不做付費功能、不做訂閱機制
- ❌ 不做即時推送通知
- ❌ 不用 React／Vue 等框架（純 vanilla HTML/CSS/JS）
- ❌ 不爬取 cgc.twse.com.tw（SPA 太難爬）
- ❌ 不抓取 selaw.com.tw 內容存成自己的資料（**該網站明確禁止未授權轉載**）

---

## 2. 核心架構決策（v2.0）

### 2.1 為什麼從「自建」改為「連結」

v1.x 設計嘗試自建 40 部法規的條文資料庫，每月排程同步。經過討論後發現幾個關鍵問題：

1. **selaw.com.tw 已經是業界公認的法規查詢入口**，櫃買中心自己也指引使用者去 selaw
2. **selaw 明確禁止未授權轉載**，自建若以爬取為基礎有授權風險
3. **全國法規資料庫每日更新，自建只能月更**——延遲對法令工具是致命缺點
4. **PCode 驗證、HTML 解析、版本追蹤等工程量高**——這些工作對「學習工具」的核心價值貢獻有限
5. **工具的真正差異化價值在「題庫練習＋問答集整合搜尋」**，不在「再做一個法規查詢」

### 2.2 v2.0 架構：連結為主、學習為核

**連結到外部官方來源（不自建）**：
- 全國法規（公司法、證交法、處理準則⋯）→ 連到 selaw.com.tw 或全國法規資料庫
- 證交所規章（上市審查準則⋯）→ 連到 twse-regulation.twse.com.tw
- 櫃買中心規章 → 連到 selaw 或 tpex.org.tw
- 公會自律規章 → 連到 twsa.org.tw

**自建（核心價值所在）**：
- 題庫（人工編寫＋AI 半自動產題＋人工校對）
- 情境模擬題
- 問答集整合搜尋（PDF 解析 + 跨類關鍵字搜尋）
- 學習進度（localStorage）
- 法規導航索引（一張對應表，把法規名稱對到外部連結）

### 2.3 法規導航索引設計

維護一個 `data/law_index.json`，把每部法規的名稱對應到三種外部連結：

```json
{
  "version": "1.0",
  "last_updated": "2026-04-29",
  "laws": [
    {
      "id": "A01",
      "name": "證券交易法",
      "category": "A 承銷核心",
      "abbreviation": "證交法",
      "primary_url": "https://www.selaw.com.tw/...",
      "moj_url": "https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=G0400001",
      "issuing_authority": "金管會",
      "common_articles": ["22", "28-2", "36", "43-6", "157-1"]
    }
  ]
}
```

`common_articles` 是常用條號，前端可提供「快速跳轉到第 X 條」按鈕（依靠全國法規資料庫的 `&FLNO=` 參數）。

---

## 3. 技術約束與檔案結構

### 3.1 技術棧

| 層 | 技術 | 理由 |
|---|---|---|
| 前端 | 純 HTML + CSS + Vanilla JS | 零相依、易維護、檔案小 |
| 字型 | Google Fonts: Noto Serif TC, Cormorant Garamond, JetBrains Mono | 中英襯線＋等寬三體混搭 |
| 資料抓取 | Python 3.11 + requests + beautifulsoup4 + pdfplumber | （僅問答集需要） |
| 自動化 | GitHub Actions | 免費，與 GitHub Pages 同生態 |
| 部署 | GitHub Pages | 免費、靜態、CDN 加速 |
| 進度儲存 | localStorage | 純前端 |
| 用量監控 | Cloudflare Web Analytics | 免費、無 cookie |

### 3.2 不允許的技術

- ❌ Node.js / npm 相依（前端不要 build step）
- ❌ TypeScript
- ❌ CSS 框架（Tailwind/Bootstrap）
- ❌ 資料庫
- ❌ 後端框架

### 3.3 瀏覽器相容性

- iOS Safari 14+
- Android Chrome 90+
- 桌面 Chrome / Edge / Safari / Firefox 最新兩個大版本

### 3.4 檔案結構（v2.0 簡化）

```
lex-studio/
├── index.html                 ← 主頁面
├── assets/
│   ├── style.css
│   └── app.js
├── data/                      ← 人工維護的資料
│   ├── law_index.json         ← 法規導航索引（v2.0 新增，取代 laws.json）
│   ├── quiz.json              ← 題庫
│   └── disclaimer.md          ← 免責聲明
├── output/                    ← 腳本自動產生
│   ├── qa.json                ← 問答集索引
│   └── qa_pdfs/               ← 原始 PDF 備份（解析用，不公開下載）
├── scripts/
│   ├── fetch_qa.py            ← 證期局問答集解析（v2.0 唯一保留的爬蟲）
│   ├── generate_quiz.py       ← AI 半自動產題（選用）
│   └── requirements.txt
├── .github/
│   └── workflows/
│       └── update-data.yml    ← 每月更新問答集
├── README.md
├── .gitignore
└── docs/
    ├── deployment.md
    ├── architecture.md
    └── monitoring.md
```

---

## 4. 資料來源與管線（v2.0 大幅簡化）

### 4.1 法規條文（不抓取，僅維護連結對應表）

法規條文一律以**外部連結**方式提供。維護方式為一份人工編寫的 `data/law_index.json`，內容如 §2.3 所示。

#### 4.1.1 連結優先順序（給 Claude Code 的決策依據）

不同來源各有強項，每部法規依下表決定 `primary_url`：

| 法規類別 | 優先連結目標 | URL 範例 |
|---|---|---|
| 全國法規（公司法、證交法等） | 全國法規資料庫 | `https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode={pcode}` |
| 同類別跨機構查詢需求 | selaw.com.tw | `https://www.selaw.com.tw/...` |
| 證交所規章 | 證交所法規分享知識庫 | `https://twse-regulation.twse.com.tw/TW/...` |
| 櫃買中心規章 | 櫃買中心或 selaw | `https://www.tpex.org.tw/...` 或 selaw |
| 公會自律規章 | 證券商公會 | `https://www.twsa.org.tw/D01/D016.html` |

#### 4.1.2 可深層連結的 URL 範例

**全國法規資料庫**支援深層連結到單一條文，這對「題目解析」非常有用：

- 法規全文：`https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=G0400001`
- 單一條文：`https://law.moj.gov.tw/LawClass/LawSingle.aspx?Pcode=G0400001&FLNO=22`

題庫的「法源」欄位應使用後者，使用者點擊直接看到第 22 條，不必在全文中找。

#### 4.1.3 待維護的法規清單

下表為**初始版本**，由執行者依承銷業務需求人工維護於 `data/law_index.json`。Claude Code 不需自行抓 PCode，而是根據以下名稱由執行者**逐一手動到 selaw 或全國法規資料庫搜尋取得正確 URL**：

##### A 類：承銷輔導必修核心（32 部）

A01 證券交易法 / A02 證券交易法施行細則 / A03 公司法 / A04 發行人募集與發行有價證券處理準則 / A05 外國發行人募集與發行有價證券處理準則 / A06 發行人募集與發行海外有價證券處理準則 / A07 公司募集發行有價證券公開說明書應行記載事項準則 / A08 公開發行公司年報應行記載事項準則 / A09 公開發行公司董事會議事辦法 / A10 公開發行公司審計委員會行使職權辦法 / A11 公開發行公司獨立董事設置及應遵循事項辦法 / A12 公開發行公司資金貸與及背書保證處理準則 / A13 公開發行公司取得或處分資產處理準則 / A14 公開發行公司建立內部控制制度處理準則 / A15 公開發行公司公開財務預測資訊處理準則 / A16 公開發行股票公司股務處理準則 / A17 公開發行公司股東會議事手冊應行記載及遵行事項辦法 / A18 公開發行公司出席股東會使用委託書規則 / A19 公開發行公司董事監察人股權成數及查核實施規則 / A20 公開發行公司股東分別行使表決權作業及遵行事項辦法 / A21 公開發行公司併購特別委員會設置及相關事項辦法 / A22 證券發行人財務報告編製準則 / A23 公開發行公司發行股票及公司債券簽證規則 / A24 公開收購公開發行公司有價證券管理辦法 / A25 公開收購說明書應行記載事項準則 / A26 上市上櫃公司買回本公司股份辦法 / A27 證券承銷商取得包銷有價證券出售辦法 / A28 證券交易法第四十三條之一第一項取得股份申報辦法 / A29 證交法第157條之1第5項及第6項重大消息範圍及其公開方式管理辦法 / A30 上市上櫃公司薪資報酬委員會設置及行使職權辦法 / A31 關係企業合併營業報告書關係企業合併財務報表及關係報告書編製準則 / A32 發行人發行認購（售）權證處理準則

##### E 類：會計師相關（4 部）

E02 會計師辦理公開發行公司財務報告查核簽證核准準則 / E03 會計師受託查核簽證財務報表規則 / E10 發行人證券商證券交易所會計主管資格條件及專業進修辦法 / E11 發行人證券商證券交易所會計主管進修機構審核辦法

##### H 類：跨境／特殊產品（4 部）

H01 華僑及外國人投資證券管理辦法 / H08 證券商發行指數投資證券處理準則 / H10 受託機構募集不動產投資信託或資產信託受益證券公開說明書應行記載事項準則 / H11 公開收購不動產投資信託受益證券管理辦法

##### X 類：證交所／櫃買中心／公會（3 部）

X01 臺灣證券交易所有價證券上市審查準則（→ twse-regulation.twse.com.tw）  
X02 財團法人中華民國證券櫃檯買賣中心證券商營業處所買賣有價證券審查準則（→ tpex.org.tw 或 selaw）  
X03 證券商承銷或再行銷售有價證券處理辦法（→ twsa.org.tw/D01/D016.html）

合計 **43 部**法規，全部以外部連結方式提供。

### 4.2 證期局問答集（v2.0 唯一需要抓取的資料）

**站台**：`https://www.sfb.gov.tw`  
**入口頁**：`/ch/home.jsp?id=858&parentpath=0,6`  
**子分類**：23 大類，每類一個 id（862~880, 1033, 1061~1073）

**抓取流程**：
1. 對每個 id，抓子頁 HTML
2. 用 BeautifulSoup 抽出 PDF 連結
3. 下載每個 PDF 到 `output/qa_pdfs/{category_id}/`
4. 每份 PDF 用 pdfplumber 抽文字
5. **不對問答內容做任何 AI 改寫**，原文直接存 JSON
6. 為每份 PDF 生成 metadata：標題、發布日期、檔案路徑、原始來源連結

#### 4.2.1 PDF 下載策略

**所有 PDF 下載連結指向證期局原網站**，不從 GitHub Pages 提供下載。理由：
- 節省頻寬（GitHub Pages 月限 100 GB）
- 保證使用者拿到主管機關當下最新版
- 法律安全（不替主管機關散佈其文件）

`qa.json` 內每筆 `documents` 都有 `source_url` 欄位指向證期局原始下載 URL。前端「下載原始 PDF」按鈕的 `href` 直接設為 `source_url`。

### 4.3 交易所創新板 FAQ

**單一 PDF**：`https://www.twse.com.tw/downloads/zh/products/tib_qa.pdf`  
**處理方式**：和 4.2 相同，下載解析存於 qa.json，原文連結指回 twse.com.tw。

### 4.4 資料 Schema

#### 4.4.1 `data/law_index.json`（v2.0 新增）

```json
{
  "version": "1.0",
  "last_updated": "2026-04-29",
  "laws": [
    {
      "id": "A01",
      "name": "證券交易法",
      "abbreviation": "證交法",
      "category": "A 承銷核心",
      "issuing_authority": "金管會",
      "primary_url": "https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=G0400001",
      "selaw_url": "https://www.selaw.com.tw/...",
      "article_url_template": "https://law.moj.gov.tw/LawClass/LawSingle.aspx?Pcode=G0400001&FLNO={article_no}",
      "common_articles": [
        { "no": "22", "topic": "募集發行申報生效" },
        { "no": "28-2", "topic": "庫藏股" },
        { "no": "36", "topic": "財報申報" },
        { "no": "43-6", "topic": "私募" },
        { "no": "157-1", "topic": "內線交易" }
      ]
    }
  ]
}
```

#### 4.4.2 `output/qa.json`

```json
{
  "fetched_at": "2026-04-29T10:00:00",
  "source": "https://www.sfb.gov.tw/ch/home.jsp?id=858",
  "categories": [
    {
      "id": 863,
      "name": "公開發行公司募集發行",
      "url": "https://www.sfb.gov.tw/ch/home.jsp?id=863&parentpath=0,6,858",
      "documents": [
        {
          "title": "員工認股權憑證疑義問答",
          "publish_date": "2023-06-27",
          "source_url": "https://www.sfb.gov.tw/uploaddowndoc?file=...",
          "local_pdf": "qa_pdfs/863/202306271657170.pdf",
          "raw_text": "（從 PDF 抽出的完整原文，不可改寫）",
          "page_count": 12
        }
      ]
    }
  ]
}
```

#### 4.4.3 `data/quiz.json`

```json
{
  "version": "1.0",
  "last_updated": "2026-04-29",
  "questions": [
    {
      "id": "Q001",
      "type": "scenario",
      "category": "募集發行",
      "difficulty": "medium",
      "question": "某上市公司辦理現金增資時，承銷商評估發現公司近三年財務預測達成率均低於80%，依規定應如何處理？",
      "options": [
        "無須特別處理，僅需揭露於公開說明書",
        "應於評估報告中表示意見並評估其對承銷之影響",
        "應拒絕承銷",
        "由公司自行向投資人說明即可"
      ],
      "correct_index": 1,
      "explanation": "承銷商有實質審查義務...",
      "source": {
        "law_id": "A04",
        "law_name": "發行人募集與發行有價證券處理準則",
        "article": "7",
        "url": "https://law.moj.gov.tw/LawClass/LawSingle.aspx?Pcode=G0400014&FLNO=7"
      }
    }
  ]
}
```

---

## 5. 模組規格：法條速查（v2.0 重新設計為「法規導航」）

### 5.1 功能描述

**這個模組不再是「條文搜尋器」，而是「法規導航中心」**。使用者可以快速找到正確的官方頁面，由官方頁面提供完整條文內容。

### 5.2 UI 元件

#### 5.2.1 主頁：法規清單

依分類（A/E/H/X 四組）顯示所有 43 部法規，每張卡片顯示：
- 法規名稱（粗體）
- 縮寫（小字）
- 主管機關 tag
- 「常用條文」chips（點擊直接跳到該條）
- 「查看全文 ↗」按鈕（跳到 primary_url）

#### 5.2.2 搜尋框

支援以下輸入：
- 法規名稱關鍵字 → 過濾卡片
- 法規縮寫（如「證交法」、「公司法」）→ 過濾卡片
- 「法規 條號」格式（如「證交法 22」、「公司法 167-2」）→ **直接給出深層連結**，使用者點擊跳到對應條文

#### 5.2.3 智慧解析範例

```
使用者輸入：「證交法 22」
↓
工具解析：法規 = 證券交易法 (A01)，條號 = 22
↓
顯示：[ 證交法 第 22 條 ]
      點此查看 → 全國法規資料庫
```

### 5.3 「跳轉式查詢」與「自建查詢」的差異

| 維度 | v1.x 自建 | v2.0 跳轉 |
|---|---|---|
| 條文內容呈現 | 工具內顯示完整條文 | 跳轉到外部官方頁面 |
| 即時性 | 每月更新（最大延遲 1 個月） | 即時（永遠是官方當下版本） |
| 工程量 | 高（爬蟲、解析、PCode 驗證） | 低（僅維護一張對應表） |
| 法律風險 | 中（爬取網頁有授權問題） | 極低 |
| 使用者體驗 | 沉浸式、不跳離 | 跳離工具，但看到的是權威來源 |
| 跨機構搜尋 | 需自己實作 | selaw 已內建 |

### 5.4 對使用者體驗的處理

外部跳轉本身會打斷學習流程。緩解方式：

- **新分頁開啟**所有外部連結（`target="_blank" rel="noopener"`），不離開工具本身
- 在跳轉前的卡片內**預覽必要 metadata**：法規名稱、主管機關、最近更新時間（從 selaw / 全國法規網頁顯示的修正日期文字爬取一次性更新）
- 提供「常用條文」chips，避免使用者跳到全文後又要找

---

## 6. 模組規格：問答集

### 6.1 功能描述

讓使用者瀏覽證期局 23 大類問答集與交易所 FAQ。**嚴格保留主管機關原文**。

### 6.2 UI 元件

- 大類清單（首頁）：顯示 23 大類 + 創新板 FAQ，每類顯示文件數
- 文件清單（點入大類後）：每筆顯示標題、發布日期、檔案大小
- 全文搜尋：跨類關鍵字搜尋（這是工具相對 selaw 的差異化價值之一）

### 6.3 設計原則

> **重要：問答集內容絕對不可由前端 JS 動態改寫、摘要、或重新格式化。**

每筆問答必須附：
- 主管機關原始 URL（連回 sfb.gov.tw）
- PDF 發布日期
- 「下載原始 PDF（連至證期局網站）↗」按鈕

### 6.3.1 PDF 下載策略

**所有 PDF 下載連結一律指向主管機關原網站**（詳見 §4.2.1）。

範例 HTML：

```html
<a class="btn-download" 
   href="https://www.sfb.gov.tw/uploaddowndoc?file=..." 
   target="_blank" 
   rel="noopener noreferrer">
  下載原始 PDF（連至證期局網站）↗
</a>
```

### 6.4 搜尋實作

純前端關鍵字搜尋 `qa.json` 內 `raw_text` 欄位，命中時：
- 顯示命中片段（前後各 50 字）
- 點擊跳轉到該文件詳細頁

---

## 7. 模組規格：題庫練習

### 7.1 功能描述

選擇題練習，分類分難度，記錄答題進度。

### 7.2 UI 元件

- 開始畫面：選擇分類、難度、題數（10/20/50 題）
- 答題畫面：題目卡片＋4 選項＋進度點＋「下一題」
- 答題反饋：選項顯示對／錯顏色，下方展開解析＋法源連結
- 結算畫面：答對率、答錯題數、「複習錯題」按鈕

### 7.3 法源連結處理（v2.0 重點）

每題的解析必須連結到具體法源：

```html
<div class="explanation">
  <p>承銷商有實質審查義務，發現財測達成率偏低時，必須在評估報告中具體表達意見。</p>
  <p class="source">
    法源依據：
    <a href="https://law.moj.gov.tw/LawClass/LawSingle.aspx?Pcode=G0400014&FLNO=7" 
       target="_blank" rel="noopener">
      發行人募集與發行有價證券處理準則 第 7 條 ↗
    </a>
  </p>
</div>
```

### 7.4 進度儲存（localStorage）

```javascript
// localStorage key: 'underwriter_lex_progress'
{
  "version": 1,
  "stats": {
    "total_answered": 142,
    "total_correct": 110,
    "streak_days": 7,
    "last_practice_date": "2026-04-29"
  },
  "wrong_questions": ["Q003", "Q017", "Q042"],
  "category_progress": {
    "募集發行": { "answered": 32, "correct": 25 },
    "公司治理": { "answered": 28, "correct": 23 }
  }
}
```

### 7.5 簡易間隔重複

- 答錯的題目 1 天後再考一次
- 連續答對 3 次的題目降低出現頻率
- 「錯題本」獨立分頁可隨時複習

### 7.6 出題方式（v2.0 簡化）

第一階段純人工編寫 30–50 題種子題目，每題綁定法源 URL。後續可選用 `scripts/generate_quiz.py` 用 AI 半自動產題（必須人工審閱才上線）。

---

## 8. 模組規格：情境模擬

### 8.1 功能描述

實務案例判斷題，與題庫練習共用 UI，但題型限定為 `type: "scenario"`。

### 8.2 與題庫練習的差異

| 維度 | 題庫練習 | 情境模擬 |
|---|---|---|
| 題型 | 條文知識選擇題 | 實務案例判斷題 |
| 題目特徵 | 「依X條規定，應如何...」 | 「某公司遇到X情況，承銷商應...」 |
| 解析重點 | 條文內容 | 實務考量＋法源依據 |

### 8.3 題目來源

從證期局問答集（特別是「常見缺失」「輔導評估」相關 PDF）萃取真實情境，再人工加工成題目。

---

## 9. 模組規格：每日挑戰

### 9.1 功能描述

首頁顯示一題「今日挑戰」，鼓勵使用者每天打開工具。

### 9.2 邏輯

```javascript
function getDailyQuestion() {
  const today = new Date().toISOString().slice(0, 10);
  const seed = hashString(today);
  const allQuestions = loadQuiz().filter(q => q.type === "scenario");
  const idx = seed % allQuestions.length;
  return allQuestions[idx];
}
```

### 9.3 連續天數

完成今日挑戰即 streak +1。連續中斷後 streak 歸零。顯示「累計完成 X 天」。

---

## 10. UI / 視覺設計

### 10.1 設計風格（v2.1 更新：白色系）

設計方向為「**現代金融專業白**」，靈感來自 Bloomberg、Stripe 文件等專業金融工具：明亮但不廉價、專業但不生硬。

- **三層白色基底**：米白底（#fafaf7）+ 純白卡片（#fff）+ 淡米色次層（#f4f2ec）
- **主色：深靛藍** #1e3a5f（取代原本的金色）——國際金融業常見的權威色
- **點綴色：金色** #a07d3a——保留少量用於 brand 字樣、section number、強調標籤
- **襯線中文**：Noto Serif TC
- **裝飾英文襯線**：Cormorant Garamond
- **等寬體**：JetBrains Mono
- **陰影系統**：白底必須以細微陰影建立層次（卡片 hover 時陰影加深）
- **不使用**：純白背景、雜訊紋理、過度漸層

### 10.2 設計變數（v2.1 白色系）

```css
:root {
  /* 背景三層 */
  --bg: #fafaf7;           /* 米白底色 */
  --bg-soft: #f4f2ec;      /* 略深米色，次層用 */
  --bg-card: #ffffff;      /* 純白卡片 */

  /* 分隔線 */
  --line: #e5e3dd;
  --line-strong: #d4d1c8;

  /* 文字三層 */
  --ink: #1a1a1a;          /* 主文字 */
  --ink-soft: #5a5a5a;     /* 次要文字 */
  --ink-dim: #8a8a8a;      /* 弱化文字 */

  /* 主色（深靛藍）*/
  --primary: #1e3a5f;
  --primary-soft: #3b5a82;

  /* 點綴金色 */
  --gold: #a07d3a;
  --gold-soft: #c5a565;

  /* 狀態色 */
  --crimson: #a73a3a;      /* 答錯 */
  --jade: #2d7a4f;         /* 答對 */

  /* 陰影 */
  --shadow-sm: 0 1px 2px rgba(30, 58, 95, 0.04), 0 0 0 1px rgba(30, 58, 95, 0.04);
  --shadow-md: 0 4px 12px rgba(30, 58, 95, 0.06), 0 0 0 1px rgba(30, 58, 95, 0.04);

  /* 字型 */
  --serif: "Noto Serif TC", "Cormorant Garamond", serif;
  --display: "Cormorant Garamond", "Noto Serif TC", serif;
  --mono: "JetBrains Mono", monospace;
}
```

### 10.3 色彩使用規則

- `--primary` 深靛藍：tab 啟用態、chip 啟用態、按鈕、focus 邊框、條文左側強調條
- `--gold` 金色：brand 字樣、section number、search highlight 文字、問答集標籤
- `--ink` 主黑：主要內文
- `--ink-soft` / `--ink-dim`：次要與弱化文字（依視覺層級）
- `--bg-card` 純白：所有卡片、輸入框背景
- `--bg-soft` 米色：詳細頁的條文展示區（與卡片區隔）

**避免：**
- 不要把 primary 與 gold 大面積並用（會打架），保持 primary 為主、gold 為點綴
- 不要在白底上用太淺的灰（< #aaa），無障礙對比不夠

### 10.4 排版規範

- 主容器最大寬度：480px
- 行高：1.85（中文閱讀舒適度）
- 觸控區域最小：44 × 44 px
- 圓角：3px（內部小元素）/ 6px（卡片）

### 10.5 動畫原則

- 頁面切換：0.3 秒 fade
- 卡片 hover：陰影從 sm 提升到 md
- 卡片 active：scale(0.99)
- 不過度動畫

---

## 11. 開發任務分解（v2.0 縮短至 5 週）

### Phase 1：基礎建置（第一週）

- [ ] **T1.1** 建立 GitHub repo `lex-studio`
- [ ] **T1.2** 設定 .gitignore、README.md
- [ ] **T1.3** 把現有的 v2 原型放入 `index.html`
- [ ] **T1.4** 啟用 GitHub Pages，確認網址可訪問
- [ ] **T1.5** 將 CSS/JS 從 index.html 抽出到 `assets/`
- [ ] **T1.6** 加入「免責聲明」彈窗或頁尾連結

### Phase 2：法規導航中心（第二週）

- [ ] **T2.1** 編寫 `data/law_index.json` 範本（先做 5–10 部最常用法規驗證架構）
- [ ] **T2.2** 前端「法規導航」分頁：分類顯示、卡片 UI、外部連結跳轉
- [ ] **T2.3** 智慧搜尋：解析「法規縮寫 + 條號」輸入，產生深層連結
- [ ] **T2.4** 補完所有 43 部法規的 `law_index.json` 條目（人工查 URL，最費時的工作）
- [ ] **T2.5** 「常用條文」chips 標記與深層跳轉測試

### Phase 3：問答集解析（第三週）

- [ ] **T3.1** 完成 `scripts/fetch_qa.py`，能爬證期局 23 大類所有 PDF
- [ ] **T3.2** PDF 內文抽取（pdfplumber），保留段落結構
- [ ] **T3.3** 加入交易所創新板 FAQ
- [ ] **T3.4** 設計 `.github/workflows/update-data.yml`，每月自動更新問答集
- [ ] **T3.5** 前端新增「問答集」分頁，分類瀏覽 + 跨類搜尋
- [ ] **T3.6** 點擊文件展開閱讀（純文字模式）+ 「原始 PDF」連結到證期局

### Phase 4：題庫與情境（第四週）

- [ ] **T4.1** 設計 `data/quiz.json` schema（含法源深層連結）
- [ ] **T4.2** 人工編寫 30 題種子題目（10 題基礎 + 10 題情境 + 10 題進階）
- [ ] **T4.3** 前端題庫練習功能：選擇題答題、解析展開、進度條
- [ ] **T4.4** 解析中嵌入「法源依據」外部連結
- [ ] **T4.5** 前端情境模擬功能：共用題庫 UI，過濾 type
- [ ] **T4.6** localStorage 進度儲存與讀取
- [ ] **T4.7** 錯題本：獨立分頁
- [ ] **T4.8** 簡易間隔重複

### Phase 5：每日挑戰、優化與發佈（第五週）

- [ ] **T5.1** 首頁加入「今日挑戰」卡片
- [ ] **T5.2** 連續天數計算
- [ ] **T5.3** 學習進度頁
- [ ] **T5.4** 手機與桌面實機測試
- [ ] **T5.5** 加入 manifest.json（PWA）
- [ ] **T5.6** （選用）自訂網域設定
- [ ] **T5.7** 寫使用說明（首次使用者引導）
- [ ] **T5.8** 加入 Cloudflare Web Analytics 用量監控（詳見 §16）
- [ ] **T5.9** 部門內部宣傳

---

## 12. 驗收標準

### 12.1 第一階段驗收（基礎可用）

- ✅ 網址能在手機 Safari 與 Chrome 開啟
- ✅ 「法規導航」能顯示所有 43 部法規的卡片
- ✅ 點任一法規卡片能跳轉到對應的官方網頁（selaw / 全國法規 / 證交所等）
- ✅ 智慧搜尋「證交法 22」能直接給出深層連結
- ✅ 答對 1 題以上題目，重新整理頁面進度仍在

### 12.2 完整版驗收

- ✅ 證期局 23 大類問答集可瀏覽（從證期局實抓）
- ✅ 至少 30 題的題庫，每題都有可點擊的法源連結
- ✅ 答題進度能跨次保存
- ✅ 每月自動同步問答集運作正常
- ✅ 首頁載入時間 < 3 秒（4G 網路）
- ✅ Lighthouse 行動版分數：Performance > 80，Accessibility > 90

### 12.3 品質紅線（任一不過則 fail）

- ❌ 法規導航的連結不能失效
- ❌ 問答集內容不能與證期局原文不一致
- ❌ 任何條文／問答／題目必須能追溯回原始來源 URL
- ❌ 不能在 PDF 解析過程「改寫」問答內容
- ❌ 不能洩漏使用者答題資料到任何外部服務

---

## 13. 法律與合規考量

### 13.1 資料授權

- **selaw.com.tw**：僅作為連結目標，**絕不抓取其內容存於本工具**
- **全國法規資料庫**：政府公開資料，連結與引用名稱無問題
- **證期局問答集**：公開資料，原文呈現需標示來源
- **證券商公會**：自律規章公開
- **交易所**：公開 FAQ，連結與引用無問題

### 13.2 必須在工具內呈現的免責聲明

```
本工具為非官方學習輔助工具，內容彙整自下列公開資料源：
- 法務部全國法規資料庫
- 金融監督管理委員會證券期貨局
- 中華民國證券商業同業公會
- 臺灣證券交易所、證券櫃檯買賣中心
- 證券暨期貨市場發展基金會（selaw）

法令引用以主管機關正式公告為準。本工具不對其資訊之即時性、
準確性、完整性負法律責任。實務應用請洽合格法律或會計師。
```

### 13.3 個資與分析

- 不蒐集任何使用者個資
- 不使用 Google Analytics / Facebook Pixel
- 流量統計使用 Cloudflare Web Analytics（隱私友善）

---

## 14. 風險與已知議題

| 風險 | 影響 | 緩解 |
|---|---|---|
| selaw 網址結構改變 | 連結失效 | 維護 `law_index.json` 時優先使用全國法規資料庫 URL（更穩定）；定期人工巡檢 |
| 證期局新增分類 | 漏抓新類別 | 腳本用迴圈遍歷已知 ID 範圍而非寫死；定期人工檢查首頁 |
| 修法後題庫過時 | 解析錯誤 | 題目綁定法源條號；維護人定期檢視 |
| 部門內網擋 GitHub Pages | 內部使用者無法開啟 | 與資安單位協調白名單 |
| GitHub Pages 頻寬超量 | 網站可能被暫時停用 | PDF 連結指向官方網站；加入用量監控；月用量達 50 GB 時準備搬家 Cloudflare Pages |
| 外部連結被使用者抱怨「跳離工具」 | 體驗不佳 | 全部 `target="_blank"` 開新分頁；卡片預覽足夠 metadata；提供常用條文 chips |

---

## 15. 附錄

### 15.1 參考連結

- 全國法規資料庫：https://law.moj.gov.tw/
- 全國法規 API：https://law.moj.gov.tw/api/
- selaw 證券暨期貨法令判解查詢系統：https://www.selaw.com.tw/
- 證期局問答集首頁：https://www.sfb.gov.tw/ch/home.jsp?id=858&parentpath=0,6
- 證券商公會法規頁：https://www.twsa.org.tw/D01/D012.html
- 證交所法規分享知識庫：https://twse-regulation.twse.com.tw/
- 證交所發行市場分類：https://twse-regulation.twse.com.tw/TW/Categories/Categories02.aspx
- 櫃買中心法規查詢：https://www.tpex.org.tw/zh-tw/bond/service/law.html
- 創新板 FAQ：https://www.twse.com.tw/TIB/zh/qa.html

### 15.2 字型授權

- Noto Serif TC：SIL Open Font License 1.1
- Cormorant Garamond：SIL Open Font License 1.1
- JetBrains Mono：SIL Open Font License 1.1

從 Google Fonts CDN 載入。

### 15.3 命名慣例

- 檔案：snake_case（`fetch_qa.py`）
- JS 變數／函式：camelCase
- CSS 類別：kebab-case
- CSS 變數：kebab-case 加 `--` 前綴
- JSON keys：snake_case
- Git commit：Conventional Commits（`feat:`, `fix:`, `chore:`, `docs:`）

### 15.4 給 Claude Code 的執行提示

當你要實作某個任務時：

1. 先讀完本 PRD 對應章節
2. 嚴格遵守 §1.3 核心原則
3. 寫程式時優先簡潔可讀
4. 每完成一個 Phase，自我驗收 §12 對應條目
5. **特別注意 v2.0 的策略變更**：法規不自建、不抓取，僅維護連結對應表
6. 遇到問答集 PDF 解析問題時，先寫小腳本探勘真實格式
7. 完工後更新 `docs/architecture.md`，記錄你做了什麼決策、為什麼

---

## 16. 頻寬與用量監控

### 16.1 為什麼需要監控

GitHub Pages 對免費部署有以下軟性限制：
- 每月頻寬上限 100 GB（軟性，超過會先收警告信）
- 倉庫建議 1 GB 以下
- 每小時 10 次 build

對本工具的預期使用量（部門內共用 + 同業分享），這些限制非常寬鬆。但仍需監控以避免突發狀況。

### 16.2 工具選擇：Cloudflare Web Analytics

**首選方案**：Cloudflare Web Analytics（免費、隱私友善、不需 cookie banner）

選擇理由：
- 完全免費，無流量上限
- 不使用 cookie，不需要顯示同意彈窗（符合個資法）
- 不追蹤個別使用者
- 比 Plausible 簡單

### 16.3 實作步驟

1. 註冊免費 Cloudflare 帳號：https://dash.cloudflare.com/sign-up
2. Web Analytics → Add a site → 輸入網址
3. 取得追蹤代碼，加入 `index.html` 的 `</body>` 前

```html
<script defer 
  src='https://static.cloudflareinsights.com/beacon.min.js' 
  data-cf-beacon='{"token": "YOUR_TOKEN"}'>
</script>
```

### 16.4 監控指標與閾值

| 指標 | 綠燈 | 黃燈 | 紅燈 |
|---|---|---|---|
| 每月頁面瀏覽 | < 10K | 10K–50K | > 50K |
| 每月不重複訪客 | < 500 | 500–2K | > 2K |
| 預估月頻寬 | < 5 GB | 5–30 GB | > 30 GB |
| 平均載入時間 | < 2 秒 | 2–5 秒 | > 5 秒 |

### 16.5 接近上限時的應對

**方案 A**：減少自家頻寬消耗
- 確認 PDF 走證期局網站不走自家頻寬
- JSON lazy load 拆分
- 啟用 Cloudflare CDN 代理

**方案 B**：搬家到 Cloudflare Pages（仍免費，無流量上限）

**方案 C**：付費升級（最後手段）

### 16.6 給 Claude Code 的指示

實作 T5.8 時：
1. 在 `index.html` 加入 Cloudflare Web Analytics
2. 在 README.md 加入「如何查看用量」段落
3. **不要**加入任何記錄使用者個人資料的追蹤
4. **不要**用 Google Analytics
5. 在 `docs/monitoring.md` 記錄監控設定與行動方案

---

完成。建議先執行 Phase 1 的 T1.1–T1.4，產出第一個可訪問的網址，再繼續往下。
