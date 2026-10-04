'use strict';
/* TidyYourMind 前端：vanilla JS SPA */

const $ = (id) => document.getElementById(id);

const state = {
  status: { configured: true, connected: false },
  categories: [],
  items: [],
  trash: [],
  aiProvider: 'heuristic',
  view: 'all',      // all | uncat | trash | cat
  activeCat: null,  // category id when view === 'cat'
  q: '',
  editingItem: null,
  editingCat: null,
  aiSuggestions: [],
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...(opts || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `請求失敗（${res.status}）`);
  }
  return data;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('zh-HK', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return ''; }
}

/* ---------- 狀態 ---------- */

async function loadStatus() {
  try {
    state.status = await fetch('/auth/status').then((r) => r.json());
  } catch {
    state.status = { configured: false, connected: false };
  }
  renderStatus();
}

function renderStatus() {
  const s = state.status;
  const pill = $('conn-status');
  $('btn-login').classList.toggle('hidden', !s.configured || s.connected);
  $('btn-logout').classList.toggle('hidden', !s.connected);
  $('btn-drive-folder').classList.toggle('hidden', !s.connected || !s.driveFolderLink);
  if (!s.configured) {
    pill.textContent = '未設定';
    pill.className = 'pill no';
  } else if (s.connected) {
    pill.textContent = `已連接${s.email ? '：' + s.email : ''}`;
    pill.className = 'pill ok';
  } else {
    pill.textContent = '未連接 Google Drive';
    pill.className = 'pill no';
  }
}

/* ---------- 資料 ---------- */

async function loadData() {
  const data = await api('/api/data');
  state.categories = data.categories || [];
  state.items = data.items || [];
  state.aiProvider = data.aiProvider || 'heuristic';
  renderAll();
}

async function loadTrash() {
  const data = await api('/api/trash');
  state.trash = data.items || [];
  renderItems();
}

function catName(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.name : '(已刪除分類)';
}

function filteredItems() {
  let list = state.view === 'trash' ? state.trash : state.items;
  if (state.view === 'uncat') list = list.filter((it) => !(it.categories || []).length);
  if (state.view === 'cat' && state.activeCat) {
    list = list.filter((it) => (it.categories || []).includes(state.activeCat));
  }
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter((it) =>
      `${it.title} ${it.summary || ''} ${it.url}`.toLowerCase().includes(q)
    );
  }
  return list;
}

/* ---------- 渲染 ---------- */

function renderAll() {
  renderCats();
  renderItems();
  const note = $('ai-note');
  if (state.aiProvider === 'heuristic') {
    note.textContent = 'ℹ️ 未偵測到 AI 金鑰，AI 協助分類會用內置規則式分類（關鍵字配對），效果有限；設定 OPENAI_API_KEY 可啟用真正 AI 分類。';
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
}

function renderCats() {
  const ul = $('cat-list');
  const counts = {};
  for (const it of state.items) {
    for (const id of it.categories || []) counts[id] = (counts[id] || 0) + 1;
  }
  ul.innerHTML = state.categories.map((c) => `
    <li data-id="${esc(c.id)}" class="${state.view === 'cat' && state.activeCat === c.id ? 'active' : ''}">
      <span class="cat-name" title="${esc(c.name)}">${esc(c.name)}</span>
      <span class="cat-count">${counts[c.id] || 0}</span>
      <button class="icon-btn" data-act="rename" title="改名">✏️</button>
      <button class="icon-btn" data-act="del" title="刪除">🗑️</button>
    </li>`).join('');
  ul.querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', (e) => {
      const act = e.target.closest('.icon-btn')?.dataset.act;
      const id = li.dataset.id;
      if (act === 'rename') return openCatModal(id);
      if (act === 'del') return deleteCategory(id);
      state.view = 'cat';
      state.activeCat = id;
      syncViewButtons();
      renderAll();
    });
  });
}

