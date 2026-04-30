// ============================================
// 承銷研修所 / Lex Studio
// 法規導航中心（Phase 1 + Phase 2 T2.1–T2.3）
// ============================================

const APP_VERSION = 'v0.1';
const DATA_URL = './data/law_index.json';

// ============================================
// State
// ============================================

let lawIndex = null;          // 完整 law_index.json
let categoriesByCode = {};    // { A: { code, name, color }, ... }
let activeCategory = 'all';   // 目前篩選的分類 code
let currentQuery = '';        // 搜尋輸入

// ============================================
// 工具函式
// ============================================

function escapeHTML(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function highlight(text, query) {
  if (!query) return escapeHTML(text);
  const escaped = escapeHTML(text);
  const reg = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return escaped.replace(reg, m => `<mark>${m}</mark>`);
}

function buildArticleUrl(law, articleNo) {
  if (!law.article_url_template) return null;
  return law.article_url_template.replace('{article_no}', encodeURIComponent(articleNo));
}

// ============================================
// 載入資料
// ============================================

async function loadData() {
  try {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    lawIndex = await resp.json();
  } catch (e) {
    showLoadError(e);
    return;
  }

  categoriesByCode = {};
  (lawIndex.categories || []).forEach(c => { categoriesByCode[c.code] = c; });

  updateBanner();
  renderChips();
  renderResults();
}

function showLoadError(err) {
  document.getElementById('lookupArea').innerHTML = `
    <div class="empty">
      <div class="empty-mark">⚠</div>
      <div class="empty-text">
        無法載入法規索引<br>
        <small style="color: var(--ink-dim); font-family: var(--mono);">${escapeHTML(err.message || String(err))}</small>
      </div>
    </div>`;
  document.getElementById('syncInfo').textContent = '載入失敗';
}

// ============================================
// 頂部 banner
// ============================================

function updateBanner() {
  const total = (lawIndex.laws || []).length;
  const date = lawIndex.last_updated || '—';
  document.getElementById('dataDate').textContent = date;
  document.getElementById('syncInfo').innerHTML = `
    最近更新：<strong>${escapeHTML(date)}</strong> · 索引版本：<strong>${escapeHTML(lawIndex.version || '—')}</strong><br>
    收錄 <strong>${total}</strong> 部法規（連結至全國法規資料庫、selaw、證交所等官方來源）
  `;
}

// ============================================
// 分類 chips
// ============================================

function renderChips() {
  const chipsEl = document.getElementById('lawChips');
  const cats = lawIndex.categories || [];

  const items = [
    { code: 'all', label: '全部', color: 'var(--primary)' },
    ...cats.map(c => ({
      code: c.code,
      label: `${c.code} ${c.name}`,
      color: c.color || 'var(--primary)',
    })),
  ];

  chipsEl.innerHTML = items.map(it => `
    <button class="chip ${it.code === activeCategory ? 'active' : ''}"
            data-cat="${escapeHTML(it.code)}"
            style="--cat-color: ${it.color}">
      ${escapeHTML(it.label)}
    </button>
  `).join('');

  chipsEl.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      renderChips();
      renderResults();
    });
  });
}

// ============================================
// 搜尋邏輯
// ============================================

// 解析「法規 條號」格式
// 範例：證交法 22 / 公司法 167-2 / 證券交易法 28-2
function parseSmartQuery(q) {
  if (!q) return null;
  const m = q.match(/^(.+?)[\s　]+(\d+(?:[-_]\d+)?)$/);
  if (!m) return null;
  return { lawPart: m[1].trim(), articleNo: m[2].replace('_', '-') };
}

function findLawByQuery(lawPart) {
  if (!lawPart) return null;
  const laws = lawIndex.laws || [];
  const lower = lawPart.toLowerCase();

  // 1. id 完全匹配
  let hit = laws.find(l => l.id && l.id.toLowerCase() === lower);
  if (hit) return hit;

  // 2. abbreviation 完全匹配
  hit = laws.find(l => l.abbreviation === lawPart);
  if (hit) return hit;

  // 3. name 完全匹配
  hit = laws.find(l => l.name === lawPart);
  if (hit) return hit;

  // 4. search_keywords 完全匹配
  hit = laws.find(l => Array.isArray(l.search_keywords) && l.search_keywords.includes(lawPart));
  if (hit) return hit;

  // 5. 部分匹配（縮寫 / 名稱 / keywords）
  hit = laws.find(l =>
    (l.abbreviation && l.abbreviation.includes(lawPart)) ||
    (l.name && l.name.includes(lawPart)) ||
    (Array.isArray(l.search_keywords) && l.search_keywords.some(k => k.includes(lawPart)))
  );
  return hit || null;
}

function matchesQuery(law, q) {
  if (!q) return true;
  const fields = [
    law.name, law.abbreviation, law.id, law.issuing_authority,
    ...(law.search_keywords || []),
  ];
  return fields.some(f => f && String(f).toLowerCase().includes(q.toLowerCase()));
}

function filterLaws() {
  const laws = lawIndex.laws || [];
  const smart = parseSmartQuery(currentQuery);
  // 智慧查詢命中時，用 lawPart 作為過濾關鍵字（更聚焦）
  const filterQuery = smart ? smart.lawPart : currentQuery;

  return laws.filter(l => {
    if (activeCategory !== 'all' && l.category !== activeCategory) return false;
    return matchesQuery(l, filterQuery);
  });
}

