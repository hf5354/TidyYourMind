'use strict';

/**
 * TidyYourMind 網頁版 — 後端入口
 * 冇設定 Google OAuth credentials 時，`/` 會顯示設定提示頁（唔會 crash）；
 * API 會回 503 JSON。
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config(); // 都試下 backend/.env，方便就手

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const OAUTH_CONFIGURED = Boolean(
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_REDIRECT_URI
);

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] 未設定 SESSION_SECRET，已用隨機值（重啟後 session 會失效；production 請固定設定）');
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(
  session({
    name: 'tidymind.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 日
    },
  })
);

// 未設定 OAuth：API 回 503，其餘顯示設定提示頁
if (!OAUTH_CONFIGURED) {
  console.warn('[warn] 未偵測到 Google OAuth 設定（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI），將顯示設定提示頁');
  app.use('/api', (req, res) => res.status(503).json({ ok: false, error: '伺服器未設定 Google OAuth，請跟 README 設定環境變數' }));
  app.use('/auth', (req, res) => res.redirect('/?setup=1'));
}

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// 前端靜態檔
const frontendDir = path.join(__dirname, '..', 'frontend');

const SETUP_HTML = `<!doctype html>
<html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TidyYourMind — 需要設定</title>
<style>body{font-family:-apple-system,"PingFang HK","Microsoft JhengHei",sans-serif;max-width:640px;margin:8vh auto;padding:0 20px;line-height:1.7;color:#222}code{background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:.9em}h1{font-size:1.6em}.card{border:1px solid #e4e4e7;border-radius:12px;padding:20px;background:#fafafa}ol{padding-left:20px}</style>
</head><body>
<h1>⚙️ TidyYourMind 需要先設定</h1>
<div class="card">
<p>伺服器未偵測到 Google OAuth 設定，所以未能啟動完整功能。請跟住以下步驟：</p>
<ol>
<li>去 <b>Google Cloud Console</b> 開一個 OAuth Client ID（詳見 <code>README.md</code>）。</li>
<li>複製 <code>.env.example</code> 做 <code>.env</code>，填入以下環境變數：
<br><code>GOOGLE_CLIENT_ID</code>、<code>GOOGLE_CLIENT_SECRET</code>、<code>GOOGLE_REDIRECT_URI</code>、<code>SESSION_SECRET</code></li>
<li>重新啟動：<code>npm start</code>（backend 目錄下）。</li>
</ol>
<p>AI 分類功能係 optional：有 <code>OPENAI_API_KEY</code> 就用 AI，冇就用內置規則式分類。</p>
</div></body></html>`;

// 未設定時所有前端路由都顯示提示頁（放喺 static 之前，確保 / 都命中）；
// 已設定就 serve 靜態檔＋SPA fallback 到 index.html
if (!OAUTH_CONFIGURED) {
  app.get('*', (req, res) => res.status(200).send(SETUP_HTML));
} else {
  app.use(express.static(frontendDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ ok: false, error: '伺服器內部錯誤' });
});

app.listen(PORT, () => {
  console.log(`TidyYourMind web 運行中：http://localhost:${PORT}`);
  console.log(`Google OAuth：${OAUTH_CONFIGURED ? '已設定' : '未設定（顯示提示頁）'}`);
});

module.exports = app;
