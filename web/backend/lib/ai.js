'use strict';

/**
 * AI 協助分類
 * ----------
 * 優先用 OpenAI-compatible API（env: OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL）。
 * 冇 key 就用關鍵字 heuristic 做後備，並喺回傳標示 provider，UI 會誠實顯示係「規則式分類」。
 * 絕對唔會寫死任何 key。
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

/** 後備：關鍵字規則式分類（中英關鍵字）。 */
function heuristicSuggest(item, categories) {
  const text = `${item.title || ''} ${item.summary || ''} ${item.url || ''}`.toLowerCase();
  const rules = [
    { keys: ['youtube', 'youtu.be', 'vimeo', 'bilibili', '影片', 'video', 'mv ', '電影預告'], hint: ['影片', 'video'] },
    { keys: ['新聞', 'news', '報導', '報道', '時事', 'hk01', '立場', '明報', 'rthk'], hint: ['新聞', 'news'] },
    { keys: ['文件', 'pdf', 'doc', '文件', 'document', '白皮書', 'whitepaper', '手冊', 'manual', '教學', 'tutorial', 'guide'], hint: ['文件', 'document'] },
    { keys: ['網站', 'website', '官網', 'blog', '部落格', '文章', 'article'], hint: ['網站', 'website'] },
    { keys: ['github', '程式', 'code', 'coding', '開發', 'developer', 'api'], hint: ['技術', 'tech'] },
    { keys: ['食譜', 'recipe', '煮', '美食', '餐廳', 'food'], hint: ['生活', 'life'] },
    { keys: ['投資', '股票', 'finance', '理財', '經濟', 'economy'], hint: ['財經', 'finance'] },
  ];
  for (const rule of rules) {
    if (rule.keys.some((k) => text.includes(k))) {
      const matched = categories.filter((c) =>
        rule.hint.some((h) => c.name.toLowerCase().includes(h))
      );
      return {
        categoryIds: matched.slice(0, 2).map((c) => c.id),
        reason: `規則式配對：內容出現關鍵字「${rule.keys.find((k) => text.includes(k))}」，對應分類提示「${rule.hint.join('／')}」。`,
      };
    }
  }
  return { categoryIds: [], reason: '規則式配對：搵唔到明顯關鍵字，建議人手分類。' };
}

/** 經 OpenAI-compatible chat completions API 建議分類。 */
async function openaiSuggest(items, categories) {
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  const catList = categories.map((c) => ({ id: c.id, name: c.name }));
  const itemList = items.map((it) => ({
    id: it.id,
    title: it.title,
    url: it.url,
    type: it.type,
    summary: (it.summary || '').slice(0, 500),
  }));

  const prompt =
    '你係一個收藏內容分類助手。以下係用戶現有分類同需要分類嘅收藏項目。' +
    '請為每個項目建議 1-2 個最合適嘅分類（只可以用現有分類嘅 id，唔好自創新分類），並用繁體中文寫一句簡短原因。' +
    '回傳純 JSON，不要其他文字，格式：{"suggestions":[{"id":"項目id","categoryIds":["分類id"],"reason":"原因"}]}。\n\n' +
    `分類：${JSON.stringify(catList)}\n\n項目：${JSON.stringify(itemList)}`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你係一個只回傳 JSON 嘅分類助手。' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`AI API 回應錯誤（${resp.status}）：${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI 回傳唔係有效 JSON，已取消套用。');
  }
  const validIds = new Set(categories.map((c) => c.id));
  const suggestions = (parsed.suggestions || []).map((s) => ({
    itemId: String(s.id || ''),
    categoryIds: (s.categoryIds || []).filter((id) => validIds.has(String(id))).map(String).slice(0, 3),
    reason: String(s.reason || 'AI 建議'),
  }));
  return { provider: 'openai', model, suggestions };
}

/**
 * 為一批項目產生分類建議。
 * @returns { provider: 'openai'|'heuristic', model?, suggestions: [{itemId, categoryIds, reason}] }
 */
async function suggestCategories(items, categories) {
  if (!categories.length) {
    return {
      provider: aiConfigured() ? 'openai' : 'heuristic',
      suggestions: items.map((it) => ({
        itemId: it.id,
        categoryIds: [],
        reason: '未有任何分類，請先新增分類。',
      })),
    };
  }
  if (aiConfigured()) {
    try {
      return await openaiSuggest(items, categories);
    } catch (err) {
      // AI 失敗時跌返去 heuristic，唔好成個功能死咗
      console.warn('[ai] OpenAI 建議失敗，改用規則式後備：', err.message);
    }
  }
  return {
    provider: 'heuristic',
    suggestions: items.map((it) => {
      const r = heuristicSuggest(it, categories);
      return { itemId: it.id, categoryIds: r.categoryIds, reason: r.reason };
    }),
  };
}

/* ---------- AI 生成簡介 ---------- */

const SUMMARY_TIMEOUT_MS = 8000;
const SUMMARY_MAX_BYTES = 500 * 1024;
const SUMMARY_MAX_REDIRECTS = 3;

const net = require('net');
const dns = require('dns').promises;

/** 判斷 IP 係咪內網／保留地址（SSRF 保護）。 */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return (
      p[0] === 10 ||
      p[0] === 127 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254) ||
      p[0] === 0
    );
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fe80:') || low.startsWith('fec0:')) return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true;
    if (low.startsWith('::ffff:')) {
      const v4 = low.slice('::ffff:'.length);
      if (net.isIPv4(v4)) return isPrivateIp(v4);
      return true;
    }
    return true; // 其他 IPv6 格式保守起見當危險
  }
  return true; // 唔識嘅格式當危險處理
}

