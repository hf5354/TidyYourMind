'use strict';

/**
 * 收藏資料 API（全部要先登入 Google）
 *   GET    /api/data                        全量分類＋項目（唔包垃圾桶）
 *   GET    /api/trash                       垃圾桶內容
 *   GET    /api/search?q=                   搜尋標題＋簡介
 *   POST   /api/categories        {name}
 *   PUT    /api/categories/:id    {name}
 *   DELETE /api/categories/:id            （同時由項目移除該分類）
 *   POST   /api/items             {title, url, type, summary?, categories?}
 *   PUT    /api/items/:id         {title?, url?, type?, summary?, categories?}
 *   DELETE /api/items/:id                 移去垃圾桶（可還原）
 *   POST   /api/items/:id/restore         由垃圾桶還原
 *   DELETE /api/items/:id/permanent       永久刪除
 *   POST   /api/ai/suggest        {scope: 'uncategorized'|'all'}
 *   POST   /api/ai/apply          {changes: [{itemId, categoryIds}]}
 */

const express = require('express');
const { randomUUID } = require('crypto');
const store = require('../lib/drive');
const ai = require('../lib/ai');

const router = express.Router();

const ITEM_TYPES = ['網站', '新聞', '影片', '文件'];
const MAX_NAME = 60;
const MAX_TITLE = 200;
const MAX_SUMMARY = 2000;
const MAX_URL = 2048;

/* ---------- 小工具 ---------- */

function bad(res, code, message) {
  return res.status(code).json({ ok: false, error: message });
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

function cleanUrl(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > MAX_URL) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function cleanCatIds(v, categories) {
  if (!Array.isArray(v)) return null;
  const valid = new Set(categories.map((c) => c.id));
  const out = [];
  for (const id of v) {
    if (typeof id === 'string' && valid.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= 10) break;
  }
  return out;
}

/** 攞 drive client ＋ folder ＋ data，一次過搞掂。 */
async function ctx(req) {
  const auth = store.oauthClientFromSession(req);
  if (!auth) return { error: '未登入' };
  const drive = store.driveClient(auth);
  const folder = await store.ensureAppFolder(drive);
  const data = await store.readData(drive, folder.id);
  return { drive, folder, data };
}

function requireAuth(req, res, next) {
  if (!store.oauthClientFromSession(req)) return bad(res, 401, '請先登入 Google Drive');
  next();
}

router.use(requireAuth);

/* ---------- 讀取 ---------- */

router.get('/data', async (req, res) => {
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    res.json({
      ok: true,
      categories: c.data.categories,
      items: c.data.items.filter((it) => !it.trashed),
      aiProvider: ai.aiConfigured() ? 'openai' : 'heuristic',
    });
  } catch (err) {
    console.error('[api] data 失敗：', err.message);
    bad(res, 502, '讀取 Drive 資料失敗，請稍後再試');
  }
});

router.get('/trash', async (req, res) => {
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    res.json({ ok: true, items: c.data.items.filter((it) => it.trashed) });
  } catch (err) {
    console.error('[api] trash 失敗：', err.message);
    bad(res, 502, '讀取垃圾桶失敗');
  }
});

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    if (!q) return res.json({ ok: true, items: [] });
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const items = c.data.items.filter(
      (it) =>
        !it.trashed &&
        (`${it.title} ${it.summary || ''} ${it.url}`.toLowerCase().includes(q))
    );
    res.json({ ok: true, items: items.slice(0, 100) });
  } catch (err) {
    console.error('[api] search 失敗：', err.message);
    bad(res, 502, '搜尋失敗');
  }
});

/* ---------- 分類 ---------- */

router.post('/categories', async (req, res) => {
  const name = cleanStr(req.body && req.body.name, MAX_NAME);
  if (!name) return bad(res, 400, '分類名稱唔可以空白（最多 60 字）');
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    if (c.data.categories.some((x) => x.name === name)) {
      return bad(res, 409, '已經有呢個分類名');
    }
    const cat = { id: randomUUID(), name };
    c.data.categories.push(cat);
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, category: cat });
  } catch (err) {
    console.error('[api] 新增分類失敗：', err.message);
    bad(res, 502, '新增分類失敗');
  }
});

router.put('/categories/:id', async (req, res) => {
  const name = cleanStr(req.body && req.body.name, MAX_NAME);
  if (!name) return bad(res, 400, '分類名稱唔可以空白（最多 60 字）');
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const cat = c.data.categories.find((x) => x.id === req.params.id);
    if (!cat) return bad(res, 404, '搵唔到呢個分類');
    if (c.data.categories.some((x) => x.name === name && x.id !== cat.id)) {
      return bad(res, 409, '已經有呢個分類名');
    }
    cat.name = name;
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, category: cat });
  } catch (err) {
    console.error('[api] 改名分類失敗：', err.message);
    bad(res, 502, '改名失敗');
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const idx = c.data.categories.findIndex((x) => x.id === req.params.id);
    if (idx === -1) return bad(res, 404, '搵唔到呢個分類');
    const [removed] = c.data.categories.splice(idx, 1);
    for (const it of c.data.items) {
      it.categories = (it.categories || []).filter((id) => id !== removed.id);
    }
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, removed: removed.id });
  } catch (err) {
    console.error('[api] 刪除分類失敗：', err.message);
    bad(res, 502, '刪除分類失敗');
  }
});

/* ---------- 項目 ---------- */