function renderItems() {
  const list = filteredItems();
  const box = $('items');
  $('empty').classList.toggle('hidden', list.length > 0);
  const inTrash = state.view === 'trash';
  box.innerHTML = list.map((it) => `
    <div class="card" data-id="${esc(it.id)}">
      <span class="type-badge">${esc(it.type || '網站')}</span>
      <h3><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      ${it.summary ? `<div class="summary">${esc(it.summary)}</div>` : ''}
      <div class="chips">${(it.categories || []).length
        ? (it.categories || []).map((id) => `<span class="chip">${esc(catName(id))}</span>`).join('')
        : '<span class="chip none">未分類</span>'}</div>
      <div class="card-meta">${fmtDate(it.createdAt)}</div>
      <div class="card-actions">
        ${inTrash ? `
          <button class="btn small" data-act="restore">還原</button>
          <button class="btn small danger" data-act="permadel">永久刪除</button>
        ` : `
          <button class="btn small" data-act="edit">編輯</button>
          <button class="btn small danger" data-act="del">刪除</button>
        `}
      </div>
    </div>`).join('');
  box.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      const id = card.dataset.id;
      try {
        if (act === 'edit') openItemModal(state.items.find((x) => x.id === id));
        else if (act === 'del') {
          if (!confirm('確定移去垃圾桶？之後可以還原。')) return;
          await api(`/api/items/${id}`, { method: 'DELETE' });
          toast('已移去垃圾桶');
          await loadData();
        } else if (act === 'restore') {
          await api(`/api/items/${id}/restore`, { method: 'POST' });
          toast('已還原');
          await loadTrash();
        } else if (act === 'permadel') {
          if (!confirm('永久刪除後無法還原，確定？')) return;
          await api(`/api/items/${id}/permanent`, { method: 'DELETE' });
          toast('已永久刪除');
          await loadTrash();
        }
      } catch (err) { toast(err.message); }
    });
  });
}

function syncViewButtons() {
  document.querySelectorAll('#views .view-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === state.view);
  });
  if (state.view === 'trash') loadTrash();
}

/* ---------- 分類 CRUD ---------- */

function openCatModal(id) {
  state.editingCat = id || null;
  const cat = id ? state.categories.find((x) => x.id === id) : null;
  $('cat-modal-title').textContent = cat ? '分類改名' : '新增分類';
  $('c-name').value = cat ? cat.name : '';
  $('modal-cat').classList.remove('hidden');
  $('c-name').focus();
}

async function deleteCategory(id) {
  const cat = state.categories.find((x) => x.id === id);
  if (!cat) return;
  if (!confirm(`確定刪除分類「${cat.name}」？相關項目會變成未分類（唔會刪除項目本身）。`)) return;
  try {
    await api(`/api/categories/${id}`, { method: 'DELETE' });
    toast('分類已刪除');
    if (state.activeCat === id) { state.view = 'all'; state.activeCat = null; syncViewButtons(); }
    await loadData();
  } catch (err) { toast(err.message); }
}

/* ---------- 項目 modal ---------- */

function renderItemCatChecks(selected) {
  const box = $('f-cats');
  box.innerHTML = state.categories.map((c) => `
    <label><input type="checkbox" value="${esc(c.id)}" ${selected.includes(c.id) ? 'checked' : ''}/> ${esc(c.name)}</label>
  `).join('') || '<span class="muted">未有分類，可喺下面即場新增。</span>';
}

function openItemModal(item) {
  state.editingItem = item || null;
  $('item-modal-title').textContent = item ? '編輯內容' : '加入內容';
  $('f-title').value = item ? item.title : '';
  $('f-url').value = item ? item.url : '';
  $('f-type').value = item ? item.type : '網站';
  $('f-summary').value = item ? (item.summary || '') : '';
  $('f-newcat').value = '';
  renderItemCatChecks(item ? (item.categories || []) : []);
  $('modal-item').classList.remove('hidden');
  $('f-title').focus();
}

function selectedCatIds() {
  return [...$('f-cats').querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value);
}

async function quickAddCategoryFromItem() {
  const name = $('f-newcat').value.trim();
  if (!name) return;
  try {
    const data = await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
    state.categories.push(data.category);
    renderItemCatChecks([...selectedCatIds(), data.category.id]);
    $('f-newcat').value = '';
    renderCats();
    toast(`已新增分類「${name}」`);
  } catch (err) { toast(err.message); }
}