/** 解 hostname 並拒絕內網地址。註：有 DNS rebinding 理論風險，MVP 接受。 */
async function assertPublicHost(hostname) {
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('網域解唔到');
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('內網／保留地址唔准抓取');
  }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function metaContent(html, attr, value) {
  const re1 = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]*content=["']([^"']{1,800})["']`, 'i');
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']{1,800})["'][^>]*${attr}=["']${value}["']`, 'i');
  const m = re1.exec(html) || re2.exec(html);
  return m ? m[1] : '';
}

/** 由 HTML 抽 <title> 同 description／og:description。 */
function extractMeta(html) {
  const slice = html.slice(0, 300000);
  const clean = (s) => decodeEntities(s.replace(/\s+/g, ' ').trim()).slice(0, 500);
  const t = /<title[^>]*>([\s\S]{1,300})<\/title>/i.exec(slice);
  return {
    pageTitle: t ? clean(t[1]) : '',
    description: clean(
      metaContent(slice, 'name', 'description') ||
      metaContent(slice, 'property', 'og:description')
    ),
  };
}

/**
 * Server-side 抓目標網頁嘅 title／description 做 AI 參考。
 * 只准 http/https、8 秒 timeout、最多 ~500KB、最多 3 個 redirect；
 * 任何失敗都回 null（唔 throw），SSRF 保護擋內網。
 */
async function fetchPageContext(rawUrl) {
  let current = rawUrl;
  for (let hop = 0; hop <= SUMMARY_MAX_REDIRECTS; hop++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    try {
      await assertPublicHost(u.hostname);
    } catch {
      return null;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SUMMARY_TIMEOUT_MS);
    let resp = null;
    try {
      resp = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'TidyYourMind/1.0 (summary fetcher)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-HK,zh;q=0.9',
        },
      });
    } catch {
      resp = null;
    } finally {
      clearTimeout(timer);
    }
    if (!resp) return null;

    const done = async () => { try { if (resp.body) await resp.body.cancel(); } catch {} };
    const loc = resp.headers.get('location');
    if (resp.status >= 300 && resp.status < 400 && loc) {
      await done();
      try {
        current = new URL(loc, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (!resp.ok) {
      await done();
      return null;
    }
    const ctype = (resp.headers.get('content-type') || '').toLowerCase();
    if (ctype && !ctype.includes('text/html') && !ctype.includes('xhtml')) {
      await done();
      return null; // 唔係網頁（例如 PDF／圖），唔抓
    }
    const chunks = [];
    let size = 0;
    try {
      const reader = resp.body.getReader();
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(value);
        size += value.length;
        if (size >= SUMMARY_MAX_BYTES) break;
      }
      try { await reader.cancel(); } catch {}
    } catch {
      return null;
    }
    let html = '';
    try {
      html = Buffer.concat(chunks).toString('utf8');
    } catch {
      return null;
    }
    return extractMeta(html);
  }
  return null; // redirect 太多
}

function safeDomain(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname;
  } catch {
    return '';
  }
}

/** 經 OpenAI-compatible API 生成繁體中文簡介。 */
async function openaiSummary({ title, url, type, domain, ctx }) {
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const lines = [
    '你係一個收藏內容簡介助手。請用繁體中文為以下收藏寫 2-3 句簡介（唔超過 150 字），講清楚呢個內容係乜嘢、適合邊個睇。只回傳簡介本身，唔好加標題或者其他文字。',
    `標題：${title || '（未提供）'}`,
    `類型：${type || '網站'}`,
  ];
  if (url) lines.push(`連結：${url}`);
  if (domain) lines.push(`網站：${domain}`);
  if (ctx && ctx.pageTitle) lines.push(`網頁標題：${ctx.pageTitle}`);
  if (ctx && ctx.description) lines.push(`網頁描述：${ctx.description}`);

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 300,
      messages: [
        { role: 'system', content: '你係一個用繁體中文寫簡介嘅助手，只回傳簡介本身。' },
        { role: 'user', content: lines.join('\n') },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`AI API 回應錯誤（${resp.status}）：${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || '').trim()
    : '';
  if (!text) throw new Error('AI 冇回傳簡介');
  return text.slice(0, 300);
}

/** 後備：用標題／類型／網域砌一句誠實嘅簡介，唔好扮係 AI 寫。 */
function heuristicSummary({ title, url, type, domain }) {
  const typeWord = { '網站': '網站', '新聞': '新聞', '影片': '影片', '文件': '文件' }[type] || '內容';
  const parts = [`已收藏${typeWord}`];
  if (title) parts.push(`「${title.slice(0, 80)}」`);
  if (domain) parts.push(`（${domain}）`);
  parts.push('。簡介未生成，請自行補充。');
  return parts.join('');
}

/**
 * 生成簡介。永不 throw：冇 key 或 AI 失敗就用規則式後備。
 * @returns { summary, provider: 'openai'|'heuristic', note? }
 */
async function generateSummary({ title, url, type }) {
  const domain = url ? safeDomain(url) : '';
  if (aiConfigured()) {
    try {
      const ctx = url ? await fetchPageContext(url) : null;
      const summary = await openaiSummary({ title, url, type, domain, ctx });
      return { summary, provider: 'openai' };
    } catch (err) {
      console.warn('[ai] 簡介生成失敗，改用規則式後備：', err.message);
    }
  }
  return {
    summary: heuristicSummary({ title, url, type, domain }),
    provider: 'heuristic',
    note: '規則式簡介（未用 AI），建議人手潤飾。',
  };
}

module.exports = { aiConfigured, suggestCategories, generateSummary };
