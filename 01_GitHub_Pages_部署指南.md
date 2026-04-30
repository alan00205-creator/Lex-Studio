# GitHub Pages 部署指南

> 對象：執行者本人  
> 預估時間：第一次設定約 30–45 分鐘，之後每次更新只要 `git push`  
> 成本：NT$0/月（網域選用，最多 NT$800/年）

---

## 一、事前準備（10 分鐘）

### 1.1 註冊 GitHub 帳號

如果還沒有帳號，到 https://github.com 註冊。建議用部門共用 email 註冊一個團隊帳號（例如 `taishin-securities-tool`），未來不會綁在個人離職風險上。

### 1.2 安裝 Git

- **macOS**：`xcode-select --install` 或從 https://git-scm.com 下載
- **Windows**：從 https://git-scm.com/download/win 下載安裝
- 驗證：終端機輸入 `git --version`，看到版本號就成功

### 1.3 安裝 Python 3.10+

- **macOS**：`brew install python` 或從 https://python.org 下載
- **Windows**：從 https://python.org 下載，安裝時勾選 "Add Python to PATH"
- 驗證：`python --version` 或 `python3 --version`

### 1.4 設定 Git 身份

```bash
git config --global user.name "你的名字"
git config --global user.email "你的email@example.com"
```

---

## 二、建立 Repository 並上傳程式碼（10 分鐘）

### 2.1 在 GitHub 建立新 Repository

1. 登入 GitHub → 右上角 `+` → `New repository`
2. Repository name 填：`lex-studio`（或你想要的名字）
3. **Visibility 選 Public**（GitHub Pages 免費版只支援 Public repo；如要 Private 需要升級 Pro）
4. **不要**勾選 "Add a README"、"Add .gitignore"、"Choose a license"
5. 點 `Create repository`

### 2.2 把程式碼放到本機

```bash
# 在你電腦選一個工作目錄，例如 ~/Projects
cd ~/Projects

# 建立專案資料夾
mkdir lex-studio
cd lex-studio

# 初始化 git
git init
git branch -M main
```

接下來建立以下檔案結構（檔案內容用前面對話中提供的版本）：

```
lex-studio/
├── index.html              ← 把 underwriter_lex_studio_light.html 改名為 index.html
├── scripts/
│   ├── fetch_laws.py
│   └── fetch_twsa_rules.py
├── output/                 ← 一開始是空的，腳本會產生 JSON
├── .github/
│   └── workflows/
│       └── update-laws.yml ← 自動更新工作流（下面會給內容）
├── README.md
└── .gitignore
```

### 2.3 建立 `.gitignore`

```
# Python
__pycache__/
*.pyc
.venv/
venv/

# 系統
.DS_Store
Thumbs.db

# 編輯器
.vscode/
.idea/

# 暫存
*.tmp
*.log
```

### 2.4 建立 `README.md`

```markdown
# 承銷研修所 / Lex Studio

供承銷輔導人員持續精進法令能力的學習工具。

- 法規資料源：法務部全國法規資料庫官方 API
- 公會法規：證券商公會自律規章
- 問答集：金管會證期局、臺灣證交所
- 同步頻率：每月自動更新

## 免責聲明
本工具為非官方學習輔助工具，內容彙整自公開資料。法令引用以主管機關正式公告為準。
```

### 2.5 第一次推送到 GitHub

```bash
git add .
git commit -m "Initial commit: 承銷研修所 v1"

# 把下面 YOUR_USERNAME 換成你的 GitHub 帳號
git remote add origin https://github.com/YOUR_USERNAME/lex-studio.git
git push -u origin main
```

第一次 push 會要求登入。GitHub 已不接受密碼，要用 Personal Access Token：
1. GitHub → 右上角頭像 → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token
2. 勾選 `repo` 全部權限
3. 複製產生的 token（這只會顯示一次！），密碼欄位貼上 token

---

## 三、啟用 GitHub Pages（5 分鐘）

1. 進入你的 repo 頁面 → 上方 `Settings` → 左側 `Pages`
2. Source 選 `Deploy from a branch`
3. Branch 選 `main`，資料夾選 `/ (root)`
4. 點 `Save`
5. 等 1–2 分鐘，重新整理頁面，會看到綠色提示：

   > Your site is live at `https://YOUR_USERNAME.github.io/lex-studio/`

恭喜，網址可以分享了。手機開啟試試看。

---

## 四、自動同步法規（GitHub Actions，10 分鐘）

讓 GitHub 每月自動執行 `fetch_laws.py`，commit 最新法規資料到 repo。前端會自動讀到新版。

建立檔案 `.github/workflows/update-laws.yml`：

```yaml
name: 每月自動同步法規

on:
  schedule:
    # 每月 1 號 UTC 02:00（台灣時間早上 10:00）執行
    - cron: '0 2 1 * *'
  workflow_dispatch:  # 允許手動觸發

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install requests beautifulsoup4 pdfplumber

      - name: Fetch laws from MOJ
        run: python scripts/fetch_laws.py
        continue-on-error: true

      - name: Fetch TWSA rules
        run: python scripts/fetch_twsa_rules.py
        continue-on-error: true

      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add output/
          if git diff --staged --quiet; then
            echo "無變更，跳過"
          else
            git commit -m "chore: 自動同步法規 $(date +%Y-%m-%d)"
            git push
          fi
```

