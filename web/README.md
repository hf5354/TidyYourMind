# TidyYourMind 網頁版

把網站／新聞／影片／文件連結儲存去你自己嘅 Google Drive，並提供分類整理、AI 內容簡介輔助、搜尋嘅網頁版應用。專為桌面瀏覽器而設，同 iOS App 共用同一套 Drive 資料格式。

## 功能

- Google 登入（OAuth 2.0，最小權限 `drive.file`），資料只存喺你自己嘅 Drive
- 一鍵喺瀏覽器開啟返個 `TidyYourMind` Drive 資料夾
- 分類：新增、刪除、改名；按分類瀏覽
- 收藏內容：新增、編輯、刪除（先入垃圾桶，可還原；亦可永久刪除）
- 每件收藏可屬**多個**分類；加入時可多選現有分類或即場新增分類名
- ✨ 一鍵 AI 協助分類：為未分類／全部項目建議分類，列出修改記錄（由咩分類變咩分類＋原因），你確認後先套用
- 🤖 AI 生成簡介：新增／編輯項目時一鍵由 AI 用繁體中文寫 2–3 句簡介（server 會先抓取目標網頁嘅標題／描述做參考）；冇金鑰時用規則式後備並註明
- 📎 檔案上傳：PDF、圖片、文字、Office 文件（最多 25MB），經 backend 直接上傳去你 Drive 嘅 `TidyYourMind` 資料夾；卡片會顯示 📎 徽章，撳標題用 Drive 預覽開啟
- 即時搜尋（標題＋簡介）
- 冇 AI 金鑰時自動用內置規則式分類，並喺 UI 誠實標示

## 資料點樣存

喺你嘅 Google Drive 開一個 `TidyYourMind` 資料夾，入面得一個 `data.json`：

```json
{
  "categories": [{ "id": "...", "name": "技術" }],
  "items": [{
    "id": "...", "title": "...", "url": "https://…", "type": "網站",
    "summary": "…", "categories": ["<分類id>"], "trashed": false,
    "createdAt": "…", "updatedAt": "…",
    "// 上傳檔案先會有（可選）：source, driveFileId, fileName, mimeType, fileSize"
  }]
}
```

因為 `drive.file` scope 嘅關係，呢個 app **只睇到佢自己建立嘅檔案**，掂唔到你 Drive 其他嘢。

## 快速開始（本地）

```bash
# 1. 裝 dependencies
cd backend && npm install

# 2. 設定（見下面 Google Cloud 步驟攞到 Client ID/Secret 之後）
cp ../.env.example ../.env
# 用文字編輯器填好 ../.env

# 3. 啟動
npm start
# 開瀏覽器去 http://localhost:3000
```

> 未設定 Google OAuth 嘅話，`/` 會顯示設定提示頁，唔會 crash；API 會回 503。

## Google Cloud Console 設定步驟

