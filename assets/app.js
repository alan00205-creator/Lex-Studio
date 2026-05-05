// ============================================
// 承銷研究所
// 證券承銷相關法規、高業題庫、問答集、法規導航
// ============================================

const APP_VERSION = '0.1 版';
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
    dateEl.innerHTML = '問答集索引尚未產生 · 資料準備中';
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

// 中文日期格式（使用者顯示用）：YYYY年M月D日
function todayStrZh() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
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
              這通常是證期局站台對直連下載暫時擋下，或文件已下架。請點下方連結直接到證期局原站閱覽。</div>
            ${doc.source_url ? `<a class="btn-pdf-download" href="${escapeHTML(doc.source_url)}" target="_blank" rel="noopener noreferrer">
              前往證期局原站 ↗
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
      '<small style="color: var(--ink-dim);">資料就緒後此處將顯示 23 大類問答集，可瀏覽與全文搜尋</small>'
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

// ---- progress schema v2（PRD §9.5.4）----
// 設計原則：
//   - key 沿用 'underwriter_lex_quiz_progress'，避免使用者進度遺失
//   - 同時保留 stats.streak_days / stats.last_practice_date（讓現有首頁進度區仍能直接讀）
//     這兩個欄位由 streak.* 鏡像維護，不再是真相來源
//   - 同時保留 category_progress（中文鍵，現有首頁分類進度區用）
//     新增 category_mastery（六軸英文鍵，PRD §9.5.2 給雷達圖用）
//   - 舊版 v1 → v2 自動 migrate（loadProgress 中處理）
function defaultProgress() {
  return {
    version: 2,
    user_nickname: '',

    streak: {
      current_days: 0,
      longest_days: 0,
      this_month_days: 0,
      lifetime_days: 0,
      last_active_date: null,
      last_compensation_month: null,        // "YYYY-MM"，跨月時 reset compensation_used
      compensation_used_this_month: 0,
      compensation_remaining: 3,            // 每月最多 3 次補卡
    },

    stats: {
      total_answered: 0,
      total_correct: 0,
      questions_answered_today: 0,
      questions_today_date: null,           // "YYYY-MM-DD"，跨日時 reset questions_answered_today
      // legacy mirrors（給現有 renderProgress 直接讀；由 streak 同步）
      streak_days: 0,
      last_practice_date: null,
    },

    // 六軸熟練度（PRD §9.5.2）
    category_mastery: {
      issuance:     { answered: 0, correct: 0, mastery: 0 },
      governance:   { answered: 0, correct: 0, mastery: 0 },
      disclosure:   { answered: 0, correct: 0, mastery: 0 },
      tender_offer: { answered: 0, correct: 0, mastery: 0 },
      insider:      { answered: 0, correct: 0, mastery: 0 },
      asset_acq:    { answered: 0, correct: 0, mastery: 0 },
    },

    // legacy：中文鍵分類進度（首頁進度區仍用）
    category_progress: {},

    wrong_questions: [],

    // 每日紀錄：{ "YYYY-MM-DD": { completed, theme, correct } }
    daily_records: {},

    // legacy 旗標（與 daily_records 並存，避免破壞舊邏輯）
    daily_completed: {},

    // 徽章
    badges: {
      earned: [],                           // [{ id, earned_at }]
      progress: {},                         // { id: { current, target } }
      // 上次彈出通知條的徽章 id（避免重覆通知）
      notified: [],
    },
  };
}

// v1 → v2 in-place migration
function migrateProgressV1ToV2(p) {
  const def = defaultProgress();
  const out = { ...def, ...p };
  out.version = 2;

  // streak 從 stats.streak_days / stats.last_practice_date 拉出
  out.streak = { ...def.streak, ...(p.streak || {}) };
  if (p.stats) {
    if (typeof p.stats.streak_days === 'number') {
      out.streak.current_days = p.stats.streak_days;
      out.streak.longest_days = Math.max(out.streak.longest_days, p.stats.streak_days);
    }
    if (p.stats.last_practice_date) {
      out.streak.last_active_date = p.stats.last_practice_date;
    }
  }

  out.stats = { ...def.stats, ...(p.stats || {}) };
  // legacy mirror 對齊
  out.stats.streak_days = out.streak.current_days;
  out.stats.last_practice_date = out.streak.last_active_date;

  out.category_mastery = { ...def.category_mastery, ...(p.category_mastery || {}) };
  out.category_progress = p.category_progress || {};
  out.wrong_questions = p.wrong_questions || [];
  out.daily_records = p.daily_records || {};
  out.daily_completed = p.daily_completed || {};
  out.badges = { ...def.badges, ...(p.badges || {}) };
  out.badges.earned = out.badges.earned || [];
  out.badges.progress = out.badges.progress || {};
  out.badges.notified = out.badges.notified || [];
  out.user_nickname = p.user_nickname || '';
  return out;
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return defaultProgress();
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return defaultProgress();
    if (p.version === 2) {
      // 補齊任何後續新增欄位
      const def = defaultProgress();
      const out = { ...def, ...p };
      out.streak = { ...def.streak, ...(p.streak || {}) };
      out.stats = { ...def.stats, ...(p.stats || {}) };
      out.category_mastery = { ...def.category_mastery, ...(p.category_mastery || {}) };
      out.badges = { ...def.badges, ...(p.badges || {}) };
      out.badges.earned = out.badges.earned || [];
      out.badges.progress = out.badges.progress || {};
      out.badges.notified = out.badges.notified || [];
      out.wrong_questions = p.wrong_questions || [];
      out.category_progress = p.category_progress || {};
      out.daily_records = p.daily_records || {};
      out.daily_completed = p.daily_completed || {};
      return out;
    }
    if (p.version === 1) return migrateProgressV1ToV2(p);
    return defaultProgress();
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

// 記錄一次答題到 underwriter_lex_quiz_progress。
// opts.trackWrong:
//   true  (預設) 一般練習：答錯加進 wrong_questions、答對若已在錯題本則移除
//   false        daily 模式：完全不動 wrong_questions（避免錯題本被 daily 餵食）
// stats / streak / category_progress 一律更新（讓 daily 也計入累計與連續學習天數）
// ---- 中文 category → 六軸熟練度英文鍵的映射（PRD §9.5.2）----
// 政策：寬鬆映射，讓現有 200 題能合理填入六軸；無對應者落到最相近的軸或 disclosure（揭露為最廣的）
const CATEGORY_TO_AXIS = {
  'IPO募集發行':       'issuance',
  '證交法核心':        'issuance',          // 多為募集發行條文
  '上市櫃規範':        'issuance',
  '公司法':            'governance',
  '公司治理':          'governance',
  '內部控制':          'governance',
  '財報與IFRS':        'disclosure',
  '重大訊息與操縱':    'insider',
  '公開收購與庫藏股':  'tender_offer',
  '證券商管理':        'asset_acq',         // 證券商承銷處理 / 取得處分相關
  '其他':              'disclosure',
};

function categoryToAxis(cat) {
  return CATEGORY_TO_AXIS[cat] || 'disclosure';
}

// ---- streak / 補卡邏輯 ----
function monthKey(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : null;   // "YYYY-MM"
}

// 根據 last_active_date 與今日活動，更新 streak（含補卡邏輯）。
//   gapDays === 0   今日已活躍過 → 若今日處於補卡 pending，每答 1 題遞增進度，達標時延續 streak
//   gapDays === 1   昨日活躍，今日是連續 → current_days += 1
//   gapDays >= 2    斷了 → 若還有補卡額度，進入 compensation_pending（current_days 暫設 1）
//                            否則 current_days reset 為 1
// 注意：本函式由 recordAnswer 在 questions_answered_today 自加之後呼叫。
function tickStreakOnActivity(p) {
  const today = todayStr();
  const last = p.streak.last_active_date;

  // 跨月：reset compensation 與 this_month_days
  const curMonth = today.slice(0, 7);
  if (p.streak.last_compensation_month !== curMonth) {
    p.streak.last_compensation_month = curMonth;
    p.streak.compensation_used_this_month = 0;
    p.streak.compensation_remaining = 3;
    p.streak.this_month_days = 0;
  }

  if (last === today) {
    // 同日續答：若處於補卡 pending，遞增進度
    if (p.streak.compensation_pending) {
      const cp = p.streak.compensation_pending;
      cp.questions_done = (cp.questions_done || 0) + 1;
      if (cp.questions_done >= (cp.target || 2)) {
        // 補卡達成：把 streak 還原為「斷掉前的 streak + 1」
        p.streak.current_days = (cp.previous_streak || 0) + 1;
        if (p.streak.current_days > (p.streak.longest_days || 0)) {
          p.streak.longest_days = p.streak.current_days;
        }
        p.streak.compensation_used_this_month = (p.streak.compensation_used_this_month || 0) + 1;
        p.streak.compensation_remaining = Math.max(0, (p.streak.compensation_remaining || 0) - 1);
        delete p.streak.compensation_pending;
      }
    }
    return { gapDays: 0, became_active_today: false };
  }

  // 跨日（包含首次活躍 last === null）：計算 gap
  let gapDays = 999;
  if (last) {
    const a = new Date(last + 'T00:00:00');
    const b = new Date(today + 'T00:00:00');
    gapDays = Math.round((b - a) / 86400000);
  }

  if (gapDays === 1) {
    p.streak.current_days = (p.streak.current_days || 0) + 1;
  } else if (gapDays >= 2 && (p.streak.compensation_remaining || 0) > 0 && (p.streak.current_days || 0) > 0) {
    // 啟動補卡 pending：暫設 current_days = 1，紀錄之前 streak，等今日答滿 2 題時還原
    p.streak.compensation_pending = {
      previous_streak: p.streak.current_days || 0,
      questions_done: 1,             // 本次答題已算 1
      target: 2,
      started_date: today,
    };
    p.streak.current_days = 1;
  } else {
    // 真正斷了
    p.streak.current_days = 1;
    delete p.streak.compensation_pending;
  }

  p.streak.last_active_date = today;
  p.streak.this_month_days = (p.streak.this_month_days || 0) + 1;
  p.streak.lifetime_days = (p.streak.lifetime_days || 0) + 1;
  if (p.streak.current_days > (p.streak.longest_days || 0)) {
    p.streak.longest_days = p.streak.current_days;
  }
  return { gapDays, became_active_today: true };
}

function recordAnswer(question, correct, { trackWrong = true } = {}) {
  const p = loadProgress();
  p.stats.total_answered += 1;
  if (correct) p.stats.total_correct += 1;

  const today = todayStr();

  // 跨日 reset 今日答題數
  if (p.stats.questions_today_date !== today) {
    p.stats.questions_today_date = today;
    p.stats.questions_answered_today = 0;
  }
  p.stats.questions_answered_today += 1;

  // streak（含 this_month / lifetime / longest）
  tickStreakOnActivity(p);

  // legacy mirror（首頁進度區仍讀 stats.streak_days / last_practice_date）
  p.stats.streak_days = p.streak.current_days;
  p.stats.last_practice_date = p.streak.last_active_date;

  // daily_records
  if (!p.daily_records[today]) {
    p.daily_records[today] = { completed: false, theme: null, correct: false };
  }

  if (trackWrong) {
    const wrongIdx = p.wrong_questions.indexOf(question.id);
    if (correct) {
      if (wrongIdx >= 0) p.wrong_questions.splice(wrongIdx, 1);
    } else if (wrongIdx < 0) {
      p.wrong_questions.push(question.id);
    }
  }

  // legacy 中文鍵分類進度
  const cat = question.category || '其他';
  if (!p.category_progress[cat]) p.category_progress[cat] = { answered: 0, correct: 0 };
  p.category_progress[cat].answered += 1;
  if (correct) p.category_progress[cat].correct += 1;

  // v2 六軸熟練度
  const axis = categoryToAxis(cat);
  if (!p.category_mastery[axis]) p.category_mastery[axis] = { answered: 0, correct: 0, mastery: 0 };
  p.category_mastery[axis].answered += 1;
  if (correct) p.category_mastery[axis].correct += 1;
  p.category_mastery[axis].mastery = calculateMasteryFromRecord(p.category_mastery[axis]);

  // 徽章同步（靜默；通知條由 initHome / initProfile 觸發）
  if (typeof syncBadges === 'function') syncBadges(p);

  saveProgress(p);
}

// PRD §9.5.2 公式：accuracy × log10(total+1)/2 (cap at 1) × 100
function calculateMasteryFromRecord(rec) {
  if (!rec || !rec.answered) return 0;
  const accuracy = rec.correct / rec.answered;
  const volumeWeight = Math.min(Math.log10(rec.answered + 1) / 2, 1);
  return Math.round(accuracy * volumeWeight * 100);
}

function clearWrongQuestions() {
  const p = loadProgress();
  p.wrong_questions = [];
  saveProgress(p);
}

// ============================================
// 今日挑戰（daily challenge）：10 題、日期 seed、與一般練習進度分流
// ============================================

const DAILY_KEY = 'underwriter_lex_daily_challenge';
const DAILY_TARGET_COUNT = 10;

// Mulberry32：32-bit seeded PRNG（純函式；同 seed → 同序列；跨裝置一致）
function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 以 seed 驅動的 Fisher-Yates shuffle（不修改原陣列）
function seededShuffle(arr, seed) {
  const a = arr.slice();
  const rng = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================
// 每週題型輪播（PRD §9.2）
// 週一 IPO ／ 週二 SPO ／ 週三 公司治理 ／ 週四 內線交易
// 週五 主管機關最新函釋（fallback 全題庫，因尚無 regulation_update tag）
// 週六 錯題本 ／ 週日 資深考題（hard）
// ============================================

const WEEKLY_THEMES = {
  0: { tag: 'advanced',          title: '週日・資深挑戰',  short: '資深挑戰' },
  1: { tag: 'IPO',               title: '週一・IPO 情境',  short: 'IPO 情境' },
  2: { tag: 'SPO',               title: '週二・現增與 CB', short: '現增 / CB' },
  3: { tag: 'governance',        title: '週三・公司治理',  short: '公司治理' },
  4: { tag: 'insider',           title: '週四・內線交易',  short: '內線 / 重大訊息' },
  5: { tag: 'regulation_update', title: '週五・本月焦點',  short: '本月焦點' },
  6: { tag: 'wrong_review',      title: '週六・錯題複習',  short: '錯題複習' },
};

function themeOfDate(date) {
  const d = (date instanceof Date) ? date : new Date(date + 'T00:00:00');
  return WEEKLY_THEMES[d.getDay()] || WEEKLY_THEMES[1];
}

function todayTheme() {
  return themeOfDate(new Date());
}

function tomorrowTheme() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return themeOfDate(t);
}

// 依題目 category / difficulty / 文字內容推導 tags（PRD §9.3 規定 tags 為 v2.2 schema；
// 既有 200 題 quiz_extended.json 尚未標註 → 自動推導，未來可被 q.tags 顯式覆蓋）
function deriveQuestionTags(q) {
  if (Array.isArray(q.tags) && q.tags.length > 0) return q.tags;
  const tags = new Set();
  const cat = q.category || '';
  const diff = q.difficulty || 'medium';
  const stem = q.question || '';

  if (cat === 'IPO募集發行' || cat === '上市櫃規範') tags.add('IPO');
  if (cat === 'IPO募集發行') tags.add('SPO');
  if (cat === '公司治理' || cat === '內部控制') tags.add('governance');
  if (cat === '公司法') tags.add('governance');
  if (cat === '重大訊息與操縱') tags.add('insider');
  if (cat === '公開收購與庫藏股') tags.add('SPO');
  if (cat === '財報與IFRS') tags.add('governance');

  // 內容關鍵字補強
  if (/募集|公開發行|公開說明書|上市|興櫃|初次申請/.test(stem)) tags.add('IPO');
  if (/現金增資|私募|認股權|可轉換|公司債|庫藏股/.test(stem)) tags.add('SPO');
  if (/內線|重大消息|內部人持股/.test(stem)) tags.add('insider');
  if (/董事|監察人|獨立董事|薪酬委員會|審計委員會|公司治理/.test(stem)) tags.add('governance');

  if (diff === 'hard' || diff === 'advanced') tags.add('advanced');

  return Array.from(tags);
}

// 依 today's theme 過濾 pool，回傳排序後的候選
function poolByTheme(allPool, progress) {
  const theme = todayTheme();
  const tag = theme.tag;

  if (tag === 'wrong_review') {
    const wrongIds = new Set(progress.wrong_questions || []);
    const wrongOnes = allPool.filter(q => wrongIds.has(q.id));
    if (wrongOnes.length === 0) {
      // 沒錯題 → fallback advanced（用 set 推 hard 題）
      return { pool: allPool.filter(q => deriveQuestionTags(q).includes('advanced')), theme, fallback: true };
    }
    // 有錯題：直接給錯題池（少於 10 也照給，提供精準複習）
    return { pool: wrongOnes, theme, fallback: false };
  }

  if (tag === 'regulation_update') {
    // 尚無 regulation_update 標註 → fallback 全題庫（每月用 _added_at 較新者優先）
    const sorted = allPool.slice().sort((a, b) => (b._added_at || '').localeCompare(a._added_at || ''));
    return { pool: sorted, theme, fallback: true };
  }

  const filtered = allPool.filter(q => deriveQuestionTags(q).includes(tag));
  if (filtered.length >= 5) return { pool: filtered, theme, fallback: false };
  // 不足 5 題 → 退到全題庫
  return { pool: allPool, theme, fallback: true };
}

// daily progress: { date, answered: [{id, selectedIdx, correct}], completed, score }
// 換日（date mismatch）自動 reset
function loadDailyProgress() {
  const today = todayStr();
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.date === today) {
        return {
          date: today,
          answered: Array.isArray(p.answered) ? p.answered : [],
          completed: !!p.completed,
          score: typeof p.score === 'number' ? p.score : 0,
        };
      }
    }
  } catch (e) {
    console.error('[daily] loadDailyProgress 失敗：', e);
  }
  return { date: today, answered: [], completed: false, score: 0 };
}

function saveDailyProgress(p) {
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(p)); }
  catch (e) { console.error('[daily] saveDailyProgress 失敗：', e); }
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
    // PRD §9.3 v2.2：每題可帶 tags 陣列；若 JSON 未顯式給定，由 deriveQuestionTags() lazy 推導
    tags: Array.isArray(q.tags) ? q.tags : [],
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
  daily: createSession('daily'),    // 今日挑戰：10 題（日期 seed），與一般練習分流
};

function createSession(mode) {
  return {
    mode,                          // 'quiz' | 'daily'
    state: 'start',                // 'start' | 'playing' | 'feedback' | 'result'
    filter: { category: 'all', difficulty: 'all', count: 10 },
    questions: [],
    currentIdx: 0,
    answers: [],
    selectedIdx: null,
    reviewMode: false,             // 錯題本模式（僅 quiz mode 使用）
  };
}

// 從 localStorage 與當日 seeded 題目組裝 daily session 狀態（resume-aware）
// 回傳 true 表示成功；false 表示題庫尚未載入或為空
function setupDailySession() {
  if (!quizData) return false;
  const allPool = quizData.questions || [];
  if (allPool.length === 0) return false;

  // 依今日 theme 過濾候選池（PRD §9.2 每週題型輪播）
  const progress = loadProgress();
  const { pool: themedPool, theme } = poolByTheme(allPool, progress);
  const sourcePool = themedPool && themedPool.length > 0 ? themedPool : allPool;

  const dp = loadDailyProgress();
  // seed 加入 theme.tag，讓不同主題即使同日也能取到不同題序
  const seedKey = dp.date + ':' + (theme.tag || 'all');
  const dailyQuestions = (function() {
    if (sourcePool.length === 0) return [];
    const seed = hashString(seedKey);
    return seededShuffle(sourcePool, seed).slice(0, Math.min(DAILY_TARGET_COUNT, sourcePool.length));
  })();
  if (dailyQuestions.length === 0) return false;

  const sess = quizSessions.daily;
  sess.questions = dailyQuestions;
  // resume：從 daily progress 還原已答內容
  sess.answers = dp.answered.map(a => ({
    questionId: a.id,
    selectedIdx: typeof a.selectedIdx === 'number' ? a.selectedIdx : -1,
    correct: !!a.correct,
  }));
  sess.currentIdx = Math.min(sess.answers.length, sess.questions.length);
  sess.selectedIdx = null;
  sess.reviewMode = false;
  if (dp.completed || sess.currentIdx >= sess.questions.length) {
    sess.state = 'result';
  } else {
    sess.state = 'playing';
  }
  return true;
}

// 從首頁 CTA 進入 daily 挑戰：切到 quiz page、render daily mode
function enterDailyChallenge() {
  ensureQuizLoaded().then(() => {
    if (!setupDailySession()) {
      alert('題庫尚未就緒，請稍候再試。');
      return;
    }
    showQuizPage('daily');
  });
}

// 主動切換到題庫頁並 render 指定 mode（不經 goPage 的固定 mode 路由）
function showQuizPage(mode) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-quiz');
  if (target) target.classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === 'quiz'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === 'quiz'));
  window.scrollTo(0, 0);
  renderQuizPage(mode);
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
  if (mode === 'daily') {
    // daily key（resume 用）
    const dp = loadDailyProgress();
    dp.answered.push({ id: q.id, selectedIdx: idx, correct });
    saveDailyProgress(dp);
    // 同時計入累計 / 連續學習天數 / 分類進度，但不污染錯題本
    recordAnswer(q, correct, { trackWrong: false });
  } else {
    recordAnswer(q, correct);
  }
  renderQuizPage(mode);
}

function nextQuestion(mode) {
  const sess = quizSessions[mode];
  if (sess.currentIdx + 1 >= sess.questions.length) {
    sess.state = 'result';
    if (mode === 'daily') {
      // 完成：同步 completed + score 至 daily key
      const dp = loadDailyProgress();
      dp.completed = true;
      dp.score = sess.answers.filter(a => a.correct).length;
      saveDailyProgress(dp);
    }
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
  // 紀錄當前 mode 給 click delegate 動態讀取（quiz / daily 共用 #quizArea，
  // closure 裡寫死 mode 會在切換時拿到舊值）
  area.dataset.currentMode = mode;
  if (!quizLoaded) {
    area.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入題庫中⋯</div></div>`;
    return;
  }
  if (!quizData) {
    area.innerHTML = renderQaEmpty('!', `題庫載入失敗<br><small style="color: var(--ink-dim);">請確認 ${QUIZ_DATA_URL} 存在</small>`);
    return;
  }
  const sess = quizSessions[mode];
  // daily mode 沒有 start 篩選頁，最低狀態為 playing；保險：若是 'start' 視為 result
  if (mode === 'daily' && sess.state === 'start') sess.state = 'result';
  if (sess.state === 'start') area.innerHTML = renderQuizStart(mode);
  else if (sess.state === 'result') area.innerHTML = renderQuizResult(mode);
  else area.innerHTML = renderQuizPlay(mode);

  bindQuizDelegates(area);
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

  const isDaily = mode === 'daily';
  const quitLabel = isDaily ? '← 暫存進度，回首頁' : '← 結束練習';
  const headLabel = isDaily ? `<div class="daily-play-head">⌖ 今日挑戰 · ${escapeHTML(todayStrZh())}</div>` : '';

  return `
    <div class="quiz-play">
      <button class="back-link" data-action="quit">${quitLabel}</button>
      ${headLabel}
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

  const isDaily = mode === 'daily';
  const headBadge = isDaily
    ? `<div class="result-daily-badge">⌖ 今日挑戰 · ${escapeHTML(todayStrZh())} 完成</div>`
    : '';
  const actions = isDaily
    ? `
      <button class="btn-primary" data-action="back-home">回首頁查看總結</button>
      <div class="result-tomorrow">明日主題　${escapeHTML(tomorrowTheme().title)}</div>
    `
    : `
      <button class="btn-primary" data-action="restart">重新開始</button>
      ${wrongAnswers.length > 0 ? `<button class="btn-secondary" data-action="review">複習錯題本</button>` : ''}
    `;

  return `
    <div class="quiz-result">
      ${headBadge}
      <div class="result-headline">
        <div class="result-pct">${pct}%</div>
        <div class="result-fraction">${correct} / ${total}</div>
      </div>

      ${wrongAnswers.length > 0 ? `
        <div class="quiz-section-label">答錯題目（${wrongAnswers.length}）</div>
        <ul class="result-wrong-list">${wrongList}</ul>
      ` : `<div class="quiz-section-label" style="color: var(--jade);">完美！全部答對</div>`}

      <div class="result-actions">${actions}</div>
    </div>
  `;
}

function bindQuizDelegates(area) {
  if (area.dataset.qzBound === '1') return;
  area.dataset.qzBound = '1';

  area.addEventListener('click', e => {
    // 動態讀 mode（quiz / daily 共用 #quizArea；不能在 closure 裡寫死）
    const mode = area.dataset.currentMode || 'quiz';
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
      // daily 中途離開：暫存進度（已寫入 daily key）並回首頁
      if (mode === 'daily') {
        goPage('home');
      } else {
        sess.state = 'start';
        renderQuizPage(mode);
      }
    } else if (action === 'restart') restartSession(mode);
    else if (action === 'back-home') goPage('home');
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

// 取得當日 daily questions pool（套用每週題型輪播 + theme seed）
function getDailyQuestionsForToday() {
  if (!quizData) return { questions: [], theme: todayTheme() };
  const allPool = quizData.questions || [];
  if (allPool.length === 0) return { questions: [], theme: todayTheme() };
  const progress = loadProgress();
  const { pool: themedPool, theme } = poolByTheme(allPool, progress);
  const sourcePool = themedPool && themedPool.length > 0 ? themedPool : allPool;
  const today = todayStr();
  const seed = hashString(today + ':' + theme.tag);
  const picks = seededShuffle(sourcePool, seed).slice(0, Math.min(DAILY_TARGET_COUNT, sourcePool.length));
  return { questions: picks, theme };
}

// 今日挑戰首題（給首頁卡片預覽用）：回傳當日 10 題的第 1 題
function getDailyQuestion() {
  const { questions } = getDailyQuestionsForToday();
  return questions[0] || null;
}

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
  const today = todayStr();
  const { questions: dailyQuestions, theme } = getDailyQuestionsForToday();
  if (dailyQuestions.length === 0) {
    el.innerHTML = renderQaEmpty('⌖', '今日無題目可挑戰');
    return;
  }
  const dp = loadDailyProgress();
  const total = dailyQuestions.length;
  const answered = Math.min(dp.answered.length, total);
  const completed = dp.completed || answered >= total;

  // 進度 dots：已答用 correct / wrong；剩餘空 dot
  const dots = dailyQuestions.map((_, i) => {
    const a = dp.answered[i];
    let cls = 'dot';
    if (a) cls += a.correct ? ' correct' : ' wrong';
    return `<span class="${cls}"></span>`;
  }).join('');

  if (completed) {
    el.innerHTML = renderDailySummaryCard(dp, total, theme);
    return;
  }

  const ctaLabel = answered === 0
    ? `開始今日挑戰（${total} 題）`
    : `繼續挑戰（第 ${answered + 1} / ${total} 題）`;
  const preview = dailyQuestions[answered] || dailyQuestions[0];

  el.innerHTML = `
    <div class="daily-card">
      <div class="daily-label">
        ⌖ 今日挑戰 · ${escapeHTML(todayStrZh())}
        <span class="daily-theme-badge">${escapeHTML(theme.short)}</span>
      </div>
      <div class="daily-headline">${escapeHTML(theme.title)}</div>
      <div class="daily-progress-line">
        <span class="daily-progress-text">${answered} / ${total}</span>
        <span class="quiz-progress-dots">${dots}</span>
      </div>
      <div class="daily-preview">
        <span class="quiz-meta-cat">${escapeHTML(preview.category)}</span>
        <span class="quiz-meta-diff">${escapeHTML(preview.difficulty)}</span>
        <span class="daily-preview-hint">${answered === 0 ? '首題預覽' : '下一題'}</span>
      </div>
      <button class="btn-primary daily-cta" data-action="enter-daily">${ctaLabel}</button>
    </div>
  `;

  bindDailyDelegates(el);
}

// 完成今日挑戰後的「今日總結卡」（PRD §9.4）
//   - 今日題目主題
//   - 答對 / 答錯
//   - 連續精進天數變化
//   - 明日主題預告
//   - 雷達圖更新提示（最高熟練度軸 + 變化）
function renderDailySummaryCard(dp, total, theme) {
  const score = typeof dp.score === 'number' && dp.score > 0 ? dp.score
              : dp.answered.filter(a => a.correct).length;
  const pct = Math.round(score * 100 / total);
  const wrong = total - score;
  const tomorrow = tomorrowTheme();
  const p = loadProgress();
  const streak = p.streak.current_days || 0;

  // 雷達圖最近熱點：找出今日各 axis 進步最大者
  // 簡化：計算今日這 10 題的各 axis 分布，提示最常觸及的 axis
  const axisCount = {};
  dp.answered.forEach(a => {
    const q = questionById(a.id);
    if (!q) return;
    const ax = categoryToAxis(q.category);
    axisCount[ax] = (axisCount[ax] || 0) + 1;
  });
  const topAxisKey = Object.entries(axisCount).sort((a, b) => b[1] - a[1])[0];
  const topAxisLabel = topAxisKey ? (MASTERY_AXES.find(x => x.key === topAxisKey[0]) || {}).label : '';
  const topAxisMastery = topAxisKey ? ((p.category_mastery[topAxisKey[0]] || {}).mastery || 0) : 0;

  return `
    <div class="daily-summary">
      <div class="daily-summary-head">⌖ 今日挑戰 · ${escapeHTML(todayStrZh())} 完成</div>
      <div class="daily-summary-theme">${escapeHTML(theme.title)}</div>
      <div class="daily-summary-grid">
        <div class="daily-summary-cell">
          <div class="daily-summary-cell-num">${pct}%</div>
          <div class="daily-summary-cell-label">正確率</div>
        </div>
        <div class="daily-summary-cell">
          <div class="daily-summary-cell-num">${score} / ${total}</div>
          <div class="daily-summary-cell-label">答對 / 總題</div>
        </div>
        <div class="daily-summary-cell">
          <div class="daily-summary-cell-num">${streak}</div>
          <div class="daily-summary-cell-label">連續精進</div>
        </div>
        <div class="daily-summary-cell">
          <div class="daily-summary-cell-num">${wrong}</div>
          <div class="daily-summary-cell-label">答錯題數</div>
        </div>
      </div>
      ${topAxisLabel ? `
        <div class="daily-summary-mastery">
          熟練度更新：<strong>${escapeHTML(topAxisLabel)}</strong> 目前 ${topAxisMastery}%
        </div>
      ` : ''}
      <div class="daily-summary-tomorrow">
        <span class="daily-summary-tomorrow-label">明日主題</span>
        <span class="daily-summary-tomorrow-theme">${escapeHTML(tomorrow.title)}</span>
      </div>
    </div>
  `;
}

function bindDailyDelegates(el) {
  if (el.dataset.dailyBound === '1') return;
  el.dataset.dailyBound = '1';
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-action="enter-daily"]');
    if (!t) return;
    enterDailyChallenge();
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
  if (typeof processBadgeNotifications === 'function') processBadgeNotifications();
  renderDailyChallenge();
  renderProgress();
}

// ============================================
// 個人儀表板（PRD §9.5）
// 三大區塊：連續精進天數 / 熟練度雷達 / 徽章
// 視覺紅線：不得使用 emoji、🔥、Combo、連勝等遊戲化字眼（PRD §12.3）
// ============================================

// 六軸定義（順序即雷達順時針排列；起點正上方）
const MASTERY_AXES = [
  { key: 'issuance',     label: '募集發行',   subtitle: 'Issuance',           law_id: 'A04' },
  { key: 'governance',   label: '公司治理',   subtitle: 'Governance',         law_id: 'A11' },
  { key: 'disclosure',   label: '財務揭露',   subtitle: 'Disclosure',         law_id: 'A22' },
  { key: 'tender_offer', label: '公開收購',   subtitle: 'Tender Offer',       law_id: 'A24' },
  { key: 'insider',      label: '內線交易',   subtitle: 'Insider',            law_id: 'A29' },
  { key: 'asset_acq',    label: '取得處分',   subtitle: 'Asset Acquisition',  law_id: 'A13' },
];

// 軸 → 該軸對應分類在 quiz 池裡的最佳跳轉 category（中文）
// 用於點擊雷達軸時自動跳到題庫並套用 category filter
const AXIS_TO_QUIZ_CATEGORY = {
  issuance:     'IPO募集發行',
  governance:   '公司治理',
  disclosure:   '財報與IFRS',
  tender_offer: '公開收購與庫藏股',
  insider:      '重大訊息與操縱',
  asset_acq:    '證券商管理',
};

// 各軸最近相關修法日（PRD §9.5.2 "公開收購 62%｜2025-03-15 修正"）
// TODO: law_index.json 加入 last_amendment_date 欄位後改為動態抓取
// 目前先以維護人手動標註的代表性日期填入；空字串表示未標註
const AXIS_AMENDMENT_DATES = {
  issuance:     '2025-06-18',
  governance:   '2024-11-20',
  disclosure:   '2025-03-12',
  tender_offer: '2025-03-15',
  insider:      '2025-09-01',
  asset_acq:    '2024-08-30',
};

// 徽章定義（PRD §9.5.2 區塊三：MVP 6 個）
const BADGE_DEFS = [
  { id: 'init',              name: '初心',     latin: 'Initium',                  desc: '連續學習 7 日',          target: 7 },
  { id: 'diligent',          name: '勤學',     latin: 'Diligentia',               desc: '連續學習 30 日',         target: 30 },
  { id: 'centum',            name: '百日精進', latin: 'Centum Dies',              desc: '累計學習 100 日',        target: 100 },
  { id: 'issuance_master',   name: '募集精通', latin: 'Magister Emissionis',      desc: '募集發行熟練度 ≥ 80%',   target: 80 },
  { id: 'governance_master', name: '治理精通', latin: 'Magister Gubernationis',   desc: '公司治理熟練度 ≥ 80%',   target: 80 },
  { id: 'centuria',          name: '百題達人', latin: 'Centuria',                 desc: '累計答題 100 題',        target: 100 },
];

// 計算每個徽章當前進度與是否達成
function evaluateBadges(p) {
  const out = {};
  out.init             = { current: p.streak.current_days || 0,  target: 7 };
  out.diligent         = { current: p.streak.current_days || 0,  target: 30 };
  out.centum           = { current: p.streak.lifetime_days || 0, target: 100 };
  out.issuance_master  = { current: (p.category_mastery.issuance   || {}).mastery || 0, target: 80 };
  out.governance_master= { current: (p.category_mastery.governance || {}).mastery || 0, target: 80 };
  out.centuria         = { current: p.stats.total_answered || 0,  target: 100 };
  return out;
}

// 同步 badges：earned/progress；新解鎖者寫進 notified queue 等待頁面顯示通知
function syncBadges(p) {
  const eval_ = evaluateBadges(p);
  const earnedIds = new Set((p.badges.earned || []).map(b => b.id));
  const today = todayStr();
  const newlyEarned = [];
  for (const def of BADGE_DEFS) {
    const e = eval_[def.id];
    if (!e) continue;
    p.badges.progress[def.id] = { current: e.current, target: e.target };
    if (!earnedIds.has(def.id) && e.current >= e.target) {
      p.badges.earned.push({ id: def.id, earned_at: today });
      newlyEarned.push(def.id);
    }
  }
  return newlyEarned;
}

// ---- Streak 區塊 ----
function renderStreakBlock() {
  const el = document.getElementById('streakBlock');
  if (!el) return;
  const p = loadProgress();
  // 進入頁面時 reset 月度補卡額度（如跨月）
  const today = todayStr();
  const curMonth = today.slice(0, 7);
  if (p.streak.last_compensation_month !== curMonth) {
    p.streak.last_compensation_month = curMonth;
    p.streak.compensation_used_this_month = 0;
    p.streak.compensation_remaining = 3;
    saveProgress(p);
  }

  const last = p.streak.last_active_date;
  const gapDays = last
    ? Math.round((new Date(today + 'T00:00:00') - new Date(last + 'T00:00:00')) / 86400000)
    : null;

  // 補卡面板的三個狀態：
  //   1. 進行中（compensation_pending 存在且未達標）
  //   2. 剛完成（compensation_pending 已被刪、且本日 streak 是補回來的）→ 由 daily_records 推斷不易，僅在「進行中」狀態顯示
  //   3. 機會視窗：使用者尚未答題、但離上次活躍剛好 2 天且還有額度
  let compensationPanel = '';
  const cp = p.streak.compensation_pending;
  if (cp && cp.started_date === today) {
    const todoLeft = Math.max(0, (cp.target || 2) - (cp.questions_done || 0));
    compensationPanel = `
      <div class="streak-compensation">
        <div class="streak-compensation-head">昨日中斷</div>
        <div class="streak-compensation-body">再完成 <strong>${todoLeft}</strong> 題即可延續連續精進天數。</div>
        <div class="streak-compensation-meta">本月剩餘補卡 ${p.streak.compensation_remaining} 次</div>
      </div>
    `;
  } else if (gapDays === 2 && p.streak.compensation_remaining > 0 && p.stats.questions_answered_today === 0) {
    // 機會視窗：今日尚未答題，但若答 2 題即可補卡
    compensationPanel = `
      <div class="streak-compensation">
        <div class="streak-compensation-head">昨日中斷</div>
        <div class="streak-compensation-body">今日完成 <strong>2</strong> 題即可延續連續精進天數。</div>
        <div class="streak-compensation-meta">本月剩餘補卡 ${p.streak.compensation_remaining} 次</div>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="streak-hero">
      <div class="streak-num">${p.streak.current_days || 0}</div>
      <div class="streak-unit">日</div>
    </div>
    <div class="streak-caption">連續精進</div>
    <div class="streak-meta">
      <span>本月 ${p.streak.this_month_days || 0} 日</span>
      <span class="streak-meta-sep">·</span>
      <span>累計 ${p.streak.lifetime_days || 0} 日</span>
      <span class="streak-meta-sep">·</span>
      <span>最長 ${p.streak.longest_days || 0} 日</span>
    </div>
    ${compensationPanel}
  `;
}

// ---- 雷達圖（六軸 SVG，無外部相依）----
function renderRadarChart(masteryByAxis) {
  const SIZE = 280;
  const CX = SIZE / 2;
  const CY = SIZE / 2 + 8;       // 為頂部標籤留空間
  const R_MAX = 90;
  const N = MASTERY_AXES.length;

  // 軸座標（從正上方順時針）
  const axisPoint = (i, ratio) => {
    const angle = -Math.PI / 2 + i * (2 * Math.PI / N);
    return [CX + R_MAX * ratio * Math.cos(angle), CY + R_MAX * ratio * Math.sin(angle)];
  };

  // 同心五邊（20% / 40% / 60% / 80% / 100%）
  const grid = [0.2, 0.4, 0.6, 0.8, 1.0].map(r => {
    const pts = [];
    for (let i = 0; i < N; i++) pts.push(axisPoint(i, r));
    return `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--line)" stroke-width="1" />`;
  }).join('');

  // 軸線
  const axes = MASTERY_AXES.map((_, i) => {
    const [x, y] = axisPoint(i, 1);
    return `<line x1="${CX}" y1="${CY}" x2="${x}" y2="${y}" stroke="var(--line-strong)" stroke-width="0.5" />`;
  }).join('');

  // 資料多邊
  const dataPoints = MASTERY_AXES.map((axis, i) => {
    const m = (masteryByAxis[axis.key] || 0) / 100;
    return axisPoint(i, m);
  });
  const polygon = `<polygon points="${dataPoints.map(p => p.join(',')).join(' ')}" fill="rgba(30, 58, 95, 0.15)" stroke="var(--primary)" stroke-width="1.5" stroke-linejoin="round" />`;
  const dots = dataPoints.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--primary)" />`).join('');

  // 軸標籤（含分數）
  const labels = MASTERY_AXES.map((axis, i) => {
    const [x, y] = axisPoint(i, 1.18);
    const m = masteryByAxis[axis.key] || 0;
    const angle = -Math.PI / 2 + i * (2 * Math.PI / N);
    let anchor = 'middle';
    if (Math.cos(angle) > 0.3) anchor = 'start';
    else if (Math.cos(angle) < -0.3) anchor = 'end';
    return `
      <g class="radar-label" data-axis="${axis.key}">
        <text x="${x}" y="${y - 4}" text-anchor="${anchor}" class="radar-label-name">${axis.label}</text>
        <text x="${x}" y="${y + 10}" text-anchor="${anchor}" class="radar-label-score">${m}%</text>
      </g>
    `;
  }).join('');

  return `
    <svg class="radar-svg" viewBox="0 0 ${SIZE} ${SIZE + 32}" preserveAspectRatio="xMidYMid meet" aria-label="熟練度六軸雷達圖">
      ${grid}
      ${axes}
      ${polygon}
      ${dots}
      ${labels}
    </svg>
  `;
}