推送這個 workflow：

```bash
git add .github/
git commit -m "ci: 加入每月自動同步法規工作流"
git push
```

### 4.1 立刻手動測試一次

1. GitHub repo 頁面 → 上方 `Actions`
2. 左側選 `每月自動同步法規`
3. 右側點 `Run workflow` → `Run workflow`（綠色按鈕）
4. 等 1–3 分鐘，看是否成功（綠勾代表成功，紅叉代表失敗）

如果失敗，點進去看 log，常見問題：
- `urllib.error.HTTPError 403`：MOJ API 暫時不可用，重試即可
- `No module named 'requests'`：dependencies 安裝失敗，檢查 yml 裡的 pip install 那行
- `Permission denied`：Settings → Actions → General → Workflow permissions 改成 "Read and write permissions"

成功後，`output/laws.json` 會自動 commit 進 repo，前端立刻吃到最新資料。

---

## 五、自訂網域（選用，5 分鐘設定 + 等 DNS 生效）

預設網址是 `https://YOUR_USERNAME.github.io/lex-studio/`，可以分享但不夠漂亮。如果想要 `https://lex-studio.tw` 這種網址：

### 5.1 買網域（一次性）

推薦三個選擇（年費都差不多）：

- **Cloudflare Registrar** - 約 NT$300/年（最便宜，要先有 Cloudflare 帳號）
- **Namecheap** - 約 NT$400/年
- **GoDaddy** - 約 NT$600/年（中文介面，刷卡好處理）

`.tw` 比 `.com` 貴一點，純粹看你想要什麼結尾。

### 5.2 設定 DNS

1. 在 GitHub repo → Settings → Pages
2. Custom domain 欄位輸入你買的網域（例如 `lex-studio.tw`）→ Save
3. 到網域註冊商的 DNS 設定頁，加入以下 A records 指向 GitHub：

   ```
   類型: A
   名稱: @
   值: 185.199.108.153
   值: 185.199.109.153
   值: 185.199.110.153
   值: 185.199.111.153
   ```

4. 也可以加一個 CNAME 把 `www.lex-studio.tw` 也指過來：

   ```
   類型: CNAME
   名稱: www
   值: YOUR_USERNAME.github.io
   ```

5. 等 10 分鐘到幾小時 DNS 生效。回到 GitHub Pages 設定頁，勾選 `Enforce HTTPS`（會自動申請 Let's Encrypt 憑證）

---

## 六、日常更新（之後每次都這樣）

### 修改前端 / 加題庫 / 改文案

```bash
# 在本機修改檔案後
git add .
git commit -m "feat: 新增 XX 功能"
git push

# 1-2 分鐘後 GitHub Pages 自動重新部署，網址內容更新
```

### 法規資料

每月自動更新，不用手動處理。如果想立刻更新，到 GitHub Actions 手動觸發一次。

---

## 七、給使用者的分享方式

### 直接傳網址
- LINE / 簡訊 / Email 直接傳 `https://lex-studio.tw`
- 對方點開即用，不需註冊

### 加到手機主畫面（變成「App」）
告訴使用者：
- **iPhone**：Safari 開網址 → 下方分享按鈕 → 「加入主畫面」
- **Android**：Chrome 開網址 → 右上選單 → 「加到主畫面」

加完之後桌面會出現 icon，點開像 App 一樣全螢幕，看不到瀏覽器網址列。

### QR Code
可以用 https://www.qrcode-monkey.com 之類的免費工具產一張 QR code，印在文宣或內訓投影片上。

---

## 八、常見問題

**Q: 部門內網會不會擋這個網址？**  
A: GitHub Pages 是境外服務，部分公司 firewall 會擋。如果遇到，請部門資安開白名單 `*.github.io` 與你買的網域。

**Q: 網站當機怎麼辦？**  
A: GitHub Pages SLA 不到 100%，但實際幾乎不會掛。萬一掛了，等個 10 分鐘通常就恢復。

**Q: 如何看有多少人用？**  
A: 純靜態網站本身沒有統計。要的話最簡單方法是加 Google Analytics 或 Plausible，免費版就夠用。

**Q: 我可以把 repo 設成 Private 嗎？**  
A: GitHub Pages 免費版只能用 Public repo。設 Private 要升級 Pro（每月 USD 4）。但因為你用的全部是公開資料（法規＋官方問答集），用 Public 沒問題。

**Q: 主管機關修法後幾天會反映在工具上？**  
A: 全國法規資料庫每日更新，腳本每月 1 號自動跑，最壞情況約 1 個月延遲。如果有重大修法可以手動觸發 GitHub Actions 立刻更新。

---

## 完成後檢查清單

- [ ] 網址可以從手機開啟
- [ ] 「法條速查」分頁能搜尋並顯示條文
- [ ] 點條文卡片能看到完整內容並有連回原始法規的連結
- [ ] GitHub Actions 手動觸發一次成功，`output/laws.json` 有更新
- [ ] 重新整理網頁後「資料同步狀態」顯示最新日期
- [ ] （選用）自訂網域生效，HTTPS 正常
- [ ] 傳網址給同事，對方能正常開啟
