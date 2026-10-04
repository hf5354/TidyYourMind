'use strict';

/**
 * Google Drive 資料層
 * ------------------
 * 資料模型（真正存喺用戶 Drive）：
 *   Drive 根目錄 / TidyYourMind 資料夾 / data.json
 *   { categories: [{ id, name }],
 *     items: [{ id, title, url, type, summary, categories: [catId...],
 *               trashed: false, createdAt, updatedAt }] }
 *
 * Demo 級快取：以 folderId 做 key，快取 20 秒，寫入時即時失效。
 * Production 建議：改用 Redis／資料庫做 session store 同快取。
 */

const { google } = require('googleapis');

const APP_FOLDER_NAME = 'TidyYourMind';
const DATA_FILE_NAME = 'data.json';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const CACHE_TTL_MS = 20 * 1000;

const cache = new Map(); // folderId -> { data, ts }

function emptyData() {
  return { categories: [], items: [] };
}

function invalidateCache(folderId) {
  cache.delete(folderId);
}

/** 用 session 入面嘅 tokens 起一個 OAuth2 client（自動處理 refresh）。 */
function oauthClientFromSession(req) {
  const tokens = req.session && req.session.tokens;
  if (!tokens || !tokens.access_token) return null;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', (newTokens) => {
    // access token renew 時更新 session，避免舊 token 過期
    req.session.tokens = { ...req.session.tokens, ...newTokens };
  });
  return oauth2;
}

function driveClient(auth) {
  return google.drive({ version: 'v3', auth });
}

/** 搵／開 TidyYourMind 資料夾（drive.file scope 只睇到 app 自己開嘅檔案）。 */
async function ensureAppFolder(drive) {
  const q = `name = '${APP_FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: 'files(id, name, webViewLink)',
    pageSize: 5,
    spaces: 'drive',
  });
  const found = (res.data.files || [])[0];
  if (found) return found;
  const created = await drive.files.create({
    fields: 'id, name, webViewLink',
    requestBody: { name: APP_FOLDER_NAME, mimeType: FOLDER_MIME },
  });
  return created.data;
}

async function findDataFile(drive, folderId) {
  const q = `'${folderId}' in parents and name = '${DATA_FILE_NAME}' and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: 'files(id, name)',
    pageSize: 5,
    spaces: 'drive',
  });
  return (res.data.files || [])[0] || null;
}

/** 讀 data.json；未有就回傳空結構（唔自動寫入，等第一次寫入先建立）。 */
async function readData(drive, folderId) {
  const hit = cache.get(folderId);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return JSON.parse(JSON.stringify(hit.data));
  }
  const file = await findDataFile(drive, folderId);
  let data = emptyData();
  if (file) {
    const res = await drive.files.get({ fileId: file.id, alt: 'media' });
    if (res.data && typeof res.data === 'object') {
      data = {
        categories: Array.isArray(res.data.categories) ? res.data.categories : [],
        items: Array.isArray(res.data.items) ? res.data.items : [],
      };
    }
  }
  cache.set(folderId, { data: JSON.parse(JSON.stringify(data)), ts: Date.now() });
  return data;
}

/** 寫 data.json（create 或 update），並失效快取。 */
async function writeData(drive, folderId, data) {
  const payload = JSON.stringify(
    { categories: data.categories || [], items: data.items || [] },
    null,
    2
  );
  const { Readable } = require('stream');
  const media = {
    mimeType: 'application/json',
    body: Readable.from([payload]),
  };
  const existing = await findDataFile(drive, folderId);
  if (existing) {
    await drive.files.update({ fileId: existing.id, media });
  } else {
    await drive.files.create({
      fields: 'id',
      requestBody: { name: DATA_FILE_NAME, mimeType: 'application/json', parents: [folderId] },
      media,
    });
  }
  invalidateCache(folderId);
}

module.exports = {
  APP_FOLDER_NAME,
  DATA_FILE_NAME,
  emptyData,
  invalidateCache,
  oauthClientFromSession,
  driveClient,
  ensureAppFolder,
  readData,
  writeData,
};
