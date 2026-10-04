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

module.exports = { aiConfigured, suggestCategories };
