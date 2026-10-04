'use strict';

/**
 * Google OAuth 2.0 流程（scope 最小權限：drive.file）
 *   GET  /auth/login     -> 跳去 Google 授權頁
 *   GET  /auth/callback  -> 換 token，存入 server-side session
 *   GET  /auth/status    -> { configured, connected, email?, driveFolderLink? }
 *   POST /auth/logout    -> 清除 session
 */

const express = require('express');
const { google } = require('googleapis');
const store = require('../lib/drive');

const router = express.Router();
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function oauth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function configured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

router.get('/login', (req, res) => {
  if (!configured()) return res.redirect('/?setup=1');
  const url = oauth2Client().generateAuthUrl({
    access_type: 'offline', // 攞 refresh_token
    prompt: 'consent',
    scope: SCOPES,
  });
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  if (!configured()) return res.redirect('/?setup=1');
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?auth=error');
  try {
    const { tokens } = await oauth2Client().getToken(code);
    req.session.tokens = tokens;
    // 順便攞 email 顯示用（drive.about.get 喺 drive.file scope 下都用到）
    try {
      const authed = oauth2Client();
      authed.setCredentials(tokens);
      const about = await google.drive({ version: 'v3', auth: authed }).about.get({ fields: 'user' });
      req.session.email = (about.data.user && about.data.user.emailAddress) || '';
    } catch {
      req.session.email = '';
    }
    res.redirect('/');
  } catch (err) {
    console.error('[auth] callback 換 token 失敗：', err.message);
    res.redirect('/?auth=error');
  }
});

router.get('/status', async (req, res) => {
  if (!configured()) return res.json({ configured: false, connected: false });
  const auth = store.oauthClientFromSession(req);
  if (!auth) return res.json({ configured: true, connected: false });
  try {
    const drive = store.driveClient(auth);
    const folder = await store.ensureAppFolder(drive);
    res.json({
      configured: true,
      connected: true,
      email: req.session.email || '',
      driveFolderLink: folder.webViewLink || '',
    });
  } catch (err) {
    // token 失效等情況：清 session，等用戶重新登入
    console.warn('[auth] status 檢查失敗：', err.message);
    req.session.tokens = null;
    res.json({ configured: true, connected: false });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