1. 去 [Google Cloud Console](https://console.cloud.google.com/)，開（或揀）一個 Project。
2. 左邊選單 → **APIs & Services → Library**，搜尋 **Google Drive API** 並啟用。
3. **APIs & Services → OAuth consent screen**：
   - User type 揀 **External**，填 App 名稱（例如 TidyYourMind）同你嘅電郵。
   - Scopes 唔使手動加（程式用 `drive.file`，Google 會喺授權頁顯示）。
   - Test users 加返你自己個 Google 帳號（未發佈前只有 test user 用到）。
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**：
   - Application type 揀 **Web application**。
   - **Authorized redirect URIs** 加入：
     - 本地開發：`http://localhost:3000/auth/callback`
     - 部署後（例如 Render）：`https://<你嘅域名>/auth/callback`（有幾多個環境就加幾多個）
   - 撳 Create，抄低 **Client ID** 同 **Client Secret**。
5. 將佢哋填入 `.env` 嘅 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`，`GOOGLE_REDIRECT_URI` 填返上面其中一個 redirect URI（要同 Console 入面一模一樣）。

## 環境變數一覽

| 變數 | 必填 | 說明 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | ✅ | 要同 Cloud Console 完全一致，例如 `http://localhost:3000/auth/callback` |
| `SESSION_SECRET` | ✅ | Session 加密字串，生產環境用隨機長字串 |
| `PORT` |  | 預設 `3000` |
| `NODE_ENV` |  | `production` 會開 secure cookie |
| `OPENAI_API_KEY` |  | AI 分類用；唔填就用內置規則式分類 |
| `OPENAI_BASE_URL` |  | 預設 `https://api.openai.com/v1`（支援任何 OpenAI-compatible API） |
| `OPENAI_MODEL` |  | 預設 `gpt-4o-mini` |

## 部署

### Render（一鍵）

1. 將呢個 repo 推上 GitHub（放喺 `web/` 目錄下都得，記得改 Build／Start Command 嘅路徑：`npm install --prefix web/backend`）。
2. Render → New → Web Service → 揀你個 repo，佢會自動讀 `render.yaml`。
3. 喺 **Environment** 填 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI`（填你嘅 Render 公開網址加 `/auth/callback`，例如 `https://tidymind-web.onrender.com/auth/callback`），同埋 `SESSION_SECRET`（可撳 Generate）。
4. 記得返去 Google Cloud Console 嘅 Authorized redirect URIs 加返第 3 步個網址。
5. Deploy，開個網址即用。`render.yaml` 已設 `healthCheckPath: /auth/status`。

### Railway

1. Railway → New Project → Deploy from GitHub repo。
2. Variables 填返上面同一堆環境變數；Start command 用 `npm start --prefix backend`（或 `web/backend`，視乎你放邊）。
3. 產生一個公開 Domain，之後同樣去 Google Cloud Console 加 redirect URI。

### Docker

```bash
docker build -t tidymind-web .
docker run -p 3000:3000 --env-file .env tidymind-web
```

## AI 功能說明

### AI 協助分類
- 有 `OPENAI_API_KEY`：經 OpenAI-compatible chat completions API 建議分類（淨係傳分類名單同項目標題／連結／簡介，不傳 Drive token）。
- 冇 key：用關鍵字 heuristic（例如見到 youtube 就建議「影片」），UI 會註明係規則式分類。
- AI 失敗（例如 API 錯誤）會自動跌返去 heuristic，唔會成個功能死咗。

### AI 生成簡介（新增／編輯項目 modal 入面個「🤖 AI 生成簡介」掣）
- 有 `OPENAI_API_KEY`：server 會先抓取目標連結嘅 HTML（只限 http/https、8 秒 timeout、最多 ~500KB、最多 3 個 redirect、抽 `<title>` 同 description／og:description；內網地址會被 SSRF 保護擋走，任何失敗都唔會 crash），再叫 AI 用繁體中文寫 2–3 句簡介（≤150 字）。
- 冇 key 或 AI 失敗：用規則式後備（標題＋類型＋網域砌一句），並誠實註明係規則式，唔會扮係 AI 寫。
- 生成結果填入簡介欄，你照樣可以人手改；失敗唔會影響其他功能。
- 絕對唔會喺 code 入面寫死任何 key；全部經環境變數。

## 檔案上傳

- 新增內容時揀「📎 上傳檔案」分頁，支援 PDF、常見圖片（jpeg/png/gif/webp）、純文字／markdown、Word／Excel／PowerPoint（含新舊格式）。
- 單檔上限 **25MB**（超咗會回 413 並誠實提示）。
- 檔案經 backend 直接上傳去你 Google Drive 嘅 `TidyYourMind` 資料夾（沿用 `drive.file` scope，app 只掂到自己建立嘅檔案）；**唔會** base64 塞入 `data.json`。
- 上傳成功先會建立收藏記錄；Drive 上傳失敗會回 502，唔會留低孤兒記錄。
- 收藏記錄會記低 `source: 'upload'`、`driveFileId`、`fileName`、`mimeType`、`fileSize`；舊嘅連結收藏唔受影響（當 `source: 'link'`）。
- 編輯已上傳項目可以改標題／簡介／分類，但唔換得檔（MVP：如需換檔請刪除重傳）。
- ⚠️ **唔做病毒掃描**：請只上傳你信任嘅檔案。

## 安全

- 所有 secret 經環境變數傳入；`.gitignore` 已擋 `.env`。
- Google token 只存喺 server-side session（demo 用 memory store；**production 請轉 Redis／資料庫**，見「假設」）。
- Cookie 設 `httpOnly`＋`sameSite=lax`；`NODE_ENV=production` 時開 `secure`。
- 基本 input validation：連結只接受 `http(s)`、字數上限、分類 id 白名單檢查。
- 刪除預設係軟刪除（入垃圾桶），可還原；永久刪除要二次確認。

## 假設

1. 用戶得一個 Google 帳號（用預設帳號登入，未做多帳號切換）。
2. Session 用 memory store：demo／單人自用夠，但重啟會登出、唔適合多 instance；production 請轉 `connect-redis` 等。
3. `data.json` 快取 20 秒：同一用戶短時間內喺兩部機改嘢，最後寫入會覆蓋（last-write-wins），未做衝突合併。
4. AI 生成簡介會 server-side 抓取目標網頁嘅 `<title>`／meta description 做參考（8 秒 timeout、~500KB 上限、擋內網 SSRF），唔會下載成個網頁內容；只傳標題／描述畀 AI，唔傳 Drive token。
5. 未做 App Store／iOS Share Extension 對接：iOS App 可直接讀寫同一個 Drive `data.json` 做到同步。
6. Google OAuth consent screen 未發佈前，每 7 日要重新授權（Google 對 testing mode 嘅限制）；正式用請做 Google 驗證。