function renderMasteryBlock() {
  const el = document.getElementById('masteryArea');
  if (!el) return;
  const p = loadProgress();
  // 確保 mastery 數值是最新（保險：歷史紀錄如果沒 .mastery 也補上）
  const masteryByAxis = {};
  for (const axis of MASTERY_AXES) {
    const rec = p.category_mastery[axis.key] || { answered: 0, correct: 0, mastery: 0 };
    masteryByAxis[axis.key] = rec.mastery || calculateMasteryFromRecord(rec);
  }
  const totalAnswered = MASTERY_AXES.reduce((sum, ax) => {
    return sum + ((p.category_mastery[ax.key] || {}).answered || 0);
  }, 0);

  const rows = MASTERY_AXES.map(axis => {
    const rec = p.category_mastery[axis.key] || { answered: 0, correct: 0, mastery: 0 };
    const m = masteryByAxis[axis.key];
    const amend = AXIS_AMENDMENT_DATES[axis.key] || '';
    const amendStr = amend ? `${amend.replace(/-/g, '.')} 修正` : '尚未標註';
    return `
      <li class="mastery-row" data-axis="${axis.key}">
        <span class="mastery-row-label">${axis.label}</span>
        <span class="mastery-row-score">${m}%</span>
        <span class="mastery-row-meta">${escapeHTML(amendStr)}｜${rec.answered} 題</span>
      </li>
    `;
  }).join('');

  if (totalAnswered === 0) {
    el.innerHTML = `
      <div class="mastery-empty">
        ${renderRadarChart(masteryByAxis)}
        <div class="mastery-empty-hint">尚無答題資料。完成題庫或今日挑戰後，雷達圖將顯示各分類熟練度。</div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    ${renderRadarChart(masteryByAxis)}
    <ul class="mastery-list">${rows}</ul>
    <div class="mastery-hint">點擊任一分類可跳至題庫對應練習</div>
  `;

  // 點擊軸 / 分類列 → 跳到題庫，套用 category filter
  el.querySelectorAll('[data-axis]').forEach(node => {
    node.addEventListener('click', () => {
      const axis = node.getAttribute('data-axis');
      const cat = AXIS_TO_QUIZ_CATEGORY[axis];
      if (cat && quizSessions && quizSessions.quiz) {
        quizSessions.quiz.filter.category = cat;
        quizSessions.quiz.state = 'start';
      }
      goPage('quiz');
    });
  });
}

// ---- 徽章 SVG（圓框 + 月桂葉 + 中央拉丁／中文名）----
function renderBadgeSvg(def, earned) {
  const W = 96;
  const goldOuter = earned ? 'var(--gold)' : 'var(--line-strong)';
  const goldInner = earned ? 'var(--gold-soft)' : 'var(--line)';
  const ink       = earned ? 'var(--ink)' : 'var(--ink-dim)';
  const fillBg    = earned ? 'var(--bg-soft)' : '#f7f6f1';
  const opacity   = earned ? '1' : '0.55';
  // 月桂葉：兩側對稱，由若干小橢圓組成（手繪感）
  const laurelLeaf = (cx, cy, rotate, mirror) => {
    const transform = `rotate(${rotate} ${cx} ${cy})${mirror ? ` scale(-1 1) translate(${-2*cx} 0)` : ''}`;
    return `<ellipse cx="${cx}" cy="${cy}" rx="3.2" ry="1.4" fill="none" stroke="${goldOuter}" stroke-width="0.8" transform="${transform}"/>`;
  };
  const laurelL = [];
  const laurelR = [];
  for (let i = 0; i < 5; i++) {
    const yOffset = -16 + i * 8;
    laurelL.push(laurelLeaf(W/2 - 32, W/2 + yOffset, -30, false));
    laurelR.push(laurelLeaf(W/2 + 32, W/2 + yOffset, 30, true));
  }
  // 拉丁文若超過 12 字元，採兩行顯示
  const latinFontSize = def.latin.length > 12 ? 8 : 10;
  return `
    <svg class="badge-svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" aria-label="${escapeHTML(def.name)}" style="opacity:${opacity}">
      <circle cx="${W/2}" cy="${W/2}" r="42" fill="${fillBg}" stroke="${goldOuter}" stroke-width="2"/>
      <circle cx="${W/2}" cy="${W/2}" r="36" fill="none"      stroke="${goldInner}" stroke-width="0.8" stroke-dasharray="2 1.5"/>
      ${laurelL.join('')}
      ${laurelR.join('')}
      <text x="${W/2}" y="${W/2 + 4}" text-anchor="middle" font-family="var(--display)" font-style="italic" font-weight="500" font-size="${latinFontSize}" fill="${ink}" letter-spacing="0.04em">${escapeHTML(def.latin)}</text>
    </svg>
  `;
}

function renderBadgesBlock() {
  const el = document.getElementById('badgesArea');
  if (!el) return;
  const p = loadProgress();
  const earnedIds = new Set((p.badges.earned || []).map(b => b.id));
  const earnedAtMap = Object.fromEntries((p.badges.earned || []).map(b => [b.id, b.earned_at]));

  const cards = BADGE_DEFS.map(def => {
    const earned = earnedIds.has(def.id);
    const prog = p.badges.progress[def.id] || { current: 0, target: def.target };
    const pct = Math.min(100, Math.round((prog.current / prog.target) * 100));
    const earnedAt = earnedAtMap[def.id];
    return `
      <li class="badge-card ${earned ? 'earned' : 'locked'}">
        ${renderBadgeSvg(def, earned)}
        <div class="badge-card-body">
          <div class="badge-card-name">${escapeHTML(def.name)}</div>
          <div class="badge-card-latin">${escapeHTML(def.latin)}</div>
          <div class="badge-card-desc">${escapeHTML(def.desc)}</div>
          ${earned
            ? `<div class="badge-card-earned">${escapeHTML(earnedAt || '')} 獲得</div>`
            : `<div class="badge-card-progress">
                 <div class="badge-progress-bar"><div class="badge-progress-fill" style="width:${pct}%"></div></div>
                 <div class="badge-progress-text">${prog.current} / ${prog.target}</div>
               </div>`
          }
        </div>
      </li>
    `;
  }).join('');

  el.innerHTML = `<ul class="badges-list">${cards}</ul>`;
}

// ---- 徽章解鎖通知條（PRD §9.5.2 區塊三：不彈窗）----
function showBadgeToast(badgeId) {
  const def = BADGE_DEFS.find(d => d.id === badgeId);
  if (!def) return;
  const el = document.getElementById('badgeToast');
  if (!el) return;
  el.innerHTML = `
    <span class="badge-toast-mark">⌖</span>
    <span class="badge-toast-text">獲得徽章：${escapeHTML(def.name)}</span>
    <span class="badge-toast-latin">${escapeHTML(def.latin)}</span>
  `;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(showBadgeToast._t);
  showBadgeToast._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 400);
  }, 4200);
}

