# TidyYourMind

Interactive web prototype for the save-to-Drive iOS app concept.

- Filter saved items by website / news / video / document
- Instant search across saved content
- Item details with AI-generated key points
- Add temporary items, mark as read, export JSON
- Responsive layout with dark mode support

Open `index.html` in a browser to try it out, or enable GitHub Pages
(Settings -> Pages -> Deploy from a branch -> `main` / root).

## Full web version (`web/`)

`web/` 係完整可部署嘅前後端版本（Node.js + Express），真正連接用戶嘅 Google Drive：

- 分類新增／改名／刪除、按分類瀏覽、多選分類
- 收藏新增／刪除（垃圾桶＋還原）、即時搜尋
- 一鍵 AI 協助分類＋修改記錄（有 key 用 OpenAI-compatible API，冇 key 用內置規則）
- 資料真正存喺 Drive 嘅 `TidyYourMind` 資料夾

詳細設定（Google OAuth、環境變數、部署）睇 [`web/README.md`](web/README.md)。

- 本地運行：`cd web/backend && npm install && npm start`（先照 `web/.env.example` 開 `.env`）
- Render 一鍵部署：repo root 已有 `render.yaml`
