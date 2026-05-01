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
// 問答集（PDF 索引 + 跨類搜尋）
// PRD §6 嚴格保留主管機關原文，PDF 連結指回 sfb.gov.tw
// ============================================

const QA_DATA_URL = './output/qa.json';
const QA_SNIPPET_RADIUS = 50;  // 命中片段前後字元數
const QA_MAX_HITS = 80;        // 跨類搜尋最大顯示筆數

let qaData = null;
let qaLoaded = false;
let qaLoadStarted = false;
let qaState = 'categories';        // 'categories' | 'documents' | 'detail'
let qaSelectedCategoryId = null;
let qaSelectedDocIndex = null;     // 對應 selected category 的 documents 索引
let qaQuery = '';

async function ensureQaLoaded() {
  if (qaLoaded || qaLoadStarted) return;
  qaLoadStarted = true;
  try {
    const resp = await fetch(QA_DATA_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    qaData = await resp.json();
    qaLoaded = true;
  } catch (e) {
    qaData = null;
    qaLoaded = true;
    console.log('[qa] qa.json 尚未產生：', e.message);
  }
  renderQa();
}

function qaCategoryById(id) {
  if (!qaData) return null;
  return (qaData.categories || []).find(c => c.id === id) || null;
}

function qaDocCount(category) {
  return (category && Array.isArray(category.documents)) ? category.documents.length : 0;
}

// ----- 跨類全文搜尋 -----

function qaSearchAll(query) {
  if (!qaData || !query) return [];
  const lower = query.toLowerCase();
  const hits = [];
  for (const cat of (qaData.categories || [])) {
    const docs = cat.documents || [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const haystack = (doc.raw_text || '');
      const idx = haystack.toLowerCase().indexOf(lower);
      const titleHit = (doc.title || '').toLowerCase().includes(lower);
      if (idx < 0 && !titleHit) continue;

      let snippet = '';
      if (idx >= 0) {
        const start = Math.max(0, idx - QA_SNIPPET_RADIUS);
        const end = Math.min(haystack.length, idx + query.length + QA_SNIPPET_RADIUS);
        snippet = (start > 0 ? '⋯' : '') + haystack.slice(start, end) + (end < haystack.length ? '⋯' : '');
      }
      hits.push({ cat, doc, docIndex: i, snippet, titleHit });
      if (hits.length >= QA_MAX_HITS) return hits;
    }
  }
  return hits;
}

// ----- 渲染 -----

function renderQaSyncBanner() {
  const dateEl = document.getElementById('qaSyncInfo');
  if (!qaLoaded) {
    dateEl.textContent = '載入中⋯';
    return;
  }
  if (!qaData) {
    dateEl.innerHTML = '尚未產生 <code>output/qa.json</code> · 請完成 Phase 3 fetch_qa.py';
    return;
  }
  const totalDocs = (qaData.categories || []).reduce((s, c) => s + qaDocCount(c), 0);
  const fetched = qaData.fetched_at ? qaData.fetched_at.slice(0, 10) : '—';
  dateEl.innerHTML = `
    最近同步：<strong>${escapeHTML(fetched)}</strong>
    收錄 <strong>${(qaData.categories || []).length}</strong> 大類 · <strong>${totalDocs}</strong> 份原文文件<br>
    <span style="color: var(--ink-dim); font-size: 11px;">來源：${escapeHTML(qaData.source || 'sfb.gov.tw')} · PDF 下載連結指回證期局原網站</span>
  `;
}

function renderQaStats(text) {
  document.getElementById('qaStatsLine').textContent = text;
}

function renderQaEmpty(mark, text) {
  return `<div class="empty"><div class="empty-mark">${mark}</div><div class="empty-text">${text}</div></div>`;
}

function renderQaCategoriesView() {
  const cats = qaData.categories || [];
  renderQaStats(`// ${cats.length} 大類 · 點選進入瀏覽`);
  if (cats.length === 0) {
    return renderQaEmpty('∅', '尚無分類資料');
  }
  return `<div class="qa-cat-list">${cats.map(c => `
    <button class="qa-cat-card" data-cat-id="${c.id}">
      <div class="qa-cat-head">
        <span class="qa-cat-id">id ${c.id}</span>
        <span class="qa-cat-count">${qaDocCount(c)} 份</span>
      </div>
      <div class="qa-cat-name">${escapeHTML(c.name || '')}</div>
    </button>
  `).join('')}</div>`;
}

function renderQaDocumentsView() {
  const cat = qaCategoryById(qaSelectedCategoryId);
  if (!cat) {
    qaState = 'categories';
    return renderQaCategoriesView();
  }
  const docs = cat.documents || [];
  renderQaStats(`// ${cat.name} · ${docs.length} 份`);

  const list = docs.length === 0
    ? renderQaEmpty('∅', '此分類尚無文件')
    : `<div class="qa-doc-list">${docs.map((d, i) => `
        <button class="qa-doc-item${d.error ? ' qa-doc-item-error' : ''}" data-doc-index="${i}">
          <div class="qa-doc-title">${escapeHTML(d.title || '(無標題)')}</div>
          <div class="qa-doc-meta">
            <span class="qa-doc-date">${escapeHTML(d.publish_date || '—')}</span>
            ${d.page_count ? `<span class="qa-doc-pages">${d.page_count} 頁</span>` : ''}
            ${d.error ? `<span class="qa-doc-error-badge" title="${escapeHTML(d.error)}">⚠ 來源暫無法存取</span>` : ''}
          </div>
        </button>
      `).join('')}</div>`;

  return `
    <button class="back-link" data-action="qa-back-to-categories">← 回大類清單</button>
    <h3 class="qa-cat-title">${escapeHTML(cat.name || '')}</h3>
    ${list}
  `;
}

function renderQaDetailView() {
  const cat = qaCategoryById(qaSelectedCategoryId);
  if (!cat) { qaState = 'categories'; return renderQaCategoriesView(); }
  const doc = (cat.documents || [])[qaSelectedDocIndex];
  if (!doc) { qaState = 'documents'; return renderQaDocumentsView(); }
  renderQaStats(`// ${cat.name} · ${doc.title || ''}`);

  return `
    <button class="back-link" data-action="qa-back-to-documents">← 回 ${escapeHTML(cat.name || '')} 文件清單</button>
    <article class="qa-detail">
      <div class="qa-detail-source">${escapeHTML(cat.name || '')}</div>
      <h3 class="qa-detail-title">${escapeHTML(doc.title || '')}</h3>
      <div class="qa-detail-meta">
        ${doc.publish_date ? `<span>發布日期：<strong>${escapeHTML(doc.publish_date)}</strong></span>` : ''}
        ${doc.page_count ? `<span>${doc.page_count} 頁</span>` : ''}
      </div>
      ${doc.error
        ? `<div class="qa-doc-error">
            <div class="qa-doc-error-title">⚠ 來源暫無法存取</div>
            <div class="qa-doc-error-msg">本工具上次抓取此份文件時發生：<code>${escapeHTML(doc.error)}</code>。<br>
              這通常是 SFB 站台對直連下載暫時擋下，或文件已下架。請點下方連結直接到證期局原站閱覽。</div>
            ${doc.source_url ? `<a class="btn-pdf-download" href="${escapeHTML(doc.source_url)}" target="_blank" rel="noopener noreferrer">
              前往 SFB 原站 ↗
            </a>` : ''}
          </div>`
        : `<pre class="qa-raw-text">${escapeHTML(doc.raw_text || '(無原文)')}</pre>
           ${doc.source_url ? `<a class="btn-pdf-download" href="${escapeHTML(doc.source_url)}" target="_blank" rel="noopener noreferrer">
             下載原始 PDF（連至證期局網站）↗
           </a>` : ''}`
      }
      <div class="qa-detail-footer">
        ※ 本文件為主管機關原文，工具不對其內容做任何改寫。法令引用以證期局正式公告為準。
      </div>
    </article>
  `;
}

function renderQaSearchView() {
  const hits = qaSearchAll(qaQuery);
  renderQaStats(`// 搜尋「${qaQuery}」· ${hits.length} 筆${hits.length >= QA_MAX_HITS ? '（上限）' : ''}`);

  if (hits.length === 0) {
    return renderQaEmpty('∅', '查無相符問答<br>請嘗試其他關鍵字');
  }

  return `<div class="qa-hit-list">${hits.map((h, i) => `
    <button class="qa-hit-item" data-hit-cat="${h.cat.id}" data-hit-doc="${h.docIndex}">
      <div class="qa-hit-head">
        <span class="qa-hit-cat">${escapeHTML(h.cat.name || '')}</span>
        ${h.titleHit ? '<span class="qa-hit-flag">標題命中</span>' : ''}
      </div>
      <div class="qa-hit-title">${highlight(h.doc.title || '', qaQuery)}</div>
      ${h.snippet ? `<div class="qa-hit-snippet">${highlight(h.snippet, qaQuery)}</div>` : ''}
      ${h.doc.publish_date ? `<div class="qa-hit-date">${escapeHTML(h.doc.publish_date)}</div>` : ''}
    </button>
  `).join('')}</div>`;
}

function renderQa() {
  renderQaSyncBanner();
  const area = document.getElementById('qaArea');

  if (!qaLoaded) {
    area.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入問答集中⋯</div></div>`;
    renderQaStats('');
    return;
  }

  if (!qaData) {
    area.innerHTML = renderQaEmpty(
      '?',
      '證期局問答集尚未解析完成<br>' +
      '<small style="color: var(--ink-dim);">完成 Phase 3 後此處將顯示 23 大類問答集，可瀏覽與全文搜尋</small>'
    );
    renderQaStats('');
    return;
  }

  if (qaQuery) {
    area.innerHTML = renderQaSearchView();
  } else if (qaState === 'detail') {
    area.innerHTML = renderQaDetailView();
  } else if (qaState === 'documents') {
    area.innerHTML = renderQaDocumentsView();
  } else {
    area.innerHTML = renderQaCategoriesView();
  }

  bindQaEventDelegates(area);
}

function bindQaEventDelegates(area) {
  // 使用事件委派一次綁定，避免每次重渲染都重綁
  if (area.dataset.qaBound === '1') return;
  area.dataset.qaBound = '1';

  area.addEventListener('click', e => {
    const catCard = e.target.closest('.qa-cat-card');
    if (catCard) {
      qaSelectedCategoryId = parseInt(catCard.dataset.catId, 10);
      qaState = 'documents';
      renderQa();
      window.scrollTo(0, 0);
      return;
    }
    const docItem = e.target.closest('.qa-doc-item');
    if (docItem) {
      qaSelectedDocIndex = parseInt(docItem.dataset.docIndex, 10);
      qaState = 'detail';
      renderQa();
      window.scrollTo(0, 0);
      return;
    }
    const hitItem = e.target.closest('.qa-hit-item');
    if (hitItem) {
      qaSelectedCategoryId = parseInt(hitItem.dataset.hitCat, 10);
      qaSelectedDocIndex = parseInt(hitItem.dataset.hitDoc, 10);
      // 清空搜尋框，跳到 detail（不繼續顯示搜尋列表）
      qaQuery = '';
      document.getElementById('qaSearchInput').value = '';
      qaState = 'detail';
      renderQa();
      window.scrollTo(0, 0);
      return;
    }
    const back = e.target.closest('[data-action]');
    if (back) {
      if (back.dataset.action === 'qa-back-to-categories') {
        qaState = 'categories';
        qaSelectedCategoryId = null;
      } else if (back.dataset.action === 'qa-back-to-documents') {
        qaState = 'documents';
        qaSelectedDocIndex = null;
      }
      renderQa();
      window.scrollTo(0, 0);
    }
  });
}

// ============================================
// 學習進度（localStorage）
// 統一 key：題庫已合併為單一 200 題池，不再分精選 / 進階
// ============================================

const PROGRESS_KEY = 'underwriter_lex_quiz_progress';
const SCENARIO_PURGE_FLAG = 'underwriter_lex_scenario_purged_v1';
const UNIFIED_MIGRATION_FLAG = 'underwriter_lex_quiz_unified_v1';

// 啟動時一次性清理：移除任何遺留的 scenario / simulation 相關 localStorage key
function purgeScenarioStorage() {
  try {
    if (localStorage.getItem(SCENARIO_PURGE_FLAG) === '1') return;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (/scenario|simulation/i.test(k)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(SCENARIO_PURGE_FLAG, '1');
    if (toRemove.length > 0) {
      console.info('[migration] 已清除遺留 scenario localStorage key：', toRemove);
    }
  } catch (e) {
    console.error('[migration] purgeScenarioStorage 失敗：', e);
  }
}
purgeScenarioStorage();

// 啟動時一次性遷移：題庫從「精選 5 + 進階 200 雙池 / 雙 key」合併為「200 題單一池 / 單一 key」
//   - 舊 key 'underwriter_lex_progress'                    （精選 5 題進度，題 id 對不上新池 → 整個丟棄）
//   - 舊 key 'underwriter_lex_quiz_extended_progress'      （進階 200 題進度，題 id 與新池相同 → 搬到新 key）
//   - 新 key 'underwriter_lex_quiz_progress'               （統一進度）
function migrateToUnifiedQuizKey() {
  try {
    if (localStorage.getItem(UNIFIED_MIGRATION_FLAG) === '1') return;
    const OLD_CURATED = 'underwriter_lex_progress';
    const OLD_EXTENDED = 'underwriter_lex_quiz_extended_progress';
    const newRaw = localStorage.getItem(PROGRESS_KEY);
    const extRaw = localStorage.getItem(OLD_EXTENDED);
    // 若新 key 尚無資料但舊 extended 有，搬過去保留使用者進度
    if (!newRaw && extRaw) {
      localStorage.setItem(PROGRESS_KEY, extRaw);
      console.info('[migration] 已將 underwriter_lex_quiz_extended_progress 搬至 underwriter_lex_quiz_progress');
    }
    // 兩個舊 key 一律清掉（curated 進度 schema 同但 id 不相容；extended 已搬走）
    if (localStorage.getItem(OLD_CURATED) !== null) {
      localStorage.removeItem(OLD_CURATED);
      console.info('[migration] 已清除舊 curated 進度 underwriter_lex_progress（題 id 與新池不相容）');
    }
    if (localStorage.getItem(OLD_EXTENDED) !== null) {
      localStorage.removeItem(OLD_EXTENDED);
    }
    localStorage.setItem(UNIFIED_MIGRATION_FLAG, '1');
  } catch (e) {
    console.error('[migration] migrateToUnifiedQuizKey 失敗：', e);
  }
}
migrateToUnifiedQuizKey();

function defaultProgress() {
  return {
    version: 1,
    stats: {
      total_answered: 0,
      total_correct: 0,
      streak_days: 0,
      last_practice_date: null,
    },
    wrong_questions: [],
    category_progress: {},
    daily_completed: {},   // { "YYYY-MM-DD": "Q003" }
  };
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return defaultProgress();
    const p = JSON.parse(raw);
    if (!p || p.version !== 1) return defaultProgress();
    // 補齊新欄位（schema 演進時相容）
    const def = defaultProgress();
    p.stats = { ...def.stats, ...(p.stats || {}) };
    p.wrong_questions = p.wrong_questions || [];
    p.category_progress = p.category_progress || {};
    p.daily_completed = p.daily_completed || {};
    return p;
  } catch (e) {
    return defaultProgress();
  }
}

function saveProgress(p) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch (e) {
    console.error('localStorage write failed:', e);
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayStr() {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function recordAnswer(question, correct) {
  const p = loadProgress();
  p.stats.total_answered += 1;
  if (correct) p.stats.total_correct += 1;

  const today = todayStr();
  if (p.stats.last_practice_date !== today) {
    p.stats.streak_days = (p.stats.last_practice_date === yesterdayStr())
      ? (p.stats.streak_days || 0) + 1
      : 1;
    p.stats.last_practice_date = today;
  }

  const wrongIdx = p.wrong_questions.indexOf(question.id);
  if (correct) {
    if (wrongIdx >= 0) p.wrong_questions.splice(wrongIdx, 1);
  } else if (wrongIdx < 0) {
    p.wrong_questions.push(question.id);
  }

  const cat = question.category || '其他';
  if (!p.category_progress[cat]) p.category_progress[cat] = { answered: 0, correct: 0 };
  p.category_progress[cat].answered += 1;
  if (correct) p.category_progress[cat].correct += 1;

  saveProgress(p);
}

function clearWrongQuestions() {
  const p = loadProgress();
  p.wrong_questions = [];
  saveProgress(p);
}

// ============================================
// 題庫資料載入
// ============================================

const QUIZ_DATA_URL = './data/quiz_extended.json';
let quizData = null;                     // 200 題單一題庫（normalize 後）
let quizLoaded = false;
let quizLoadStarted = false;

// 將 quiz_extended.json 的 schema (options:dict / answer:letter / source:string)
// normalize 成內部一致格式 (options:array / correct_index:int / source:object)
// 以最小化既有 render 程式變更（source 採 object form 並透過 law_id 動態補 url）
function normalizeExtendedQuestion(q) {
  const optsArr = ['A', 'B', 'C', 'D'].map(k => q.options && q.options[k] || '');
  const correctIdx = ['A', 'B', 'C', 'D'].indexOf(q.answer);
  const diffMap = { easy: 'basic', hard: 'advanced', medium: 'medium' };
  const diff = diffMap[q.difficulty] || q.difficulty || 'medium';
  return {
    id: q.id,
    category: q.category || '其他',
    difficulty: diff,
    question: q.stem || '',
    options: optsArr,
    correct_index: correctIdx >= 0 ? correctIdx : 0,
    explanation: q.explanation || '',
    source: {
      // raw 字串保留 for renderSourceLink，url 在 render 時 lazy 補上（依賴 lawIndex）
      law_name: q.source || '',
      article: '',
      url: '',
      law_id: q.law_id || '',
    },
    _pending_review: q._pending_review === true,
    _added_at: q._added_at || '',
  };
}

async function ensureQuizLoaded() {
  if (quizLoaded || quizLoadStarted) return;
  quizLoadStarted = true;
  try {
    const resp = await fetch(QUIZ_DATA_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = await resp.json();
    const list = Array.isArray(raw.questions) ? raw.questions : [];
    quizData = {
      version: raw.version || '0',
      generated_at: raw.generated_at || '',
      categories: raw.categories || [],
      questions: list.map(normalizeExtendedQuestion),
    };
  } catch (e) {
    quizData = null;
    console.error('[quiz] 題庫載入失敗：', e);
  }
  quizLoaded = true;
}

function questionById(id) {
  return (quizData && quizData.questions || []).find(q => q.id === id) || null;
}

// 從 source 字串擷取條號（"證券交易法第 36 條第 1 項" → "36"；"第 28 條之 2" → "28-2"）
function parseArticleNo(srcStr) {
  if (!srcStr) return '';
  let m = srcStr.match(/第\s*(\d+)\s*條\s*之\s*(\d+)/);
  if (m) return `${m[1]}-${m[2]}`;
  m = srcStr.match(/第\s*(\d+(?:-\d+)?)\s*條/);
  if (m) return m[1];
  return '';
}

// 統一渲染 source link：支援 legacy (law_name+article+url) 與 extended (law_id 查 lawIndex 補 url) 兩種
function renderSourceLink(source) {
  if (!source) return '';
  let url = source.url || '';
  const lawId = source.law_id || '';
  if (!url && lawId && typeof lawIndex !== 'undefined' && lawIndex) {
    const law = (lawIndex.laws || []).find(L => L.id === lawId);
    if (law) {
      const articleNo = parseArticleNo(source.law_name || '');
      if (articleNo && law.article_url_template) {
        url = law.article_url_template.replace('{article_no}', encodeURIComponent(articleNo));
      } else {
        url = law.primary_url || '';
      }
    }
  }
  const label = (source.law_name || '') + (source.article ? ` 第 ${source.article} 條` : '');
  if (url) {
    return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">${escapeHTML(label)} ↗</a>`;
  }
  return escapeHTML(label);
}

// ============================================
// 題庫模組（state machine）
// ============================================

const quizSessions = {
  quiz: createSession('quiz'),
};

function createSession(mode) {
  return {
    mode,                          // 'quiz'（情境模擬已移除；現僅單一池）
    state: 'start',                // 'start' | 'playing' | 'feedback' | 'result'
    filter: { category: 'all', difficulty: 'all', count: 10 },
    questions: [],
    currentIdx: 0,
    answers: [],
    selectedIdx: null,
    reviewMode: false,             // 錯題本模式
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function poolForMode(_mode) {
  return (quizData && quizData.questions) || [];
}

function startSession(mode, opts = {}) {
  const sess = quizSessions[mode];
  let pool = poolForMode(mode);

  if (opts.reviewMode) {
    // 錯題本：只看當前 pool 內 id（舊 progress 殘留之 id 對不上會自動忽略）
    const validIds = new Set(pool.map(q => q.id));
    const wrongIds = loadProgress().wrong_questions.filter(id => validIds.has(id));
    pool = pool.filter(q => wrongIds.includes(q.id));
    sess.reviewMode = true;
  } else {
    sess.reviewMode = false;
    if (sess.filter.category !== 'all') pool = pool.filter(q => q.category === sess.filter.category);
    if (sess.filter.difficulty !== 'all') pool = pool.filter(q => q.difficulty === sess.filter.difficulty);
  }

  if (pool.length === 0) {
    alert(opts.reviewMode ? '錯題本是空的，先答幾題再來複習。' : '此分類 / 難度暫無題目，請放寬條件。');
    return;
  }

  // count = 0 視為「全部」
  const requested = sess.filter.count;
  const wantedCount = opts.reviewMode ? pool.length
                    : (requested === 0 ? pool.length : Math.min(requested, pool.length));
  sess.questions = shuffle(pool).slice(0, wantedCount);
  sess.currentIdx = 0;
  sess.answers = [];
  sess.selectedIdx = null;
  sess.state = 'playing';
  renderQuizPage(mode);
}

function selectAnswer(mode, idx) {
  const sess = quizSessions[mode];
  if (sess.state !== 'playing') return;
  const q = sess.questions[sess.currentIdx];
  const correct = idx === q.correct_index;
  sess.answers.push({ questionId: q.id, selectedIdx: idx, correct });
  sess.selectedIdx = idx;
  sess.state = 'feedback';
  recordAnswer(q, correct);
  renderQuizPage(mode);
}

function nextQuestion(mode) {
  const sess = quizSessions[mode];
  if (sess.currentIdx + 1 >= sess.questions.length) {
    sess.state = 'result';
  } else {
    sess.currentIdx += 1;
    sess.selectedIdx = null;
    sess.state = 'playing';
  }
  renderQuizPage(mode);
}

function restartSession(mode) {
  quizSessions[mode] = createSession(mode);
  renderQuizPage(mode);
}

// ----- Render -----

function quizAreaEl(mode) {
  return document.getElementById('quizArea');
}

function renderQuizPage(mode) {
  const area = quizAreaEl(mode);
  if (!quizLoaded) {
    area.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入題庫中⋯</div></div>`;
    return;
  }
  if (!quizData) {
    area.innerHTML = renderQaEmpty('!', `題庫載入失敗<br><small style="color: var(--ink-dim);">請確認 ${QUIZ_DATA_URL} 存在</small>`);
    return;
  }
  const sess = quizSessions[mode];
  if (sess.state === 'start') area.innerHTML = renderQuizStart(mode);
  else if (sess.state === 'result') area.innerHTML = renderQuizResult(mode);
  else area.innerHTML = renderQuizPlay(mode);

  bindQuizDelegates(area, mode);
}

function renderQuizStart(mode) {
  const sess = quizSessions[mode];
  const pool = poolForMode(mode);
  const cats = ['all', ...Array.from(new Set(pool.map(q => q.category)))];
  const diffs = [
    { v: 'all', label: '全部' },
    { v: 'basic', label: '基礎' },
    { v: 'medium', label: '中等' },
    { v: 'advanced', label: '進階' },
  ];
  // count=0 代表「全部」
  const counts = [10, 20, 50, 0];
  const countLabel = n => n === 0 ? '全部' : `${n} 題`;
  // 錯題本：忽略 id 已不在當前 pool（舊 progress 殘留）
  const validIds = new Set(pool.map(q => q.id));
  const wrongCount = loadProgress().wrong_questions.filter(id => validIds.has(id)).length;

  return `
    <div class="quiz-start">
      <div class="quiz-pool-summary">// 題庫共 ${pool.length} 題</div>

      <div class="quiz-section-label">分類</div>
      <div class="chips" data-filter-group="category">
        ${cats.map(c => `
          <button class="chip ${sess.filter.category === c ? 'active' : ''}" data-filter-value="${escapeHTML(c)}">
            ${c === 'all' ? '全部' : escapeHTML(c)}
          </button>`).join('')}
      </div>

      <div class="quiz-section-label">難度</div>
      <div class="chips" data-filter-group="difficulty">
        ${diffs.map(d => `
          <button class="chip ${sess.filter.difficulty === d.v ? 'active' : ''}" data-filter-value="${d.v}">
            ${d.label}
          </button>`).join('')}
      </div>

      <div class="quiz-section-label">題數</div>
      <div class="chips" data-filter-group="count">
        ${counts.map(n => `
          <button class="chip ${sess.filter.count === n ? 'active' : ''}" data-filter-value="${n}">
            ${countLabel(n)}
          </button>`).join('')}
      </div>

      <button class="btn-primary" data-action="start">
        開始練習
      </button>

      <button class="btn-secondary ${wrongCount === 0 ? 'disabled' : ''}"
              data-action="review"
              ${wrongCount === 0 ? 'aria-disabled="true"' : ''}>
        錯題本（${wrongCount} 題）
      </button>
    </div>
  `;
}

function renderQuizPlay(mode) {
  const sess = quizSessions[mode];
  const q = sess.questions[sess.currentIdx];
  const total = sess.questions.length;
  const isFeedback = sess.state === 'feedback';

  const dots = sess.questions.map((_, i) => {
    let cls = 'dot';
    if (i < sess.currentIdx) cls += sess.answers[i] && sess.answers[i].correct ? ' correct' : ' wrong';
    if (i === sess.currentIdx) cls += ' current';
    return `<span class="${cls}"></span>`;
  }).join('');

  const opts = q.options.map((opt, i) => {
    let cls = 'quiz-option';
    let mark = '';
    if (isFeedback) {
      if (i === q.correct_index) { cls += ' correct'; mark = '✓'; }
      else if (i === sess.selectedIdx) { cls += ' wrong'; mark = '✗'; }
    } else if (i === sess.selectedIdx) {
      cls += ' selected';
    }
    return `<button class="${cls}" data-action="select" data-opt="${i}" ${isFeedback ? 'disabled' : ''}>
      <span class="opt-letter">${'ABCD'[i]}</span>
      <span class="opt-text">${escapeHTML(opt)}</span>
      ${mark ? `<span class="opt-mark">${mark}</span>` : ''}
    </button>`;
  }).join('');

  const feedback = !isFeedback ? '' : `
    <div class="quiz-feedback">
      <div class="feedback-label ${sess.answers[sess.currentIdx].correct ? 'correct' : 'wrong'}">
        ${sess.answers[sess.currentIdx].correct ? '✓ 答對' : '✗ 答錯'}
      </div>
      <div class="feedback-explanation">${escapeHTML(q.explanation)}</div>
      ${q.source ? `
      <div class="feedback-source">
        法源依據：${renderSourceLink(q.source)}
      </div>` : ''}
      ${q._pending_review ? `
      <div class="feedback-pending-note">
        ⚠ 此題尚未經人工驗證，內容僅供參考；如有疑義以正式條文及最新主管機關解釋為準。
      </div>` : ''}
      <button class="btn-primary" data-action="next">
        ${sess.currentIdx + 1 >= total ? '查看結果' : '下一題'}
      </button>
    </div>
  `;

  return `
    <div class="quiz-play">
      <button class="back-link" data-action="quit">← 結束練習</button>
      <div class="quiz-progress-dots">${dots}</div>
      <div class="quiz-meta">
        <span class="quiz-meta-cat">${escapeHTML(q.category)}</span>
        <span class="quiz-meta-diff">${escapeHTML(q.difficulty)}</span>
        <span class="quiz-meta-pos">${sess.currentIdx + 1} / ${total}</span>
      </div>
      <div class="quiz-question">${escapeHTML(q.question)}</div>
      <div class="quiz-options">${opts}</div>
      ${feedback}
    </div>
  `;
}

function renderQuizResult(mode) {
  const sess = quizSessions[mode];
  const total = sess.questions.length;
  const correct = sess.answers.filter(a => a.correct).length;
  const pct = total > 0 ? Math.round(correct * 100 / total) : 0;
  const wrongAnswers = sess.answers.filter(a => !a.correct);

  const wrongList = wrongAnswers.map(a => {
    const q = questionById(a.questionId);
    if (!q) return '';
    return `<li>
      <div class="result-wrong-cat">${escapeHTML(q.category)} · ${escapeHTML(q.difficulty)}</div>
      <div class="result-wrong-q">${escapeHTML(q.question)}</div>
      <div class="result-wrong-correct">正解：${'ABCD'[q.correct_index]}. ${escapeHTML(q.options[q.correct_index])}</div>
    </li>`;
  }).join('');

  return `
    <div class="quiz-result">
      <div class="result-headline">
        <div class="result-pct">${pct}%</div>
        <div class="result-fraction">${correct} / ${total}</div>
      </div>

      ${wrongAnswers.length > 0 ? `
        <div class="quiz-section-label">答錯題目（${wrongAnswers.length}）</div>
        <ul class="result-wrong-list">${wrongList}</ul>
      ` : `<div class="quiz-section-label" style="color: var(--jade);">完美！全部答對</div>`}

      <div class="result-actions">
        <button class="btn-primary" data-action="restart">重新開始</button>
        ${wrongAnswers.length > 0 ? `<button class="btn-secondary" data-action="review">複習錯題本</button>` : ''}
      </div>
    </div>
  `;
}

function bindQuizDelegates(area, mode) {
  if (area.dataset.qzBound === '1') return;
  area.dataset.qzBound = '1';

  area.addEventListener('click', e => {
    const sess = quizSessions[mode];
    const t = e.target.closest('[data-action], [data-filter-value]');
    if (!t) return;

    if (t.dataset.filterValue !== undefined) {
      const group = t.parentElement.dataset.filterGroup;
      const val = t.dataset.filterValue;
      sess.filter[group] = (group === 'count') ? parseInt(val, 10) : val;
      renderQuizPage(mode);
      return;
    }
    const action = t.dataset.action;
    if (action === 'start') startSession(mode);
    else if (action === 'review') startSession(mode, { reviewMode: true });
    else if (action === 'select') selectAnswer(mode, parseInt(t.dataset.opt, 10));
    else if (action === 'next') nextQuestion(mode);
    else if (action === 'quit') {
      sess.state = 'start';
      renderQuizPage(mode);
    } else if (action === 'restart') restartSession(mode);
  });
}

// ============================================
// 首頁：今日挑戰 + 進度
// ============================================

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getDailyQuestion() {
  // 今日挑戰：從統一 200 題池依日期 hash 挑一題（每天同一題）
  if (!quizData) return null;
  const pool = quizData.questions || [];
  if (pool.length === 0) return null;
  return pool[hashString(todayStr()) % pool.length];
}

let dailyAnswerSelected = null;

function renderDailyChallenge() {
  const el = document.getElementById('dailyChallenge');
  if (!quizLoaded) {
    el.innerHTML = `<div class="loading"><div class="spinner"></div><div>準備今日挑戰⋯</div></div>`;
    return;
  }
  if (!quizData) {
    el.innerHTML = renderQaEmpty('!', '題庫尚未載入');
    return;
  }
  const q = getDailyQuestion();
  if (!q) { el.innerHTML = renderQaEmpty('⌖', '今日無題目可挑戰'); return; }

  const progress = loadProgress();
  const today = todayStr();
  const completedQid = progress.daily_completed[today];
  const completed = completedQid === q.id;

  if (!completed && dailyAnswerSelected === null) {
    el.innerHTML = `
      <div class="daily-card">
        <div class="daily-label">⌖ 今日挑戰 · ${escapeHTML(today)}</div>
        <div class="daily-meta">
          <span class="quiz-meta-cat">${escapeHTML(q.category)}</span>
          <span class="quiz-meta-diff">${escapeHTML(q.difficulty)}</span>
        </div>
        <div class="daily-question">${escapeHTML(q.question)}</div>
        <div class="quiz-options">
          ${q.options.map((opt, i) => `
            <button class="quiz-option" data-daily-opt="${i}">
              <span class="opt-letter">${'ABCD'[i]}</span>
              <span class="opt-text">${escapeHTML(opt)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    const selected = completed ? null : dailyAnswerSelected;
    const isCorrect = completed
      ? null   // 已答過，不再強調對錯（保留學習感）
      : (selected === q.correct_index);
    const opts = q.options.map((opt, i) => {
      let cls = 'quiz-option';
      let mark = '';
      if (i === q.correct_index) { cls += ' correct'; mark = '✓'; }
      else if (selected !== null && i === selected) { cls += ' wrong'; mark = '✗'; }
      return `<button class="${cls}" disabled>
        <span class="opt-letter">${'ABCD'[i]}</span>
        <span class="opt-text">${escapeHTML(opt)}</span>
        ${mark ? `<span class="opt-mark">${mark}</span>` : ''}
      </button>`;
    }).join('');

    el.innerHTML = `
      <div class="daily-card">
        <div class="daily-label">⌖ 今日挑戰 · ${escapeHTML(today)} ${completed ? '· <span style="color:var(--jade)">已完成</span>' : ''}</div>
        <div class="daily-meta">
          <span class="quiz-meta-cat">${escapeHTML(q.category)}</span>
          <span class="quiz-meta-diff">${escapeHTML(q.difficulty)}</span>
        </div>
        <div class="daily-question">${escapeHTML(q.question)}</div>
        <div class="quiz-options">${opts}</div>
        <div class="quiz-feedback">
          ${isCorrect === true ? '<div class="feedback-label correct">✓ 答對</div>' : ''}
          ${isCorrect === false ? '<div class="feedback-label wrong">✗ 答錯</div>' : ''}
          <div class="feedback-explanation">${escapeHTML(q.explanation)}</div>
          ${q.source ? `
          <div class="feedback-source">
            法源依據：
            <a href="${escapeHTML(q.source.url)}" target="_blank" rel="noopener">
              ${escapeHTML(q.source.law_name || '')}${q.source.article ? ` 第 ${escapeHTML(q.source.article)} 條` : ''} ↗
            </a>
          </div>` : ''}
        </div>
      </div>
    `;
  }

  bindDailyDelegates(el, q);
}

function bindDailyDelegates(el, q) {
  if (el.dataset.dailyBound === '1') return;
  el.dataset.dailyBound = '1';
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-daily-opt]');
    if (!t) return;
    const idx = parseInt(t.dataset.dailyOpt, 10);
    dailyAnswerSelected = idx;
    const correct = idx === q.correct_index;
    recordAnswer(q, correct);
    const p = loadProgress();
    p.daily_completed[todayStr()] = q.id;
    saveProgress(p);
    renderDailyChallenge();
    renderProgress();
  });
}

function renderProgress() {
  const el = document.getElementById('progressArea');
  const p = loadProgress();
  const correctRate = p.stats.total_answered > 0
    ? Math.round(p.stats.total_correct * 100 / p.stats.total_answered)
    : 0;

  const catRows = Object.entries(p.category_progress)
    .sort((a, b) => b[1].answered - a[1].answered)
    .slice(0, 6)
    .map(([cat, s]) => `
      <li>
        <span class="cat-name">${escapeHTML(cat)}</span>
        <span class="cat-stat">${s.correct}/${s.answered} · ${s.answered > 0 ? Math.round(s.correct*100/s.answered) : 0}%</span>
      </li>
    `).join('');

  el.innerHTML = `
    <div class="progress-grid">
      <div class="progress-card">
        <div class="progress-num">${p.stats.streak_days || 0}</div>
        <div class="progress-label">連續學習天數</div>
      </div>
      <div class="progress-card">
        <div class="progress-num">${p.stats.total_answered}</div>
        <div class="progress-label">累計答題</div>
      </div>
      <div class="progress-card">
        <div class="progress-num">${correctRate}<span class="progress-unit">%</span></div>
        <div class="progress-label">答對率</div>
      </div>
      <div class="progress-card">
        <div class="progress-num">${p.wrong_questions.length}</div>
        <div class="progress-label">錯題本</div>
      </div>
    </div>

    ${catRows ? `
      <div class="progress-cat-block">
        <div class="quiz-section-label">分類進度（前 6 名）</div>
        <ul class="progress-cat-list">${catRows}</ul>
      </div>
    ` : ''}
  `;
}

async function initHome() {
  await ensureQuizLoaded();
  renderDailyChallenge();
  renderProgress();
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
  if (name === 'qa') ensureQaLoaded();
  if (name === 'exam') ensureExamLoaded();
  if (name === 'quiz') ensureQuizLoaded().then(() => renderQuizPage('quiz'));
  if (name === 'home') initHome();
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

document.querySelectorAll('.tab, .nav-btn, .quick-entry').forEach(btn => {
  btn.addEventListener('click', () => goPage(btn.dataset.page));
});

document.getElementById('searchInput').addEventListener('input', e => {
  currentQuery = e.target.value.trim();
  renderResults();
});

document.getElementById('qaSearchInput').addEventListener('input', e => {
  qaQuery = e.target.value.trim();
  renderQa();
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
initHome();   // 預先載入題庫，讓首頁的今日挑戰可立即顯示

// ============================================
// 考古題（證券商高級業務員歷屆試題）
// PRD: data/exam_archive/index.json + 各卷 JSON
// ============================================

const EXAM_INDEX_URL = './data/exam_archive/index.json';
const EXAM_PROGRESS_KEY = 'underwriter_lex_exam_progress';

let examIndex = null;
let examLoaded = false;
let examLoadStarted = false;
let examPapersCache = {};   // json_path → loaded paper

// State machine for 考古題
const examState = {
  view: 'home',           // 'home' | 'paper-select' | 'browse' | 'play' | 'result'
  filter: { year: 'all', subject: 'all', count: 20 },
  // 練習 session
  questions: [],
  currentIdx: 0,
  answers: [],
  selectedIdx: null,
  // 瀏覽模式
  selectedPaperPath: null,
  selectedPaperData: null,
};

const EXAM_SUBJECT_LABELS = {
  investment: '投資學',
  finance: '財務分析',
  law: '法規',
};

// 把 paper.questions 轉成 quiz 用 schema (id, stem, options[], correct_index, source)
function examQuestionToQuizFormat(paper, q) {
  // 送分 → answer === '*'，前端視為任何選項皆正確
  const optionLetters = ['A', 'B', 'C', 'D'];
  const optionTexts = optionLetters.map(L => q.options[L] || '');
  const correctIdx = q.answer === '*' ? -1 : optionLetters.indexOf(q.answer);

  return {
    id: q.id,
    type: 'exam',
    category: paper.subject_label,
    difficulty: 'exam',
    question: q.stem,
    options: optionTexts,
    correct_index: correctIdx,        // -1 = 送分
    answer_letter: q.answer,          // 原 letter，方便顯示
    explanation: q.answer === '*'
      ? '本題經審題委員確認為「送分」，所有選項均給分。'
      : `正確答案：${q.answer}. ${q.options[q.answer] || ''}`,
    source: {
      law_id: '',
      law_name: `${paper.year_label} ${paper.quarter} ${paper.subject_label}`,
      article: `第 ${q.number} 題`,
      url: paper.source_pdf,           // 連到 source PDF（repo 內路徑）
    },
    _meta: {
      year_roc: paper.year_roc,
      year_label: paper.year_label,
      quarter: paper.quarter,
      subject_key: paper.subject_key,
      number: q.number,
      pdf: paper.source_pdf,
    },
  };
}

async function ensureExamLoaded() {
  if (examLoaded || examLoadStarted) return;
  examLoadStarted = true;
  try {
    const resp = await fetch(EXAM_INDEX_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    examIndex = await resp.json();
    examLoaded = true;
  } catch (e) {
    examIndex = null;
    examLoaded = true;
    console.log('[exam] index.json 載入失敗：', e.message);
  }
  renderExam();
}

async function loadExamPaper(jsonPath) {
  if (examPapersCache[jsonPath]) return examPapersCache[jsonPath];
  const url = './' + jsonPath;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  examPapersCache[jsonPath] = data;
  return data;
}

// ----- Progress (localStorage) -----

function loadExamProgress() {
  try {
    const raw = localStorage.getItem(EXAM_PROGRESS_KEY);
    if (!raw) return { version: 1, papers_played: {}, total_answered: 0, total_correct: 0 };
    const p = JSON.parse(raw);
    if (!p || p.version !== 1) return { version: 1, papers_played: {}, total_answered: 0, total_correct: 0 };
    p.papers_played = p.papers_played || {};
    return p;
  } catch (e) {
    return { version: 1, papers_played: {}, total_answered: 0, total_correct: 0 };
  }
}

function saveExamProgress(p) {
  try { localStorage.setItem(EXAM_PROGRESS_KEY, JSON.stringify(p)); } catch (e) {}
}

function recordExamAnswer(question, correct) {
  const p = loadExamProgress();
  p.total_answered = (p.total_answered || 0) + 1;
  if (correct) p.total_correct = (p.total_correct || 0) + 1;
  const meta = question._meta;
  if (meta) {
    const k = `${meta.year_roc}_${meta.quarter}_${meta.subject_key}`;
    if (!p.papers_played[k]) p.papers_played[k] = { answered: 0, correct: 0 };
    p.papers_played[k].answered += 1;
    if (correct) p.papers_played[k].correct += 1;
  }
  saveExamProgress(p);
}

// ----- Filter & query helpers -----

function examFilteredPapers() {
  if (!examIndex) return [];
  return (examIndex.papers || []).filter(p => {
    if (examState.filter.year !== 'all' && String(p.year_roc) !== String(examState.filter.year)) return false;
    if (examState.filter.subject !== 'all' && p.subject_key !== examState.filter.subject) return false;
    return true;
  });
}

function examYearOptions() {
  if (!examIndex) return [];
  const set = new Set((examIndex.papers || []).map(p => p.year_roc));
  return Array.from(set).sort((a, b) => b - a);
}

// ----- Random pool builder -----

async function buildRandomPool() {
  const papers = examFilteredPapers();
  const all = [];
  for (const meta of papers) {
    try {
      const data = await loadExamPaper(meta.json_path);
      for (const q of (data.questions || [])) {
        all.push(examQuestionToQuizFormat(data, q));
      }
    } catch (e) {
      console.warn('[exam] paper load failed', meta.json_path, e);
    }
  }
  return all;
}

// ----- Render -----

function renderExamSyncBanner() {
  const el = document.getElementById('examSyncInfo');
  if (!examLoaded) { el.textContent = '載入中⋯'; return; }
  if (!examIndex) {
    el.innerHTML = '尚未產生 <code>data/exam_archive/index.json</code>';
    return;
  }
  const papers = examIndex.papers || [];
  const totalQ = papers.reduce((s, p) => s + (p.question_count || 0), 0);
  const years = examYearOptions();
  const yearRange = years.length ? `${years[years.length - 1]}–${years[0]}` : '—';
  el.innerHTML = `
    收錄 <strong>${papers.length}</strong> 份試卷 · <strong>${totalQ}</strong> 題（${escapeHTML(yearRange)} 年）<br>
    <span style="color: var(--ink-dim); font-size: 11px;">資料來源：金融研訓院公告試題與解答（PDF）</span>
  `;
}

function renderExamHome() {
  const yearOpts = ['all', ...examYearOptions().map(String)];
  const subjOpts = [
    { v: 'all', label: '全部' },
    { v: 'investment', label: '投資學' },
    { v: 'finance', label: '財務分析' },
    { v: 'law', label: '法規' },
  ];
  const counts = [10, 20, 50];
  const filtered = examFilteredPapers();
  const totalQ = filtered.reduce((s, p) => s + (p.question_count || 0), 0);
  const progress = loadExamProgress();
  const overallPct = progress.total_answered > 0
    ? Math.round(progress.total_correct * 100 / progress.total_answered)
    : 0;

  const yearChips = yearOpts.map(y => `
    <button class="chip ${examState.filter.year === y ? 'active' : ''}" data-exam-filter="year" data-val="${escapeHTML(y)}">
      ${y === 'all' ? '全部' : escapeHTML(y) + ' 年'}
    </button>`).join('');

  const subjChips = subjOpts.map(s => `
    <button class="chip ${examState.filter.subject === s.v ? 'active' : ''}" data-exam-filter="subject" data-val="${s.v}">
      ${escapeHTML(s.label)}
    </button>`).join('');

  const countChips = counts.map(n => `
    <button class="chip ${examState.filter.count === n ? 'active' : ''}" data-exam-filter="count" data-val="${n}">
      ${n} 題
    </button>`).join('');

  return `
    <div class="exam-home">
      <div class="exam-stats">
        <div class="exam-stats-item">
          <div class="exam-stats-num">${filtered.length}</div>
          <div class="exam-stats-label">符合條件試卷</div>
        </div>
        <div class="exam-stats-item">
          <div class="exam-stats-num">${totalQ}</div>
          <div class="exam-stats-label">題庫總數</div>
        </div>
        <div class="exam-stats-item">
          <div class="exam-stats-num">${progress.total_answered || 0}</div>
          <div class="exam-stats-label">已答題</div>
        </div>
        <div class="exam-stats-item">
          <div class="exam-stats-num">${overallPct}<span class="progress-unit">%</span></div>
          <div class="exam-stats-label">答對率</div>
        </div>
      </div>

      <div class="quiz-section-label">年度</div>
      <div class="chips">${yearChips}</div>

      <div class="quiz-section-label">主題</div>
      <div class="chips">${subjChips}</div>

      <div class="quiz-section-label">隨機抽題量</div>
      <div class="chips">${countChips}</div>

      <button class="btn-primary" data-exam-action="start-random">
        開始隨機練習（${examState.filter.count} 題）
      </button>

      <button class="btn-secondary" data-exam-action="goto-paper-select">
        瀏覽單份試卷（${filtered.length} 份）
      </button>
    </div>
  `;
}

function renderExamPaperSelect() {
  const list = examFilteredPapers();
  if (list.length === 0) {
    return `
      <button class="back-link" data-exam-action="back-home">← 回考古題首頁</button>
      <div class="empty"><div class="empty-mark">∅</div><div class="empty-text">無符合條件試卷<br>請放寬年度或主題</div></div>`;
  }
  // 按年降冪 → 季 → 主題排序
  list.sort((a, b) => (b.year_roc - a.year_roc) || (a.quarter > b.quarter ? 1 : -1) || a.subject_key.localeCompare(b.subject_key));
  const progress = loadExamProgress();

  const cards = list.map(p => {
    const k = `${p.year_roc}_${p.quarter}_${p.subject_key}`;
    const stat = progress.papers_played[k];
    const statTxt = stat ? `${stat.correct}/${stat.answered}` : '—';
    return `
      <button class="exam-paper-card" data-exam-paper="${escapeHTML(p.json_path)}">
        <div class="exam-paper-head">
          <span class="exam-paper-year">${escapeHTML(p.year_label)}</span>
          <span class="exam-paper-q">${escapeHTML(p.quarter)}</span>
        </div>
        <div class="exam-paper-subject">${escapeHTML(p.subject_label)}</div>
        <div class="exam-paper-meta">
          <span>${p.question_count} 題</span>
          <span class="exam-paper-stat">${escapeHTML(statTxt)}</span>
        </div>
      </button>`;
  }).join('');

  return `
    <button class="back-link" data-exam-action="back-home">← 回考古題首頁</button>
    <div class="quiz-section-label">選一份試卷（${list.length}）</div>
    <div class="exam-paper-list">${cards}</div>
  `;
}

function renderExamPaperDetail() {
  const data = examState.selectedPaperData;
  if (!data) {
    return `<button class="back-link" data-exam-action="back-paper-select">← 回試卷清單</button><div class="loading"><div class="spinner"></div><div>載入試卷中⋯</div></div>`;
  }
  return `
    <button class="back-link" data-exam-action="back-paper-select">← 回試卷清單</button>
    <div class="exam-paper-detail-head">
      <h3 class="exam-paper-detail-title">${escapeHTML(data.year_label)} ${escapeHTML(data.quarter)} · ${escapeHTML(data.subject_label)}</h3>
      <div class="exam-paper-detail-meta">${data.question_count} 題</div>
    </div>
    <div class="exam-paper-actions">
      <button class="btn-primary" data-exam-action="start-paper">開始作答（依序 ${data.question_count} 題）</button>
      <button class="btn-secondary" data-exam-action="browse-paper">瀏覽全卷（直接看答案）</button>
      ${data.source_pdf ? `<a class="btn-secondary" href="${escapeHTML(data.source_pdf)}" target="_blank" rel="noopener">查看原始 PDF ↗</a>` : ''}
    </div>
  `;
}

function renderExamBrowse() {
  const data = examState.selectedPaperData;
  if (!data) return '';
  const items = (data.questions || []).map(q => {
    const opts = ['A','B','C','D'].map(L => {
      const isCorrect = (q.answer === L);
      const isAllCorrect = q.answer === '*';
      const cls = isCorrect || isAllCorrect ? 'exam-browse-opt correct' : 'exam-browse-opt';
      return `<li class="${cls}"><span class="opt-letter">${L}</span><span class="opt-text">${escapeHTML(q.options[L] || '')}</span></li>`;
    }).join('');
    const ansLabel = q.answer === '*' ? '送分（全選給分）' : `${q.answer}. ${escapeHTML(q.options[q.answer] || '')}`;
    return `
      <article class="exam-browse-item">
        <div class="exam-browse-num">第 ${q.number} 題</div>
        <div class="exam-browse-stem">${escapeHTML(q.stem)}</div>
        <ul class="exam-browse-opts">${opts}</ul>
        <div class="exam-browse-ans">正解：<strong>${ansLabel}</strong></div>
      </article>
    `;
  }).join('');
  return `
    <button class="back-link" data-exam-action="back-paper-detail">← 回試卷說明</button>
    <h3 class="exam-paper-detail-title">${escapeHTML(data.year_label)} ${escapeHTML(data.quarter)} · ${escapeHTML(data.subject_label)}（瀏覽）</h3>
    <div class="exam-browse-list">${items}</div>
  `;
}

function renderExamPlay() {
  const q = examState.questions[examState.currentIdx];
  const total = examState.questions.length;
  const isFeedback = examState.view === 'feedback';

  const dots = examState.questions.map((_, i) => {
    let cls = 'dot';
    if (i < examState.currentIdx) cls += examState.answers[i] && examState.answers[i].correct ? ' correct' : ' wrong';
    if (i === examState.currentIdx) cls += ' current';
    return `<span class="${cls}"></span>`;
  }).join('');

  const opts = q.options.map((opt, i) => {
    let cls = 'quiz-option';
    let mark = '';
    if (isFeedback) {
      const isCorrect = (q.correct_index === -1) || (i === q.correct_index);  // 送分時全部標 correct
      if (isCorrect) { cls += ' correct'; mark = '✓'; }
      else if (i === examState.selectedIdx) { cls += ' wrong'; mark = '✗'; }
    } else if (i === examState.selectedIdx) {
      cls += ' selected';
    }
    return `<button class="${cls}" data-exam-action="select" data-opt="${i}" ${isFeedback ? 'disabled' : ''}>
      <span class="opt-letter">${'ABCD'[i]}</span>
      <span class="opt-text">${escapeHTML(opt)}</span>
      ${mark ? `<span class="opt-mark">${mark}</span>` : ''}
    </button>`;
  }).join('');

  const feedback = !isFeedback ? '' : `
    <div class="quiz-feedback">
      <div class="feedback-label ${examState.answers[examState.currentIdx].correct ? 'correct' : 'wrong'}">
        ${examState.answers[examState.currentIdx].correct ? '✓ 答對' : '✗ 答錯'}
      </div>
      <div class="feedback-explanation">${escapeHTML(q.explanation)}</div>
      <div class="feedback-source">
        出處：<strong>${escapeHTML(q.source.law_name)} ${escapeHTML(q.source.article)}</strong>
        ${q.source.url ? `· <a href="${escapeHTML(q.source.url)}" target="_blank" rel="noopener">原始 PDF ↗</a>` : ''}
      </div>
      <button class="btn-primary" data-exam-action="next">
        ${examState.currentIdx + 1 >= total ? '查看結果' : '下一題'}
      </button>
    </div>
  `;

  return `
    <button class="back-link" data-exam-action="quit">← 結束練習</button>
    <div class="quiz-progress-dots">${dots}</div>
    <div class="quiz-meta">
      <span class="quiz-meta-cat">${escapeHTML(q.category)}</span>
      <span class="quiz-meta-diff">${escapeHTML(q._meta.year_label)} ${escapeHTML(q._meta.quarter)}</span>
      <span class="quiz-meta-pos">${examState.currentIdx + 1} / ${total}</span>
    </div>
    <div class="quiz-question">${escapeHTML(q.question)}</div>
    <div class="quiz-options">${opts}</div>
    ${feedback}
  `;
}

function renderExamResult() {
  const total = examState.questions.length;
  const correct = examState.answers.filter(a => a.correct).length;
  const pct = total > 0 ? Math.round(correct * 100 / total) : 0;
  const wrongAnswers = examState.answers.filter(a => !a.correct);

  const wrongList = wrongAnswers.map(a => {
    const q = examState.questions.find(x => x.id === a.questionId);
    if (!q) return '';
    const correctLabel = q.correct_index === -1
      ? '送分（全選給分）'
      : `${'ABCD'[q.correct_index]}. ${escapeHTML(q.options[q.correct_index])}`;
    return `<li>
      <div class="result-wrong-cat">${escapeHTML(q._meta.year_label)} ${escapeHTML(q._meta.quarter)} · ${escapeHTML(q.category)} · 第 ${q._meta.number} 題</div>
      <div class="result-wrong-q">${escapeHTML(q.question)}</div>
      <div class="result-wrong-correct">正解：${correctLabel}</div>
    </li>`;
  }).join('');

  return `
    <div class="quiz-result">
      <div class="result-headline">
        <div class="result-pct">${pct}%</div>
        <div class="result-fraction">${correct} / ${total}</div>
      </div>
      ${wrongAnswers.length > 0 ? `
        <div class="quiz-section-label">答錯題目（${wrongAnswers.length}）</div>
        <ul class="result-wrong-list">${wrongList}</ul>
      ` : `<div class="quiz-section-label" style="color: var(--jade);">完美！全部答對</div>`}
      <div class="result-actions">
        <button class="btn-primary" data-exam-action="back-home">回考古題首頁</button>
      </div>
    </div>
  `;
}

function renderExam() {
  renderExamSyncBanner();
  const area = document.getElementById('examArea');

  if (!examLoaded) {
    area.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入考古題中⋯</div></div>`;
    return;
  }
  if (!examIndex) {
    area.innerHTML = `<div class="empty"><div class="empty-mark">!</div><div class="empty-text">考古題索引尚未產生<br><small style="color: var(--ink-dim);">請執行 scripts/extract_exam_archive.py</small></div></div>`;
    return;
  }

  switch (examState.view) {
    case 'paper-select': area.innerHTML = renderExamPaperSelect(); break;
    case 'paper-detail': area.innerHTML = renderExamPaperDetail(); break;
    case 'browse':       area.innerHTML = renderExamBrowse();      break;
    case 'play':
    case 'feedback':     area.innerHTML = renderExamPlay();        break;
    case 'result':       area.innerHTML = renderExamResult();      break;
    default:             area.innerHTML = renderExamHome();        break;
  }

  bindExamDelegates(area);
}

function bindExamDelegates(area) {
  if (area.dataset.examBound === '1') return;
  area.dataset.examBound = '1';

  area.addEventListener('click', async e => {
    // filter chips
    const filterBtn = e.target.closest('[data-exam-filter]');
    if (filterBtn) {
      const grp = filterBtn.dataset.examFilter;
      const v = filterBtn.dataset.val;
      examState.filter[grp] = (grp === 'count') ? parseInt(v, 10) : v;
      renderExam();
      return;
    }
    // paper card
    const paperCard = e.target.closest('.exam-paper-card');
    if (paperCard) {
      const path = paperCard.dataset.examPaper;
      examState.selectedPaperPath = path;
      examState.selectedPaperData = null;
      examState.view = 'paper-detail';
      renderExam();
      try {
        const data = await loadExamPaper(path);
        examState.selectedPaperData = data;
        renderExam();
      } catch (err) {
        alert('試卷載入失敗：' + err.message);
      }
      return;
    }
    // actions
    const actionBtn = e.target.closest('[data-exam-action]');
    if (!actionBtn) return;
    const act = actionBtn.dataset.examAction;

    if (act === 'goto-paper-select') {
      examState.view = 'paper-select';
      renderExam();
    } else if (act === 'back-home') {
      examState.view = 'home';
      renderExam();
    } else if (act === 'back-paper-select') {
      examState.view = 'paper-select';
      renderExam();
    } else if (act === 'back-paper-detail') {
      examState.view = 'paper-detail';
      renderExam();
    } else if (act === 'browse-paper') {
      examState.view = 'browse';
      renderExam();
      window.scrollTo(0, 0);
    } else if (act === 'start-paper') {
      const data = examState.selectedPaperData;
      if (!data) return;
      examState.questions = (data.questions || []).map(q => examQuestionToQuizFormat(data, q));
      examState.currentIdx = 0;
      examState.answers = [];
      examState.selectedIdx = null;
      examState.view = 'play';
      renderExam();
      window.scrollTo(0, 0);
    } else if (act === 'start-random') {
      const pool = await buildRandomPool();
      if (pool.length === 0) {
        alert('無符合條件題目，請放寬年度或主題。');
        return;
      }
      const n = Math.min(examState.filter.count, pool.length);
      examState.questions = shuffle(pool).slice(0, n);
      examState.currentIdx = 0;
      examState.answers = [];
      examState.selectedIdx = null;
      examState.view = 'play';
      renderExam();
      window.scrollTo(0, 0);
    } else if (act === 'select') {
      const idx = parseInt(actionBtn.dataset.opt, 10);
      const q = examState.questions[examState.currentIdx];
      // 送分 (correct_index === -1) → 一律 correct
      const correct = (q.correct_index === -1) || (idx === q.correct_index);
      examState.answers.push({ questionId: q.id, selectedIdx: idx, correct });
      examState.selectedIdx = idx;
      examState.view = 'feedback';
      recordExamAnswer(q, correct);
      renderExam();
    } else if (act === 'next') {
      if (examState.currentIdx + 1 >= examState.questions.length) {
        examState.view = 'result';
      } else {
        examState.currentIdx += 1;
        examState.selectedIdx = null;
        examState.view = 'play';
      }
      renderExam();
      window.scrollTo(0, 0);
    } else if (act === 'quit') {
      examState.view = 'home';
      renderExam();
    }
  });
}