function validateItemInput(body, categories, isUpdate) {
  const out = {};
  if (body.title !== undefined || !isUpdate) {
    const title = cleanStr(body.title, MAX_TITLE);
    if (!title) return { error: '標題唔可以空白（最多 200 字）' };
    out.title = title;
  }
  if (body.url !== undefined || !isUpdate) {
    const url = cleanUrl(body.url);
    if (!url) return { error: '連結格式唔正確，只接受 http(s) 連結' };
    out.url = url;
  }
  if (body.type !== undefined) {
    if (!ITEM_TYPES.includes(body.type)) return { error: '類型唔正確' };
    out.type = body.type;
  } else if (!isUpdate) {
    out.type = '網站';
  }
  if (body.summary !== undefined) {
    if (typeof body.summary !== 'string' || body.summary.length > MAX_SUMMARY) {
      return { error: '簡介太長（最多 2000 字）' };
    }
    out.summary = body.summary.trim();
  } else if (!isUpdate) {
    out.summary = '';
  }
  if (body.categories !== undefined) {
    const ids = cleanCatIds(body.categories, categories);
    if (!ids) return { error: '分類格式唔正確' };
    out.categories = ids;
  } else if (!isUpdate) {
    out.categories = [];
  }
  return { value: out };
}

router.post('/items', async (req, res) => {
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const v = validateItemInput(req.body || {}, c.data.categories, false);
    if (v.error) return bad(res, 400, v.error);
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      ...v.value,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    };
    c.data.items.unshift(item);
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[api] 新增項目失敗：', err.message);
    bad(res, 502, '新增失敗');
  }
});

router.put('/items/:id', async (req, res) => {
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const item = c.data.items.find((x) => x.id === req.params.id && !x.trashed);
    if (!item) return bad(res, 404, '搵唔到呢個項目');
    const v = validateItemInput(req.body || {}, c.data.categories, true);
    if (v.error) return bad(res, 400, v.error);
    Object.assign(item, v.value, { updatedAt: new Date().toISOString() });
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[api] 修改項目失敗：', err.message);
    bad(res, 502, '修改失敗');
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const item = c.data.items.find((x) => x.id === req.params.id && !x.trashed);
    if (!item) return bad(res, 404, '搵唔到呢個項目');
    item.trashed = true;
    item.updatedAt = new Date().toISOString();
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, message: '已移去垃圾桶，可以還原' });
  } catch (err) {
    console.error('[api] 刪除項目失敗：', err.message);
    bad(res, 502, '刪除失敗');
  }
});

router.post('/items/:id/restore', async (req, res) => {
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const item = c.data.items.find((x) => x.id === req.params.id && x.trashed);
    if (!item) return bad(res, 404, '垃圾桶搵唔到呢個項目');
    item.trashed = false;
    item.updatedAt = new Date().toISOString();
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[api] 還原失敗：', err.message);
    bad(res, 502, '還原失敗');
  }
});

router.delete('/items/:id/permanent', async (req, res) => {
  try {
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const idx = c.data.items.findIndex((x) => x.id === req.params.id);
    if (idx === -1) return bad(res, 404, '搵唔到呢個項目');
    c.data.items.splice(idx, 1);
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, message: '已永久刪除，無法還原' });
  } catch (err) {
    console.error('[api] 永久刪除失敗：', err.message);
    bad(res, 502, '刪除失敗');
  }
});

/* ---------- AI 協助分類 ---------- */

router.post('/ai/suggest', async (req, res) => {
  try {
    const scope = (req.body && req.body.scope) === 'all' ? 'all' : 'uncategorized';
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const targets = c.data.items.filter(
      (it) => !it.trashed && (scope === 'all' || !(it.categories || []).length)
    );
    if (!targets.length) {
      return res.json({ ok: true, provider: ai.aiConfigured() ? 'openai' : 'heuristic', suggestions: [], message: '冇需要分類嘅項目' });
    }
    const result = await ai.suggestCategories(targets.slice(0, 20), c.data.categories);
    // 加返標題方便 UI 顯示
    const byId = new Map(targets.map((t) => [t.id, t]));
    const suggestions = result.suggestions
      .filter((s) => byId.has(s.itemId))
      .map((s) => ({
        itemId: s.itemId,
        title: byId.get(s.itemId).title,
        from: (byId.get(s.itemId).categories || []).map(
          (id) => (c.data.categories.find((x) => x.id === id) || {}).name || id
        ),
        toIds: s.categoryIds,
        to: s.categoryIds.map((id) => (c.data.categories.find((x) => x.id === id) || {}).name || id),
        reason: s.reason,
      }));
    res.json({ ok: true, provider: result.provider, model: result.model, suggestions });
  } catch (err) {
    console.error('[api] AI 建議失敗：', err.message);
    bad(res, 502, 'AI 分類失敗：' + err.message);
  }
});

router.post('/ai/apply', async (req, res) => {
  try {
    const changes = req.body && req.body.changes;
    if (!Array.isArray(changes) || !changes.length) return bad(res, 400, '冇傳入修改');
    const c = await ctx(req);
    if (c.error) return bad(res, 401, c.error);
    const nameOf = (id) => (c.data.categories.find((x) => x.id === id) || {}).name || id;
    const log = [];
    for (const ch of changes) {
      if (!ch || typeof ch.itemId !== 'string') continue;
      const item = c.data.items.find((x) => x.id === ch.itemId && !x.trashed);
      if (!item) continue;
      const ids = cleanCatIds(ch.categoryIds, c.data.categories);
      if (!ids) continue;
      const from = (item.categories || []).map(nameOf);
      const to = ids.map(nameOf);
      item.categories = ids;
      item.updatedAt = new Date().toISOString();
      log.push({ itemId: item.id, title: item.title, from, to, reason: ch.reason || '' });
    }
    await store.writeData(c.drive, c.folder.id, c.data);
    res.json({ ok: true, applied: log.length, log });
  } catch (err) {
    console.error('[api] AI 套用失敗：', err.message);
    bad(res, 502, '套用失敗');
  }
});

module.exports = router;