async function saveItem() {
  const body = {
    title: $('f-title').value.trim(),
    url: $('f-url').value.trim(),
    type: $('f-type').value,
    summary: $('f-summary').value.trim(),
    categories: selectedCatIds(),
  };
  try {
    if (state.editingItem) {
      await api(`/api/items/${state.editingItem.id}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('已更新');
    } else {
      await api('/api/items', { method: 'POST', body: JSON.stringify(body) });
      toast('已加入收藏');
    }
    $('modal-item').classList.add('hidden');
    await loadData();
  } catch (err) { toast(err.message); }
}

/* ---------- AI 協助分類 ---------- */

function openAiModal() {
  $('ai-results').innerHTML = '';
  const note = $('ai-provider-note');
  note.textContent = state.aiProvider === 'openai'
    ? '已連接 AI 模型，會為項目建議最合適嘅分類。'
    : '未設定 AI 金鑰，將使用內置規則式分類（關鍵字配對，效果有限）。';
  $('modal-ai').classList.remove('hidden');
}

async function runAiSuggest() {
  const scope = document.querySelector('input[name=ai-scope]:checked').value;
  const box = $('ai-results');
  box.innerHTML = '<p class="muted">分析緊，請稍候…</p>';
  try {
    const data = await api('/api/ai/suggest', { method: 'POST', body: JSON.stringify({ scope }) });
    state.aiSuggestions = data.suggestions || [];
    if (!state.aiSuggestions.length) {
      box.innerHTML = `<p class="muted">${esc(data.message || '冇需要分類嘅項目。')}</p>`;
      return;
    }
    const providerLabel = data.provider === 'openai'
      ? `AI 模型（${esc(data.model || '')}）`
      : '規則式分類（未用 AI）';
    box.innerHTML = `
      <p class="muted">以下係${providerLabel}嘅建議，剔選後撳「套用已選」：</p>
      ${state.aiSuggestions.map((s, i) => `
        <div class="suggest">
          <label><input type="checkbox" data-i="${i}" checked /> <b>${esc(s.title)}</b></label>
          <div class="from-to">由：${s.from.length ? s.from.map(esc).join('、') : '<i>未分類</i>'} → 變成：${s.to.length ? s.to.map(esc).join('、') : '<i>未分類</i>'}</div>
          <div class="reason">原因：${esc(s.reason)}</div>
        </div>`).join('')}
      <div class="modal-actions"><button id="ai-apply" class="btn ai">套用已選</button></div>
      <div id="ai-log"></div>`;
    $('ai-apply').addEventListener('click', applyAi);
  } catch (err) {
    box.innerHTML = `<p class="muted">失敗：${esc(err.message)}</p>`;
  }
}

async function applyAi() {
  const checked = [...document.querySelectorAll('#ai-results input[type=checkbox]:checked')]
    .map((x) => state.aiSuggestions[Number(x.dataset.i)])
    .filter(Boolean);
  if (!checked.length) { toast('未揀任何建議'); return; }
  try {
    const data = await api('/api/ai/apply', {
      method: 'POST',
      body: JSON.stringify({
        changes: checked.map((s) => ({ itemId: s.itemId, categoryIds: s.toIds, reason: s.reason })),
      }),
    });
    $('ai-log').innerHTML = `
      <h3>修改記錄（已套用 ${data.applied} 項）</h3>
      <ul class="log-list">${data.log.map((l) => `
        <li><b>${esc(l.title)}</b><br>
        ${l.from.length ? l.from.map(esc).join('、') : '未分類'} → ${l.to.length ? l.to.map(esc).join('、') : '未分類'}
        ${l.reason ? `<br><span class="muted">原因：${esc(l.reason)}</span>` : ''}</li>`).join('')}
      </ul>`;
    toast(`已套用 ${data.applied} 項分類`);
    await loadData();
  } catch (err) { toast(err.message); }
}

/* ---------- 事件綁定 ---------- */

function bind() {
  $('btn-login').addEventListener('click', () => { window.location.href = '/auth/login'; });
  $('btn-logout').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  });
  $('btn-drive-folder').addEventListener('click', () => {
    if (state.status.driveFolderLink) window.open(state.status.driveFolderLink, '_blank', 'noopener');
  });

  document.querySelectorAll('#views .view-btn').forEach((b) => {
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      state.activeCat = null;
      syncViewButtons();
      renderAll();
      if (state.view !== 'trash') renderItems();
    });
  });
  $('btn-add-cat').addEventListener('click', () => openCatModal(null));

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value.trim(); renderItems(); }, 180);
  });

  $('btn-add-item').addEventListener('click', () => openItemModal(null));
  $('btn-ai').addEventListener('click', openAiModal);

  $('f-cancel').addEventListener('click', () => $('modal-item').classList.add('hidden'));
  $('f-save').addEventListener('click', saveItem);
  $('f-addcat').addEventListener('click', quickAddCategoryFromItem);

  $('c-cancel').addEventListener('click', () => $('modal-cat').classList.add('hidden'));
  $('c-save').addEventListener('click', async () => {
    const name = $('c-name').value.trim();
    if (!name) { toast('分類名稱唔可以空白'); return; }
    try {
      if (state.editingCat) {
        await api(`/api/categories/${state.editingCat}`, { method: 'PUT', body: JSON.stringify({ name }) });
        toast('已改名');
      } else {
        await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
        toast('已新增分類');
      }
      $('modal-cat').classList.add('hidden');
      await loadData();
    } catch (err) { toast(err.message); }
  });

  $('ai-cancel').addEventListener('click', () => $('modal-ai').classList.add('hidden'));
  $('ai-run').addEventListener('click', runAiSuggest);

  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  });
}

/* ---------- 啟動 ---------- */

(async function init() {
  bind();
  await loadStatus();
  if (state.status.configured && state.status.connected) {
    try {
      await loadData();
    } catch (err) {
      toast(err.message);
    }
  } else if (state.status.configured) {
    $('empty').classList.remove('hidden');
    $('empty').textContent = '請先撳右上角「登入 Google Drive」連接你嘅雲端硬碟。';
  }
})();