// 處理新解鎖徽章：寫到 notified 並逐一通知（多個解鎖排隊播放）
function processBadgeNotifications() {
  const p = loadProgress();
  const newly = syncBadges(p);
  saveProgress(p);
  // 過濾出未通知過的
  const toNotify = newly.filter(id => !p.badges.notified.includes(id));
  if (toNotify.length === 0) return;
  // 依序播放（每個 4.6 秒間隔）
  toNotify.forEach((id, idx) => {
    setTimeout(() => showBadgeToast(id), idx * 4600);
  });
  p.badges.notified = (p.badges.notified || []).concat(toNotify);
  saveProgress(p);
}

async function initProfile() {
  await ensureQuizLoaded();
  // 進入個人頁面時：同步徽章狀態 + 觸發新解鎖通知
  processBadgeNotifications();
  renderStreakBlock();
  renderMasteryBlock();
  renderBadgesBlock();
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
  if (name === 'profile') initProfile();
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
// 高業考古題（證券商高級業務員歷屆試題）
// PRD: data/exam_archive/index.json + 各卷 JSON
// ============================================

const EXAM_INDEX_URL = './data/exam_archive/index.json';
const EXAM_PROGRESS_KEY = 'underwriter_lex_exam_progress';

let examIndex = null;
let examLoaded = false;
let examLoadStarted = false;
let examPapersCache = {};   // json_path → loaded paper

// State machine for 高業考古題
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
      <button class="back-link" data-exam-action="back-home">← 回高業考古題首頁</button>
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
    <button class="back-link" data-exam-action="back-home">← 回高業考古題首頁</button>
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
        <button class="btn-primary" data-exam-action="back-home">回高業考古題首頁</button>
      </div>
    </div>
  `;
}

function renderExam() {
  renderExamSyncBanner();
  const area = document.getElementById('examArea');

  if (!examLoaded) {
    area.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入高業考古題中⋯</div></div>`;
    return;
  }
  if (!examIndex) {
    area.innerHTML = `<div class="empty"><div class="empty-mark">!</div><div class="empty-text">高業考古題索引尚未產生<br><small style="color: var(--ink-dim);">資料準備中</small></div></div>`;
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