// ============================================
// 智慧查詢命中 banner
// ============================================

function renderSmartHit() {
  const container = document.getElementById('smartHit');
  const smart = parseSmartQuery(currentQuery);
  if (!smart) { container.innerHTML = ''; return; }

  const law = findLawByQuery(smart.lawPart);
  if (!law) { container.innerHTML = ''; return; }

  const url = buildArticleUrl(law, smart.articleNo) || law.primary_url;
  const supportsDeepLink = !!law.article_url_template;

  // 從 common_articles 找對應的 topic（可選）
  let topic = '';
  if (Array.isArray(law.common_articles)) {
    const found = law.common_articles.find(a => a.no === smart.articleNo);
    if (found && found.topic) topic = found.topic;
  }

  const note = supportsDeepLink
    ? '點擊跳轉至全國法規資料庫單條條文'
    : '此法規未提供單條深層連結，將跳轉至法規全文頁';

  container.innerHTML = `
    <div class="smart-hit">
      <div class="label">⌖ 智慧查詢命中</div>
      <div class="target">
        ${escapeHTML(law.abbreviation || law.name)}
        <span class="article">第 ${escapeHTML(smart.articleNo)} 條</span>
        ${topic ? `<span class="topic">（${escapeHTML(topic)}）</span>` : ''}
      </div>
      <a class="smart-hit-action" href="${escapeHTML(url)}" target="_blank" rel="noopener">
        前往查看 ↗
      </a>
      <div class="note">${escapeHTML(note)}</div>
    </div>
  `;
}

// ============================================
// 法規卡片
// ============================================

function renderLawCard(law) {
  const cat = categoriesByCode[law.category] || { color: 'var(--primary)', name: '' };
  const color = cat.color || 'var(--primary)';

  const articleChips = (law.common_articles || []).map(a => {
    const url = buildArticleUrl(law, a.no);
    if (url) {
      return `<a class="article-chip" href="${escapeHTML(url)}" target="_blank" rel="noopener" title="${escapeHTML(a.topic || '')}">
        第 ${escapeHTML(a.no)} 條
        ${a.topic ? `<span class="topic">${escapeHTML(a.topic)}</span>` : ''}
      </a>`;
    }
    return `<span class="article-chip" aria-disabled="true" title="此法規不支援單條深層連結">
      第 ${escapeHTML(a.no)} 條
      ${a.topic ? `<span class="topic">${escapeHTML(a.topic)}</span>` : ''}
    </span>`;
  }).join('');

  return `
    <div class="law-item" style="--cat-color: ${color}">
      <div class="law-item-head">
        <span class="law-cat-tag">${escapeHTML(law.category)}</span>
        <span class="law-id">${escapeHTML(law.id)}</span>
      </div>
      <div class="law-name">${highlight(law.name || '', currentQuery)}</div>
      <div class="law-meta">
        ${law.abbreviation ? `<span class="law-abbr">${escapeHTML(law.abbreviation)}</span>` : ''}
        ${law.issuing_authority ? `<span class="law-authority">${escapeHTML(law.issuing_authority)}</span>` : ''}
      </div>
      ${articleChips ? `<div class="law-articles">
        <span class="article-chip-label">常用條文</span>
        ${articleChips}
      </div>` : ''}
      <a class="btn-view-full" href="${escapeHTML(law.primary_url)}" target="_blank" rel="noopener">
        查看全文 ↗
      </a>
    </div>
  `;
}

function renderResults() {
  renderSmartHit();

  const area = document.getElementById('lookupArea');
  const results = filterLaws();
  const total = (lawIndex.laws || []).length;

  document.getElementById('statsLine').textContent =
    `// 顯示 ${results.length} / ${total} 部法規`;

  if (results.length === 0) {
    area.innerHTML = `
      <div class="empty">
        <div class="empty-mark">∅</div>
        <div class="empty-text">查無相符法規<br>請嘗試其他關鍵字或調整分類</div>
      </div>`;
    return;
  }

  area.innerHTML = `<div class="law-list">${results.map(renderLawCard).join('')}</div>`;
}

// ============================================
// 分頁切換
// ============================================

function goPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + name);
  if (target) target.classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  window.scrollTo(0, 0);
}

// ============================================
// 免責聲明 modal
// ============================================

function openDisclaimer() {
  const modal = document.getElementById('disclaimerModal');
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDisclaimer() {
  const modal = document.getElementById('disclaimerModal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

// ============================================
// Init
// ============================================

document.querySelectorAll('.tab, .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => goPage(btn.dataset.page));
});

document.getElementById('searchInput').addEventListener('input', e => {
  currentQuery = e.target.value.trim();
  renderResults();
});

document.getElementById('openDisclaimer').addEventListener('click', openDisclaimer);
document.getElementById('closeDisclaimer').addEventListener('click', closeDisclaimer);
document.getElementById('disclaimerModal').addEventListener('click', e => {
  if (e.target.id === 'disclaimerModal') closeDisclaimer();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDisclaimer();
});

document.getElementById('footerVersion').textContent = APP_VERSION;

loadData();
