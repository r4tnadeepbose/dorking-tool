(function () {
  'use strict';

  const DATA = window.DT_DATA;
  const STORE_KEY = 'dt_v2_state';
  const HISTORY_KEY = 'dt_v2_history';
  const SETTINGS_KEY = 'dt_v2_settings';

  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const nowIso = () => new Date().toISOString();
  const esc = (s) => String(s == null ? '' : s);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function safeText(el, text) { if (el) el.textContent = text == null ? '' : String(text); }
  function clearEl(el) { if (!el) return; while (el.firstChild) el.removeChild(el.firstChild); }

  function toast(msg, type = 'ok', ms = 3200) {
    const c = $('#toast-container');
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'warn' ? 'warn' : type === 'err' ? 'err' : 'ok');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, ms);
  }

  function confirmDialog(title, body, okLabel = 'Confirm', danger = false) {
    return new Promise(resolve => {
      const root = $('#modal-root');
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      const modal = document.createElement('div');
      modal.className = 'modal';
      const h = document.createElement('h3'); h.textContent = title; modal.appendChild(h);
      const p = document.createElement('div'); p.className = 'desc'; p.textContent = body; modal.appendChild(p);
      const actions = document.createElement('div'); actions.className = 'actions mt12';
      const cancel = document.createElement('button'); cancel.className = 'secondary'; cancel.textContent = 'Cancel';
      const ok = document.createElement('button'); ok.textContent = okLabel; if (danger) ok.className = 'danger';
      cancel.addEventListener('click', () => { root.removeChild(wrap); resolve(false); });
      ok.addEventListener('click', () => { root.removeChild(wrap); resolve(true); });
      actions.appendChild(cancel); actions.appendChild(ok); modal.appendChild(actions);
      wrap.appendChild(modal);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) { root.removeChild(wrap); resolve(false); } });
      root.appendChild(wrap);
      ok.focus();
    });
  }

  function modalForm(title, buildFn) {
    return new Promise(resolve => {
      const root = $('#modal-root');
      const wrap = document.createElement('div'); wrap.className = 'modal-backdrop';
      const modal = document.createElement('div'); modal.className = 'modal';
      const h = document.createElement('h3'); h.textContent = title; modal.appendChild(h);
      const body = document.createElement('div'); modal.appendChild(body);
      const actions = document.createElement('div'); actions.className = 'actions mt12';
      const cancel = document.createElement('button'); cancel.className = 'secondary'; cancel.textContent = 'Cancel';
      const ok = document.createElement('button'); ok.textContent = 'Save';
      actions.appendChild(cancel); actions.appendChild(ok); modal.appendChild(actions);
      const api = { body, close: (v) => { root.removeChild(wrap); resolve(v); }, ok, cancel };
      buildFn(api);
      cancel.addEventListener('click', () => api.close(null));
      wrap.addEventListener('click', (e) => { if (e.target === wrap) api.close(null); });
      wrap.appendChild(modal); root.appendChild(wrap);
    });
  }

  function downloadFile(name, content, type = 'text/plain') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); resolve();
      } catch (e) { reject(e); }
    });
  }

  function safeHref(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    } catch (_) {}
    return null;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  // ---------- Validation & normalization ----------
  // Basic domain/hostname validation (permissive but safe)
  const domainRe = /^(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

  function normalizeTargetInput(raw, scope) {
    const input = String(raw || '').trim();
    if (!input) return { ok: false, error: 'Target is required.' };
    if (/^\s*javascript:/i.test(input)) return { ok: false, error: 'Unsafe URL scheme is not allowed.' };
    let s = input;
    // remove scheme
    s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
    // remove credentials if any
    s = s.replace(/^[^@\/]+@/, '');
    // cut path/query/fragment/port
    s = s.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
    s = s.trim().toLowerCase();
    if (!s) return { ok: false, error: 'Could not extract a valid hostname/domain from input.' };
    if (s.includes('..')) return { ok: false, error: 'Invalid hostname.' };
    if (!domainRe.test(s)) return { ok: false, error: 'Invalid domain/hostname format.' };
    // scope handling
    let target = s;
    let scopeLabel = 'Exact hostname';
    if (scope === 'root') {
      target = toRootDomain(s);
      scopeLabel = 'Root domain';
    } else if (scope === 'root_sub') {
      target = toRootDomain(s);
      scopeLabel = 'Root domain and subdomains';
    } else if (scope === 'exact') {
      target = s.replace(/^\*\./, '');
      scopeLabel = 'Exact hostname';
    } else if (scope === 'custom') {
      scopeLabel = 'Custom scope';
    }
    if (!domainRe.test(target)) return { ok: false, error: 'Normalized target is invalid.' };
    return { ok: true, input, normalized: target, scope, scopeLabel, display: scope === 'root_sub' ? target + ' (+ subdomains)' : target };
  }

  function toRootDomain(host) {
    let h = host.replace(/^\*\./, '');
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    // naive eTLD handling for common multi-part TLDs
    const multi = ['co.uk','org.uk','ac.uk','gov.uk','com.au','net.au','org.au','co.jp','co.nz','com.br','com.mx','co.in'];
    const last2 = parts.slice(-2).join('.');
    const last3 = parts.slice(-3).join('.');
    if (multi.includes(last2) && parts.length >= 3) return parts.slice(-3).join('.');
    if (multi.includes(last3) && parts.length >= 4) return parts.slice(-4).join('.');
    return parts.slice(-2).join('.');
  }

  // ---------- Query engine ----------
  function applyTemplate(template, vars) {
    return String(template || '').replace(/\{(target|keyword|extension|subdomain|path|date_from|date_to)\}/g, (_, k) => vars[k] != null ? String(vars[k]) : '{'+k+'}');
  }

  function normalizeQuery(q) {
    return String(q || '').replace(/\s+/g, ' ').trim();
  }

  function detectOperators(query) {
    const ops = [];
    const map = [
      ['site:', /\bsite:/i], ['inurl:', /\binurl:/i], ['allinurl:', /\ballinurl:/i],
      ['intitle:', /\bintitle:/i], ['allintitle:', /\ballintitle:/i],
      ['intext:', /\bintext:/i], ['allintext:', /\ballintext:/i],
      ['filetype:', /\bfiletype:/i], ['ext:', /\bext:/i], ['cache:', /\bcache:/i],
      ['after:', /\bafter:/i], ['before:', /\bbefore:/i], ['""', /"[^"]+"/], ['OR', /\bOR\b|\|/], ['-', /(?:^|\s)-\S/], ['()', /[()]/], ['*', /\*/]
    ];
    map.forEach(([name, re]) => { if (re.test(query)) ops.push(name); });
    return ops;
  }

  function validateQuerySyntax(query, isGlobal) {
    const q = normalizeQuery(query);
    if (!q) return { ok: false, error: 'Query is empty.' };
    if (/\{(target|keyword|extension|subdomain|path|date_from|date_to)\}/.test(q)) return { ok: false, error: 'Unresolved template placeholder remains.' };
    // balanced quotes/parens basic check
    const quotes = (q.match(/"/g) || []).length;
    if (quotes % 2 !== 0) return { ok: false, error: 'Unbalanced double quotes.' };
    let depth = 0;
    for (const ch of q) { if (ch === '(') depth++; if (ch === ')') depth--; if (depth < 0) return { ok: false, error: 'Unbalanced parentheses.' }; }
    if (depth !== 0) return { ok: false, error: 'Unbalanced parentheses.' };
    if (/\bjavascript:/i.test(q)) return { ok: false, error: 'Unsafe token detected.' };
    if (!isGlobal && !/\bsite:/i.test(q) && !/\bcache:/i.test(q)) {
      // allow target-scoped by content in some cases, but warn-level; keep as ok
    }
    return { ok: true };
  }

  function engineUrl(engineId, query) {
    const settings = getSettings();
    let tmpl = null;
    if (engineId === 'custom' && settings.customEngineUrl) tmpl = settings.customEngineUrl;
    else {
      const e = DATA.ENGINES.find(x => x.id === engineId) || DATA.ENGINES[0];
      tmpl = e.url;
    }
    const enc = encodeURIComponent(query);
    if (tmpl.includes('{query}')) return tmpl.replace('{query}', enc);
    // fallback append
    const sep = tmpl.includes('?') ? '&' : '?';
    return tmpl + sep + 'q=' + enc;
  }

  function explainQuery(query) {
    const ops = detectOperators(query);
    const parts = [];
    const desc = {
      'site:': 'Restricts results to a website/domain/host.',
      'inurl:': 'Matches terms in the URL.',
      'allinurl:': 'Matches multiple terms in the URL.',
      'intitle:': 'Matches terms in the page title.',
      'allintitle:': 'Matches multiple terms in the title.',
      'intext:': 'Matches terms in indexed page content.',
      'allintext:': 'Matches multiple terms in page content.',
      'filetype:': 'Filters by file type.',
      'ext:': 'Filters by file extension.',
      'cache:': 'Requests cached copy where supported (engine-dependent).',
      'after:': 'Date filter (support varies).',
      'before:': 'Date filter (support varies).',
      '""': 'Exact phrase match.',
      'OR': 'Matches either term/group.',
      '-': 'Excludes a term.',
      '()': 'Groups expressions.',
      '*': 'Wildcard placeholder (engine-dependent).'
    };
    ops.forEach(o => parts.push({ op: o, text: desc[o] || 'Search operator/modifier.' }));
    if (!parts.length) parts.push({ op: 'keywords', text: 'Plain keyword/phrase search.' });
    return parts;
  }

  function buildGeneratedQueries({ targetInfo, moduleIds, customItems, engineId, includeGlobalOverride }) {
    const vars = { target: targetInfo.normalized, keyword: '', extension: '', subdomain: '', path: '', date_from: '', date_to: '' };
    const selectedModules = new Set(moduleIds || []);
    const base = DATA.QUERIES.filter(q => selectedModules.has(q.module));
    // if includeGlobalOverride false, still keep global only when globalbb selected; module selection governs
    const items = [];
    base.forEach(def => {
      const isGlobal = !!def.global;
      // for root_sub scope and subdomain-style queries, we can also produce a site:*.target variant contextually by keeping template as-is (templates already express intent)
      let template = def.template;
      let queryStr = applyTemplate(template, vars);
      // scope-aware adjustments: root_sub for target-scoped queries using site:{target} -> prefer site:*.{target} OR site:{target} for broad footprint in some cases? keep predictable: replace plain site:{target} only when query is exactly broad index/subdomain discovery patterns
      if (!isGlobal && targetInfo.scope === 'root_sub') {
        // enhance broad site:{target} (exact token) at start patterns
        if (/^site:\{target\}(\s|$)/.test(def.template)) {
          // keep original as well? we'll generate main as site:*.target OR site:target when it was only site:{target}
          if (normalizeQuery(def.template) === 'site:{target}') {
            queryStr = `(site:${vars.target} OR site:*.${vars.target})`;
          }
        } else if (/site:\{target\}/.test(def.template)) {
          // substitute normally; users can understand scope shown
          queryStr = applyTemplate(template, vars);
        }
      } else if (!isGlobal && targetInfo.scope === 'exact') {
        queryStr = applyTemplate(template, vars);
      } else {
        queryStr = applyTemplate(template, vars);
      }
      queryStr = normalizeQuery(queryStr);
      const v = validateQuerySyntax(queryStr, isGlobal);
      if (!v.ok) return;
      items.push(materialize(def, queryStr, engineId, isGlobal, 'preset', null));
    });

    // custom
    (customItems || []).forEach((c, idx) => {
      const isGlobal = !!c.global;
      let qstr = String(c.query || '');
      if (!isGlobal) qstr = qstr.replaceAll('{target}', vars.target);
      qstr = normalizeQuery(qstr);
      // auto-scope custom: only if not global and no site:/cache: and no {target} in original and caller flagged autoScope
      if (!isGlobal && c.autoScope !== false) {
        const orig = String(c.query || '');
        if (!/\bsite:/i.test(orig) && !/\bcache:/i.test(qstr)) {
          qstr = normalizeQuery(`site:${vars.target} ${qstr}`);
        }
      }
      const v = validateQuerySyntax(qstr, isGlobal);
      if (!v.ok) return;
      items.push({
        id: c.id || uid('cq'),
        key: '',
        label: c.label || ('Custom ' + (idx + 1)),
        category: c.category || 'Custom',
        module: 'custom',
        priority: c.priority || 'medium',
        query: qstr,
        description: c.description || 'Custom search query.',
        explanation: c.explanation || 'Custom user-defined query.',
        operators: c.operators && c.operators.length ? c.operators : detectOperators(qstr),
        enginesNote: c.enginesNote || 'Behavior may vary by engine.',
        global: isGlobal,
        source: 'custom',
        engineId,
        status: 'Not Reviewed',
        saved: false,
        selected: true,
        notes: c.notes || '',
        tags: Array.isArray(c.tags) ? c.tags : []
      });
    });

    // dedupe by normalized query (case-insensitive) keeping highest priority preset/custom first-seen
    const seen = new Map();
    const priRank = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 };
    items.forEach(it => {
      const qv = (it && typeof it.query === 'string') ? it.query : normalizeQuery(String(it && it.query != null ? it.query : ''));
      if (!qv) return;
      it.query = qv;
      const k = qv.toLowerCase();
      if (!seen.has(k)) { it.key = k; seen.set(k, it); }
      else {
        const prev = seen.get(k);
        if ((priRank[it.priority] || 0) > (priRank[prev.priority] || 0)) { it.key = k; seen.set(k, it); }
      }
    });
    return Array.from(seen.values());
  }

  function materialize(def, query, engineId, isGlobal, source, extra) {
    return {
      id: def.id ? def.id + '_' + Math.random().toString(36).slice(2,6) : uid('q'),
      key: query.toLowerCase(),
      defId: def.id,
      label: def.label,
      category: def.category,
      module: def.module,
      priority: def.priority,
      query,
      description: def.description,
      explanation: def.explanation,
      operators: def.operators && def.operators.length ? def.operators : detectOperators(query),
      enginesNote: def.enginesNote || 'Behavior may vary by engine.',
      global: isGlobal,
      source: source || 'preset',
      engineId,
      status: 'Not Reviewed',
      saved: false,
      selected: true,
      notes: '',
      tags: []
    };
  }

  // ---------- State & persistence ----------
  const defaultSettings = () => ({
    defaultEngine: 'google',
    customEngineUrl: '',
    defaultScope: 'root',
    defaultCategories: DATA.MODULES.map(m => m.id),
    defaultSort: 'priority',
    resultsPerPage: 100,
    autoSave: true
  });

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch { return fallback; }
  }
  function saveJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  }

  function getSettings() {
    const s = loadJson(SETTINGS_KEY, null);
    const d = defaultSettings();
    if (!s) return d;
    return { ...d, ...s, defaultCategories: Array.isArray(s.defaultCategories) ? s.defaultCategories : d.defaultCategories };
  }
  function setSettings(s) { saveJson(SETTINGS_KEY, s); }

  function getHistory() { const h = loadJson(HISTORY_KEY, []); return Array.isArray(h) ? h : []; }
  function setHistory(h) { saveJson(HISTORY_KEY, h.slice(0, 300)); }

  function defaultProject(settings) {
    return {
      id: uid('prj'),
      name: 'Default Project',
      target: 'example.com',
      scope: settings.defaultScope || 'root',
      engine: settings.defaultEngine || 'google',
      selectedModules: (settings.defaultCategories || DATA.MODULES.map(m => m.id)).slice(),
      generated: [], // query objects
      savedQueries: [], // saved snapshots {id,key,query,label,...}
      customDorks: [], // custom templates/items
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastPlaybook: null
    };
  }

  function getState() {
    const st = loadJson(STORE_KEY, null);
    const settings = getSettings();
    if (!st || !Array.isArray(st.projects) || !st.projects.length) {
      const p = defaultProject(settings);
      const fresh = { activeProjectId: p.id, projects: [p], ui: { view: 'dashboard' } };
      saveJson(STORE_KEY, fresh);
      return fresh;
    }
    // basic healing
    if (!st.activeProjectId || !st.projects.find(p => p.id === st.activeProjectId)) st.activeProjectId = st.projects[0].id;
    if (!st.ui) st.ui = { view: 'dashboard' };
    return st;
  }
  function setState(st) { saveJson(STORE_KEY, st); }

  function getActiveProject(st) { const s = st || getState(); return s.projects.find(p => p.id === s.activeProjectId) || s.projects[0]; }
  function updateActiveProject(mutator) {
    const st = getState();
    const p = getActiveProject(st);
    mutator(p, st);
    p.updatedAt = nowIso();
    if (getSettings().autoSave) setState(st);
    return { st, p };
  }

  // ---------- Rendering helpers ----------
  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') { /* avoid */ }
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.entries(v).forEach(([dk,dv]) => n.dataset[dk] = dv);
      else if (v === false || v == null) {}
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    const appendChildSafe = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { c.forEach(appendChildSafe); return; }
      if (typeof c === 'string' || typeof c === 'number') { n.appendChild(document.createTextNode(String(c))); return; }
      if (c instanceof Node) { n.appendChild(c); return; }
      // ignore unsupported child types to avoid runtime crashes
    };
    (Array.isArray(children) ? children : [children]).forEach(appendChildSafe);
    return n;
  }

  function panel(title, sub) {
    const p = el('section', { class: 'panel' });
    const h = el('div', { class: 'panel-header' }, [
      el('div', {}, [el('h2', { class: 'panel-title', text: title }), sub ? el('div', { class: 'panel-sub', text: sub }) : null]),
    ]);
    p.appendChild(h);
    p._head = h; p._body = el('div'); p.appendChild(p._body);
    return p;
  }

  function stat(label, value, sub) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat-label', text: label }),
      el('div', { class: 'stat-value', text: String(value) }),
      sub ? el('div', { class: 'stat-sub', text: sub }) : null
    ]);
  }

  function priorityBadge(p) {
    const cls = 'badge pri-' + (p || 'informational');
    return el('span', { class: cls, text: (p || 'informational').replace(/^./, c => c.toUpperCase()) });
  }

  // ---------- App ----------
  const stateUI = { selectedQueryId: null, workbenchFilter: {} };

  function init() {
    ensureSettings();
    renderShellState();
    bindGlobal();
    navigate(getState().ui.view || 'dashboard');
  }

  function ensureSettings() {
    if (!localStorage.getItem(SETTINGS_KEY)) setSettings(defaultSettings());
  }

  function renderShellState() {
    const settings = getSettings();
    const st = getState();
    const p = getActiveProject(st);
    // engines
    const ge = $('#global-engine'); clearEl(ge);
    DATA.ENGINES.forEach(e => ge.appendChild(el('option', { value: e.id, text: e.label })));
    ge.appendChild(el('option', { value: 'custom', text: 'Custom URL' }));
    ge.value = p.engine || settings.defaultEngine || 'google';
    // projects
    const gp = $('#global-project'); clearEl(gp);
    st.projects.forEach(pr => gp.appendChild(el('option', { value: pr.id, text: pr.name })));
    gp.value = p.id;
    updateTopMeta();
  }

  function updateTopMeta() {
    const st = getState(); const p = getActiveProject(st);
    const info = normalizeTargetInput(p.target || '', p.scope || 'root');
    const scopeText = info.ok ? info.scopeLabel : 'No valid target';
    const elMeta = $('#topbar-meta');
    if (elMeta) elMeta.textContent = `Target: ${p.target || '—'} | Scope: ${scopeText} | Queries: ${p.generated.length} | Saved: ${(p.savedQueries||[]).length}`;
  }

  function bindGlobal() {
    $$('#main-nav .nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.view)));
    $('#global-engine').addEventListener('change', (e) => {
      updateActiveProject((p) => { p.engine = e.target.value; });
      updateTopMeta();
      if (getState().ui.view === 'workbench' || getState().ui.view === 'recon') navigate(getState().ui.view);
      toast('Search engine set to ' + ($('#global-engine').selectedOptions[0]?.textContent || e.target.value));
    });
    $('#global-project').addEventListener('change', (e) => {
      const st = getState(); st.activeProjectId = e.target.value; setState(st);
      renderShellState(); navigate(st.ui.view || 'dashboard');
    });
    $('#quick-generate').addEventListener('click', () => {
      generateForProject(getActiveProject(), { recordHistory: true });
      navigate('workbench');
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) && !e.ctrlKey && !e.metaKey) return;
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); navigate('recon'); }
      if (e.key === 'w' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); navigate('workbench'); }
      if (e.key === 'p' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); navigate('playbooks'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); generateForProject(getActiveProject(), { recordHistory: true }); navigate('workbench'); }
    });
  }

  function navigate(view) {
    const st = getState(); st.ui.view = view; setState(st);
    $$('#main-nav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const titles = { dashboard:'Dashboard', recon:'Reconnaissance', playbooks:'Playbooks', workbench:'Query Workbench', custom:'Custom Dorks', archive:'Archive / Tools', projects:'Projects', history:'History', cheatsheet:'Cheatsheet', settings:'Settings' };
    const vt = $('#view-title'); if (vt) vt.textContent = titles[view] || 'Dorking Tool';
    const root = $('#view-root'); if (!root) return;
    clearEl(root);
    try {
      if (view === 'dashboard') renderDashboard(root);
      else if (view === 'recon') renderRecon(root);
      else if (view === 'playbooks') renderPlaybooks(root);
      else if (view === 'workbench') renderWorkbench(root);
      else if (view === 'custom') renderCustom(root);
      else if (view === 'archive') renderArchive(root);
      else if (view === 'projects') renderProjects(root);
      else if (view === 'history') renderHistory(root);
      else if (view === 'cheatsheet') renderCheatsheet(root);
      else if (view === 'settings') renderSettings(root);
      else renderDashboard(root);
    } catch (err) {
      const p = panel('Error', 'View failed to render safely.');
      p._body.appendChild(el('div', { class: 'error-text', text: String(err && err.message || err) }));
      root.appendChild(p);
    }
    updateTopMeta();
  }

  // ---------- Generation ----------
  function generateForProject(p, opts = {}) {
    const st = getState();
    const proj = st.projects.find(x => x.id === p.id) || p;
    const info = normalizeTargetInput(proj.target, proj.scope);
    if (!info.ok) { toast(info.error, 'err'); return null; }
    const moduleIds = (proj.selectedModules && proj.selectedModules.length) ? proj.selectedModules : DATA.MODULES.map(m => m.id);
    const custom = (proj.customDorks || []).map(c => ({ ...c }));
    let queries = [];
    try {
      queries = buildGeneratedQueries({ targetInfo: info, moduleIds, customItems: custom, engineId: proj.engine || 'google' });
    } catch (e) {
      console.error('buildGeneratedQueries failed', e);
      toast('Query generation failed: ' + (e && e.message ? e.message : e), 'err');
      return null;
    }
    // preserve statuses/notes/saved by key where possible
    const prev = new Map((proj.generated || []).map(q => [q.key, q]));
    queries.forEach(q => { const old = prev.get(q.key); if (old) { q.status = old.status; q.notes = old.notes || ''; q.saved = !!old.saved; q.selected = old.selected !== false; } });
    proj.generated = queries;
    proj.updatedAt = nowIso();
    setState(st);
    if (opts.recordHistory !== false) addHistoryEntry(proj, { playbook: opts.playbook || null, modules: moduleIds, count: queries.length });
    renderShellState();
    toast(`Generated ${queries.length} query(ies) for ${info.normalized}.`);
    return queries;
  }

  function addHistoryEntry(project, meta) {
    const h = getHistory();
    h.unshift({
      id: uid('hist'), projectId: project.id, projectName: project.name, target: project.target,
      scope: project.scope, engine: project.engine, playbook: meta.playbook || null,
      modules: meta.modules || [], count: meta.count || 0, at: nowIso()
    });
    setHistory(h);
  }

  // ---------- Dashboard ----------
  function renderDashboard(root) {
    const st = getState(); const p = getActiveProject(st); const settings = getSettings();
    const info = normalizeTargetInput(p.target || '', p.scope || 'root');
    const byCat = countBy(p.generated, 'category');
    const byPri = countBy(p.generated, 'priority');
    const recentProjects = st.projects.slice().sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,5);
    const recentHist = getHistory().slice(0,6);

    // Quick Start (simple path)
    const qs = panel('Quick Start', 'Simple mode: enter a target and generate. Advanced options stay available in other tabs.');
    qs._body.appendChild(el('div',{class:'desc mb8',text:'Fastest workflow: 1) enter domain  2) generate  3) open/copy queries in Workbench. Defaults use safe, broad target-scoped recon (you can fine-tune later in Reconnaissance/Playbooks).'}));
    const qsTarget = el('input',{type:'text',value:p.target||'',placeholder:'e.g. example.com or https://target.com', autocomplete:'off', spellcheck:'false'});
    const qsEngine = el('select'); DATA.ENGINES.forEach(e=>qsEngine.appendChild(el('option',{value:e.id,text:e.label,selected:(p.engine||settings.defaultEngine)===e.id})));
    const qsMode = el('select'); [['all','Full target recon (recommended)'],['web','Web app focus'],['sensitive','Sensitive file indicators'],['api','API & dev surfaces']].forEach(([v,l])=>qsMode.appendChild(el('option',{value:v,text:l})));
    const modeModules = { all:['domain','files','login','dirs','config','backups','api','disclosure','params'], web:['login','api','params','dirs'], sensitive:['files','config','backups'], api:['api','params','domain'] };
    const qsErr = el('div',{class:'error-text mt8'});
    qs._body.appendChild(el('div',{class:'form-grid'},[
      fieldWrap('Target (authorized only)', qsTarget, 'Domain, subdomain, or URL (e.g. example.com).'),
      fieldWrap('Search engine', qsEngine),
      fieldWrap('Quick mode', qsMode, 'Chooses a sensible module set. Global discovery can be added later in Playbooks.'),
    ]));
    qs._body.appendChild(qsErr);
    qs._body.appendChild(el('div',{class:'actions mt12'},[
      btn('Generate & View Results', ()=>{
        const inf = normalizeTargetInput(qsTarget.value, 'root');
        if (!inf.ok) { qsErr.textContent = inf.error; toast(inf.error,'err'); return; }
        qsErr.textContent = '';
        const mods = modeModules[qsMode.value] || modeModules.all;
        updateActiveProject((pr)=>{ pr.target = inf.normalized; pr.scope = 'root'; pr.engine = qsEngine.value; pr.selectedModules = mods.slice(); });
        renderShellState();
        generateForProject(getActiveProject(), { recordHistory: true, playbook: 'Quick Start: ' + qsMode.selectedOptions[0].textContent });
        navigate('workbench');
      }),
      btn('Advanced setup (Reconnaissance)', ()=> navigate('recon'), 'secondary'),
      btn('Use a Playbook', ()=> navigate('playbooks'), 'secondary')
    ]));
    root.appendChild(qs);

    root.appendChild(el('div', { class: 'grid cols-4 mb12 mt12' }, [
      stat('Current Target', info.ok ? info.normalized : (p.target || '—'), info.ok ? info.scopeLabel : 'Set a valid target'),
      stat('Generated Queries', p.generated.length, 'In active project'),
      stat('Saved Queries', (p.savedQueries||[]).length, 'Manually saved'),
      stat('Custom Dorks', (p.customDorks||[]).length, 'Project templates')
    ]));

    const left = panel('Active Project', 'Current workspace and scope');
    left._body.appendChild(el('div', { class: 'kv' }, [
      kv('Project', p.name), kv('Target', p.target || '—'), kv('Scope', info.ok ? info.scopeLabel : 'Invalid/unset'),
      kv('Engine', (DATA.ENGINES.find(e=>e.id===p.engine)||{label:p.engine||settings.defaultEngine}).label + (p.engine==='custom'?' (template)':'')),
      kv('Modules', (p.selectedModules||[]).length + ' selected'), kv('Last updated', fmtDate(p.updatedAt))
    ]));
    left._body.appendChild(el('div', { class: 'actions mt12' }, [
      btn('Generate Recon', () => { generateForProject(p,{recordHistory:true}); navigate('workbench'); }),
      btn('Open Reconnaissance', () => navigate('recon'), 'secondary'),
      btn('Open Playbooks', () => navigate('playbooks'), 'secondary')
    ]));

    const right = panel('Priority Distribution', 'Query prioritization indicators (not vulnerability severity)');
    right._body.appendChild(distBars(byPri, p.generated.length, ['critical','high','medium','low','informational']));

    const cat = panel('Queries by Category', 'Coverage in current generated set');
    cat._body.appendChild(distBars(byCat, p.generated.length));

    const rp = panel('Recent Projects', 'Recently updated workspaces');
    if (!recentProjects.length) rp._body.appendChild(el('div',{class:'empty',text:'No projects yet.'}));
    else rp._body.appendChild(listSimple(recentProjects.map(pr => ({ title: pr.name, meta: `${pr.target||'—'} • ${fmtDate(pr.updatedAt)}`, action: btn('Open', ()=>{ const st=getState(); st.activeProjectId=pr.id; setState(st); renderShellState(); navigate('dashboard'); }, 'secondary') }))));

    const rh = panel('Recent Sessions', 'Recent query-generation sessions');
    if (!recentHist.length) rh._body.appendChild(el('div',{class:'empty',text:'No history yet.'}));
    else rh._body.appendChild(listSimple(recentHist.map(h => ({ title: `${h.target} (${h.count} queries)`, meta: `${fmtDate(h.at)} • ${h.playbook || 'Manual'} • ${(DATA.ENGINES.find(e=>e.id===h.engine)||{label:h.engine}).label}`, action: btn('Reopen', ()=>reopenHistory(h.id), 'secondary') }))));

    root.appendChild(el('div', { class: 'grid cols-2' }, [left, right]));
    root.appendChild(el('div', { class: 'grid cols-2 mt12' }, [cat, el('div',{class:'grid'},[rp,rh])]));
  }

  function kv(k, v) { return [el('div',{class:'k',text:k}), el('div',{text:v == null ? '—' : String(v)})]; }
  function countBy(arr, key) { const m = {}; (arr||[]).forEach(x => { const k = x[key] || 'unknown'; m[k] = (m[k]||0)+1; }); return m; }
  function distBars(map, total, order) {
    const keys = order || Object.keys(map).sort((a,b)=> (map[b]-map[a]));
    if (!keys.length || !total) return el('div',{class:'empty',text:'No generated queries yet.'});
    const wrap = el('div',{class:'list'});
    keys.forEach(k => {
      const val = map[k] || 0; if (!val && order) return; // show selected priorities only if present? include all when ordered
      const pct = total ? Math.round((val/total)*100) : 0;
      wrap.appendChild(el('div',{class:'bar-row'},[
        el('div',{class:'label',text:k}),
        el('div',{class:'progress-bar'},[el('span',{style:`width:${pct}%`})]),
        el('div',{class:'right muted',text:String(val)})
      ]));
    });
    if (!wrap.children.length) return el('div',{class:'empty',text:'No data.'});
    return wrap;
  }
  function listSimple(items) {
    const w = el('div',{class:'list'});
    items.forEach(it => {
      const c = el('div',{class:'card-item'});
      const head = el('div',{class:'item-head'},[el('div',{},[el('div',{class:'item-title',text:it.title}), el('div',{class:'muted tiny',text:it.meta||''})]), it.action || null]);
      c.appendChild(head); w.appendChild(c);
    });
    return w;
  }
  function btn(label, onClick, cls='') { const b = el('button',{class:cls,text:label}); b.addEventListener('click', onClick); return b; }

  // ---------- Reconnaissance view ----------
  function renderRecon(root) {
    const st = getState(); const p = getActiveProject(st); const settings = getSettings();
    const form = panel('Reconnaissance (Simple → Advanced)', 'Start with target + generate. Expand advanced options only if you need fine control.');
    const info = normalizeTargetInput(p.target || '', p.scope || 'root');
    const targetInput = el('input',{type:'text',value:p.target||'',placeholder:'e.g. example.com, https://example.com/path, *.example.com', autocomplete:'off', spellcheck:'false'});
    const scopeSel = el('select');
    [['root','Root domain'],['root_sub','Root domain and subdomains'],['exact','Exact hostname'],['custom','Custom scope']].forEach(([v,l])=>scopeSel.appendChild(el('option',{value:v,text:l,selected:p.scope===v})));
    const engineSel = el('select');
    DATA.ENGINES.forEach(e=>engineSel.appendChild(el('option',{value:e.id,text:e.label,selected:p.engine===e.id})));
    engineSel.appendChild(el('option',{value:'custom',text:'Custom URL template',selected:p.engine==='custom'}));
    const scopeHelp = el('div',{class:'help'});
    const setScopeHelp = () => {
      const inf = normalizeTargetInput(targetInput.value, scopeSel.value);
      scopeHelp.textContent = inf.ok ? `Will search: ${inf.display} (${inf.scopeLabel}). Target-scoped queries use this scope; global discovery queries remain unscoped.` : `Invalid target: ${inf.error}`;
      scopeHelp.className = inf.ok ? 'help' : 'error-text';
    };
    targetInput.addEventListener('input', setScopeHelp); scopeSel.addEventListener('change', setScopeHelp); setScopeHelp();

    const modsWrap = el('div',{class:'small-grid'});
    const modChecks = new Map();
    DATA.MODULES.forEach(m => {
      const id = 'mod_'+m.id;
      const checked = (p.selectedModules||[]).includes(m.id);
      const cb = el('input',{type:'checkbox',id}); cb.checked = checked;
      const lab = el('label',{class:'checkline',for:id},[cb, el('span',{text:m.short + (m.id==='globalbb'?' (global)':'')})]);
      modChecks.set(m.id, cb); modsWrap.appendChild(lab);
    });

    // Simple (always visible)
    form._body.appendChild(el('div',{class:'desc mb8',text:'Simple: enter a target and click Generate. Scope defaults to Root domain and all selected modules are used. Advanced controls are optional.'}));
    form._body.appendChild(el('div',{class:'form-grid'},[
      fieldWrap('Target', targetInput, 'Accepts domain, subdomain, URL, or wildcard (e.g. example.com, https://example.com/login, *.example.com).'),
      fieldWrap('Search engine', engineSel, 'Select engine for generated links. You can change later without regenerating.')
    ]));
    form._body.appendChild(el('div',{class:'actions mt12'},[
      btn('Generate (recommended defaults)', ()=>{
        const inf = normalizeTargetInput(targetInput.value, scopeSel.value || 'root');
        if (!inf.ok) { toast(inf.error,'err'); return; }
        const mods = Array.from(modChecks.entries()).filter(([,c])=>c.checked).map(([id])=>id);
        if (!mods.length) { toast('Select at least one module.','warn'); return; }
        updateActiveProject((pr)=>{ pr.target = inf.normalized; pr.scope = scopeSel.value || 'root'; pr.engine = engineSel.value; pr.selectedModules = mods; });
        renderShellState();
        generateForProject(getActiveProject(), { recordHistory: true });
        navigate('workbench');
      }),
      btn('Need a preset? Open Playbooks', ()=> navigate('playbooks'), 'secondary')
    ]));

    // Advanced (collapsible)
    const adv = el('details',{class:'mt12'});
    adv.appendChild(el('summary',{text:'Advanced options: scope, modules, and recommendations'}));
    const advBody = el('div',{class:'mt8'});
    advBody.appendChild(el('div',{class:'form-grid'},[
      fieldWrap('Scope mode', scopeSel, 'Controls how target-scoped queries are built. Global discovery queries are not scoped to the target.'),
      el('div',{class:'span-2'},[el('div',{class:'field-label',text:'Scope preview'}), scopeHelp]),
      el('div',{class:'span-2'},[el('div',{class:'field-label',text:'Reconnaissance modules'}), modsWrap,
        el('div',{class:'actions mt8'},[
          btn('Select all', ()=>modChecks.forEach(c=>c.checked=true),'secondary'),
          btn('Select target-scoped only', ()=>modChecks.forEach((c,id)=>c.checked = id!=='globalbb'),'secondary'),
          btn('Clear', ()=>modChecks.forEach(c=>c.checked=false),'secondary')
        ])
      ])
    ]));
    advBody.appendChild(el('div',{class:'actions mt12'},[
      btn('Save & Generate', ()=>{
        const inf = normalizeTargetInput(targetInput.value, scopeSel.value);
        if (!inf.ok) { toast(inf.error,'err'); return; }
        const mods = Array.from(modChecks.entries()).filter(([,c])=>c.checked).map(([id])=>id);
        if (!mods.length) { toast('Select at least one module.','warn'); return; }
        updateActiveProject((pr)=>{ pr.target = inf.normalized; pr.scope = scopeSel.value; pr.engine = engineSel.value; pr.selectedModules = mods; });
        renderShellState();
        generateForProject(getActiveProject(), { recordHistory: true });
        navigate('workbench');
      }),
      btn('Save without generating', ()=>{
        const inf = normalizeTargetInput(targetInput.value, scopeSel.value);
        if (!inf.ok) { toast(inf.error,'err'); return; }
        const mods = Array.from(modChecks.entries()).filter(([,c])=>c.checked).map(([id])=>id);
        updateActiveProject((pr)=>{ pr.target = inf.normalized; pr.scope = scopeSel.value; pr.engine = engineSel.value; pr.selectedModules = mods; });
        renderShellState(); toast('Recon settings saved.');
      }, 'secondary')
    ]));

    const rec = panel('Context-aware recommendations', 'Suggested modules and example queries based on current selection (leads, not findings)');
    const renderRecs = () => {
      clearEl(rec._body);
      const inf = normalizeTargetInput(targetInput.value, scopeSel.value);
      const mods = Array.from(modChecks.entries()).filter(([,c])=>c.checked).map(([id])=>id);
      const sug = recommend(mods, inf.ok ? inf.normalized : 'example.com');
      rec._body.appendChild(el('div',{class:'desc mb8',text:sug.reason}));
      const list = el('div',{class:'list'});
      sug.items.slice(0,6).forEach(it => list.appendChild(el('div',{class:'card-item'},[
        el('div',{class:'item-title',text:it.label}),
        el('div',{class:'muted tiny',text:it.why}),
        el('div',{class:'query-box',text:it.query})
      ])));
      rec._body.appendChild(list);
    };
    modsWrap.addEventListener('change', renderRecs); renderRecs();
    advBody.appendChild(el('div',{class:'mt12'},[rec]));
    adv.appendChild(advBody);
    form._body.appendChild(adv);

    root.appendChild(form);
  }

  function fieldWrap(label, control, help) {
    const w = el('label',{class:'field'});
    w.appendChild(el('span',{text:label}));
    w.appendChild(control);
    if (help) w.appendChild(el('div',{class:'help',text:help}));
    return w;
  }

  function recommend(moduleIds, target) {
    const set = new Set(moduleIds);
    let reason = 'Select modules to receive context-aware query recommendations.';
    if (set.has('api')) reason = 'API reconnaissance selected: prioritizing endpoint, documentation, and non-production surface discovery queries.';
    else if (set.has('config') || set.has('backups')) reason = 'Sensitive file exposure review selected: prioritizing publicly indexed config, backup, log, and dump indicators.';
    else if (set.has('domain')) reason = 'Domain intelligence selected: prioritizing footprint, subdomain, and public mention discovery.';
    else if (set.has('globalbb')) reason = 'Bug bounty intelligence selected: including global disclosure/program discovery (not target-scoped).';
    const vars = { target };
    const pool = DATA.QUERIES.filter(q => set.has(q.module)).slice(0, 10);
    return { reason, items: pool.map(q => ({ label: q.label, query: applyTemplate(q.template, vars), why: q.description })) };
  }

  // ---------- Playbooks ----------
  function renderPlaybooks(root) {
    const st = getState(); const p = getActiveProject(st);
    const intro = panel('Reconnaissance Playbooks', 'Predefined workflows; customize included modules before generating');
    intro._body.appendChild(el('div',{class:'desc',text:'Playbooks bundle relevant modules for common reconnaissance goals. Target-scoped and global discovery modules are indicated; global queries are never scoped to the target.'}));
    root.appendChild(intro);
    const list = el('div',{class:'grid cols-2 mt12'});
    DATA.PLAYBOOKS.forEach(pb => {
      const mods = DATA.MODULES.filter(m => pb.modules.includes(m.id));
      const count = DATA.QUERIES.filter(q => pb.modules.includes(q.module)).length;
      const card = el('section',{class:'panel'});
      card.appendChild(el('div',{class:'panel-header'},[el('div',{},[el('h2',{class:'panel-title',text:pb.name}), el('div',{class:'panel-sub',text:pb.description})])]));
      const body = el('div');
      body.appendChild(el('div',{class:'kv mb8'},[kv('Queries', String(count)), kv('Modules', String(mods.length)), kv('Global included', pb.includeGlobal ? 'Yes' : 'No')]));
      body.appendChild(el('div',{class:'desc mb8',text:pb.coverage}));
      body.appendChild(el('div',{class:'chips mb8'}, mods.map(m=>el('span',{class:'chip',text:m.short}))));
      const details = el('div',{class:'small-grid mb8'});
      const checks = new Map();
      DATA.MODULES.forEach(m => {
        const cb = el('input',{type:'checkbox'}); cb.checked = pb.modules.includes(m.id);
        checks.set(m.id, cb);
        details.appendChild(el('label',{class:'checkline'},[cb, document.createTextNode(' '+m.short)]));
      });
      body.appendChild(el('details',{},[el('summary',{text:'Customize modules before generating'}), el('div',{class:'mt8'},[details])]));
      body.appendChild(el('div',{class:'actions'},[
        btn('Generate Playbook', ()=>{
          const selected = Array.from(checks.entries()).filter(([,c])=>c.checked).map(([id])=>id);
          if (!selected.length) { toast('Select at least one module.','warn'); return; }
          updateActiveProject((pr)=>{ pr.selectedModules = selected; pr.lastPlaybook = pb.name; });
          renderShellState();
          generateForProject(getActiveProject(), { recordHistory: true, playbook: pb.name });
          navigate('workbench');
        }),
        btn('Load into Recon', ()=>{
          const selected = Array.from(checks.entries()).filter(([,c])=>c.checked).map(([id])=>id);
          updateActiveProject((pr)=>{ pr.selectedModules = selected.length?selected:pb.modules.slice(); pr.lastPlaybook = pb.name; });
          renderShellState(); navigate('recon');
        }, 'secondary')
      ]));
      card.appendChild(body); list.appendChild(card);
    });
    root.appendChild(list);
  }

  // ---------- Workbench ----------
  function renderWorkbench(root) {
    const st = getState(); const p = getActiveProject(st);
    const settings = getSettings();
    const header = panel('Advanced Query Workbench', 'Inspect, explain, filter, prioritize, edit custom copies, save, and export generated queries');
    const info = normalizeTargetInput(p.target || '', p.scope || 'root');
    const summary = el('div',{class:'chips mb8'},[
      el('span',{class:'chip',text:`Target: ${info.ok?info.normalized:(p.target||'—')}`}),
      el('span',{class:'chip',text:`Scope: ${info.ok?info.scopeLabel:'—'}`}),
      el('span',{class:'chip',text:`Engine: ${($('#global-engine').selectedOptions[0]?.textContent||p.engine)}`}),
      el('span',{class:'chip',text:`Generated: ${p.generated.length}`}),
      el('span',{class:'chip',text:`Selected: ${p.generated.filter(x=>x.selected).length}`}),
      el('span',{class:'chip',text:`Saved: ${(p.savedQueries||[]).length}`})
    ]);
    header._body.appendChild(summary);
    header._body.appendChild(el('div',{class:'actions'},[
      btn('Regenerate', ()=>{ generateForProject(p,{recordHistory:true}); navigate('workbench'); }),
      btn('Change engine only', ()=>{
        // no regen: links are derived from query+engine
        toast('Engine selection applies to all open/copy-link actions without regenerating.');
      }, 'secondary'),
      btn('Export view', ()=> openExportModal(getFilteredWorkbenchItems(p)), 'secondary')
    ]));
    root.appendChild(header);

    if (!p.generated.length) {
      root.appendChild(el('div',{class:'mt12 empty',text:'No queries generated yet. Configure a target in Reconnaissance or launch a Playbook, then generate.'}));
      return;
    }

    const wrap = el('div',{class:'split mt12'});
    const left = el('div');
    const right = el('div',{class:'details-pane'});

    const toolbar = el('div',{class:'panel'});
    toolbar.appendChild(el('div',{class:'panel-header'},[el('div',{},[el('h2',{class:'panel-title',text:'Filters & Bulk Actions'})])]));
    const tb = el('div',{class:'toolbar'});
    const fSearch = el('input',{type:'search',placeholder:'Search name, query, category, operator, tag'});
    const fCat = el('select'); fCat.appendChild(el('option',{value:'',text:'All categories'})); [...new Set(p.generated.map(q=>q.category))].sort().forEach(c=>fCat.appendChild(el('option',{value:c,text:c})));
    const fPri = el('select'); fPri.appendChild(el('option',{value:'',text:'All priorities'})); ['critical','high','medium','low','informational'].forEach(v=>fPri.appendChild(el('option',{value:v,text:v})));
    const fStatus = el('select'); fStatus.appendChild(el('option',{value:'',text:'All statuses'})); ['Not Reviewed','Reviewed','Interesting Lead','No Relevant Results','Requires Further Investigation'].forEach(v=>fStatus.appendChild(el('option',{value:v,text:v})));
    const fSort = el('select'); [['priority','Priority'],['category','Category'],['alpha','Alphabetical']].forEach(([v,l])=>fSort.appendChild(el('option',{value:v,text:l,selected:(settings.defaultSort||'priority')===v})));
    const fSaved = el('input',{type:'checkbox'}); const fSelected = el('input',{type:'checkbox'});
    tb.appendChild(fieldWrap('Search', fSearch)); tb.appendChild(fieldWrap('Category', fCat)); tb.appendChild(fieldWrap('Priority', fPri)); tb.appendChild(fieldWrap('Status', fStatus)); tb.appendChild(fieldWrap('Sort', fSort));
    tb.appendChild(el('label',{class:'checkline'},[fSaved, document.createTextNode(' Saved only')]));
    tb.appendChild(el('label',{class:'checkline'},[fSelected, document.createTextNode(' Selected only')]));
    toolbar.appendChild(tb);
    const bulk = el('div',{class:'actions'});
    bulk.appendChild(btn('Select all', ()=>{ getFilteredWorkbenchItems(getActiveProject(), getWbFilters()).forEach(q=>q.selected=true); persistAndRerenderWorkbench(); }, 'secondary'));
    bulk.appendChild(btn('Deselect all', ()=>{ getFilteredWorkbenchItems(getActiveProject(), getWbFilters()).forEach(q=>q.selected=false); persistAndRerenderWorkbench(); }, 'secondary'));
    bulk.appendChild(btn('Copy selected', async ()=>{ const items = p.generated.filter(q=>q.selected); if(!items.length) return toast('No selected queries.','warn'); await copyText(items.map(q=>q.query).join('\n')); toast(`Copied ${items.length} quer${items.length===1?'y':'ies'}.`); }, 'secondary'));
    bulk.appendChild(btn('Export selected', ()=>{ const items = p.generated.filter(q=>q.selected); if(!items.length) return toast('No selected queries.','warn'); openExportModal(items); }, 'secondary'));
    bulk.appendChild(btn('Open selected', async ()=>{
      const items = getActiveProject().generated.filter(q=>q.selected);
      if(!items.length) return toast('No selected queries.','warn');
      const max = 10;
      if (items.length > max) { const ok = await confirmDialog('Open selected queries', `This will open up to ${max} tabs now (of ${items.length} selected). Continue?`); if(!ok) return; }
      openBatch(items.slice(0,max), getActiveProject().engine);
    }, 'secondary'));
    toolbar.appendChild(bulk);
    left.appendChild(toolbar);

    const listPanel = el('div',{class:'panel'});
    listPanel.appendChild(el('div',{class:'panel-header'},[el('div',{},[el('h2',{class:'panel-title',text:'Generated Queries'}), el('div',{class:'panel-sub',id:'wb-count'})])]));
    const list = el('div',{class:'list',id:'wb-list'}); listPanel.appendChild(list); left.appendChild(listPanel);

    const detail = panel('Query Details & Explanation', 'Operator breakdown and actions');
    detail._body.appendChild(el('div',{id:'wb-detail',class:'empty',text:'Select a query to inspect details.'}));
    right.appendChild(detail);

    function getWbFilters() {
      return { term: fSearch.value.trim().toLowerCase(), cat: fCat.value, pri: fPri.value, status: fStatus.value, sort: fSort.value, saved: fSaved.checked, selected: fSelected.checked };
    }
    function renderList() {
      const proj = getActiveProject();
      const items = getFilteredWorkbenchItems(proj, getWbFilters());
      const wbCount = $('#wb-count'); if (wbCount) wbCount.textContent = `${items.length} shown / ${proj.generated.length} total`;
      clearEl(list);
      if (!items.length) { list.appendChild(el('div',{class:'empty',text:'No queries match current filters.'})); return; }
      const pageSize = clamp(Number(getSettings().resultsPerPage)||100, 10, 500);
      items.slice(0, pageSize).forEach(q => {
        const card = el('div',{class:'card-item' + (q.id===stateUI.selectedQueryId?' selected':'')});
        const headLeft = el('div',{},[
          el('div',{class:'item-title',text:q.label}),
          el('div',{class:'item-meta'},[
            priorityBadge(q.priority),
            el('span',{class:'badge',text:q.category}),
            q.global ? el('span',{class:'badge',text:'Global'}) : el('span',{class:'badge',text:'Target-scoped'}),
            q.source==='custom'?el('span',{class:'badge',text:'Custom'}):null,
            q.saved?el('span',{class:'badge',text:'Saved'}):null
          ])
        ]);
        const sel = el('input',{type:'checkbox'}); sel.checked = !!q.selected;
        sel.addEventListener('change', ()=>{ q.selected = sel.checked; persistState(); renderList(); updateTopMeta(); });
        card.appendChild(el('div',{class:'item-head'},[headLeft, sel]));
        card.appendChild(el('div',{class:'query-box',text:q.query}));
        card.appendChild(el('div',{class:'desc',text:q.description || ''}));
        const actions = el('div',{class:'actions mt8'});
        actions.appendChild(btn('Open', ()=> openOne(q, getActiveProject().engine), 'secondary'));
        actions.appendChild(btn('Copy', async ()=>{ await copyText(q.query); toast('Query copied.'); }, 'secondary'));
        actions.appendChild(btn('Details', ()=>{ stateUI.selectedQueryId = q.id; renderList(); renderDetail(q); }, 'secondary'));
        actions.appendChild(btn(q.saved?'Unsave':'Save', ()=>{ toggleSave(q); persistState(); renderList(); renderDetail(q); renderShellState(); }, 'secondary'));
        card.appendChild(actions);
        card.addEventListener('click', (e)=>{ if (e.target.closest('button') || e.target.tagName==='INPUT') return; stateUI.selectedQueryId=q.id; renderList(); renderDetail(q); });
        list.appendChild(card);
      });
      if (items.length > pageSize) list.appendChild(el('div',{class:'help mt8',text:`Showing first ${pageSize} results (adjust in Settings).`}));
      const selQ = proj.generated.find(x=>x.id===stateUI.selectedQueryId) || items[0];
      if (selQ) { stateUI.selectedQueryId = selQ.id; renderDetail(selQ); }
    }
    function renderDetail(q) {
      const d = $('#wb-detail');
      if (!d) return;
      clearEl(d);
      const url = safeHref(engineUrl(getActiveProject().engine, q.query));
      d.appendChild(el('div',{class:'kv mb8'},[
        kv('Query ID', q.id), kv('Name', q.label), kv('Category', q.category), kv('Priority', q.priority),
        kv('Scope type', q.global ? 'Global discovery' : 'Target-scoped'), kv('Source', q.source),
        kv('Engine', ($('#global-engine').selectedOptions[0]?.textContent || getActiveProject().engine)),
        kv('Compatibility', q.enginesNote || 'Varies by engine')
      ]));
      d.appendChild(el('div',{class:'field-label',text:'Search-engine query'}));
      d.appendChild(el('div',{class:'query-box',text:q.query}));
      d.appendChild(el('div',{class:'desc mb8',text:q.explanation || q.description || ''}));
      d.appendChild(el('div',{class:'field-label',text:'Operator breakdown'}));
      const ops = el('div',{class:'op-list mb8'});
      explainQuery(q.query).forEach(o => ops.appendChild(el('div',{class:'op-item'},[el('div',{class:'op-name',text:o.op}), el('div',{class:'op-desc',text:o.text})])));
      d.appendChild(ops);
      // manual status & notes
      const status = el('select'); ['Not Reviewed','Reviewed','Interesting Lead','No Relevant Results','Requires Further Investigation'].forEach(s=>status.appendChild(el('option',{value:s,text:s,selected:q.status===s})));
      status.addEventListener('change', ()=>{ q.status = status.value; persistState(); });
      const notes = el('textarea'); notes.value = q.notes || ''; notes.placeholder = 'Manual investigation notes for this query...';
      notes.addEventListener('change', ()=>{ q.notes = notes.value; persistState(); });
      d.appendChild(el('div',{class:'form-grid mt8'},[fieldWrap('Manual status', status, 'Manually assigned. Not auto-classified.'), fieldWrap('Notes', notes)]));
      const act = el('div',{class:'actions mt8'});
      act.appendChild(btn('Copy query', async()=>{ await copyText(q.query); toast('Copied.'); }, 'secondary'));
      act.appendChild(btn('Copy link', async()=>{ if(!url) return toast('Invalid URL','err'); await copyText(url); toast('Link copied.'); }, 'secondary'));
      if (q.source === 'custom') act.appendChild(btn('Edit custom', ()=> editCustomDork(q), 'secondary'));
      act.appendChild(btn('Save as custom template', ()=> saveAsCustomTemplate(q), 'secondary'));
      act.appendChild(btn(q.saved?'Unsave':'Save to project', ()=>{ toggleSave(q); persistState(); renderList(); renderDetail(q); renderShellState(); }, 'secondary'));
      d.appendChild(act);
      d.appendChild(el('div',{class:'help mt8',text:'Opening a link performs a normal browser search on the selected engine. This tool does not scrape or fetch results.'}));
    }

    [fSearch,fCat,fPri,fStatus,fSort,fSaved,fSelected].forEach(x=>x.addEventListener('input', renderList));
    [fCat,fPri,fStatus,fSort,fSaved,fSelected].forEach(x=>x.addEventListener('change', renderList));
    renderList();

    wrap.appendChild(left); wrap.appendChild(right); root.appendChild(wrap);
  }

  function getFilteredWorkbenchItems(p, f) {
    const filters = f || stateUI.workbenchFilter || {};
    let items = (p.generated || []).slice();
    if (filters.term) items = items.filter(q => (q.label+ ' ' + q.query + ' ' + q.category + ' ' + (q.operators||[]).join(' ') + ' ' + (q.tags||[]).join(' ') + ' ' + (q.description||'')).toLowerCase().includes(filters.term));
    if (filters.cat) items = items.filter(q => q.category === filters.cat);
    if (filters.pri) items = items.filter(q => q.priority === filters.pri);
    if (filters.status) items = items.filter(q => q.status === filters.status);
    if (filters.saved) items = items.filter(q => q.saved);
    if (filters.selected) items = items.filter(q => q.selected);
    const priRank = { critical:0, high:1, medium:2, low:3, informational:4 };
    if (filters.sort === 'category') items.sort((a,b)=> (a.category||'').localeCompare(b.category||'') || a.label.localeCompare(b.label));
    else if (filters.sort === 'alpha') items.sort((a,b)=> a.label.localeCompare(b.label));
    else items.sort((a,b)=> (priRank[a.priority]??9)-(priRank[b.priority]??9) || (a.category||'').localeCompare(b.category||'') || a.label.localeCompare(b.label));
    return items;
  }

  function persistAndRerenderWorkbench() { persistState(); navigate('workbench'); }
  function persistState() { const st = getState(); setState(st); }

  function toggleSave(q) {
    const st = getState(); const p = getActiveProject(st);
    const projQ = p.generated.find(x => x.id === q.id) || q;
    projQ.saved = !projQ.saved;
    p.savedQueries = p.savedQueries || [];
    if (projQ.saved) {
      if (!p.savedQueries.find(x => x.key === projQ.key)) p.savedQueries.push({ id: projQ.id, key: projQ.key, label: projQ.label, query: projQ.query, category: projQ.category, priority: projQ.priority, global: projQ.global, status: projQ.status, notes: projQ.notes || '' });
    } else {
      p.savedQueries = p.savedQueries.filter(x => x.key !== projQ.key);
    }
    setState(st); toast(projQ.saved ? 'Query saved to project.' : 'Query removed from saved.');
  }

  function openOne(q, engineId) {
    const url = safeHref(engineUrl(engineId, q.query));
    if (!url) { toast('Invalid or unsafe URL.', 'err'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  async function openBatch(items, engineId) {
    const ok = await confirmDialog('Open external searches', `Open ${items.length} search tab(s) in ${($('#global-engine').selectedOptions[0]?.textContent||engineId)}? Popups may be blocked by your browser.`);
    if (!ok) return;
    items.forEach(q => { const url = safeHref(engineUrl(engineId, q.query)); if (url) window.open(url, '_blank', 'noopener,noreferrer'); });
    toast(`Opened ${items.length} tab(s). If blocked, allow popups for this page.`);
  }

  function editCustomDork(q) {
    const st = getState(); const p = getActiveProject(st);
    const cd = (p.customDorks||[]).find(c => c.id === q.id || c.label === q.label && c.query === q.query) || null;
    if (!cd) { toast('Only saved custom dork templates can be edited here. Use "Save as custom template" first.', 'warn'); return; }
    openCustomEditor(cd, (updated) => {
      Object.assign(cd, updated);
      setState(st); toast('Custom dork updated. Regenerate to apply.');
    });
  }
  function saveAsCustomTemplate(q) {
    const st = getState(); const p = getActiveProject(st);
    p.customDorks = p.customDorks || [];
    const item = { id: uid('cd'), label: q.label, query: q.query, category: q.category || 'Custom', priority: q.priority || 'medium', description: q.description || '', tags: q.tags || [], global: !!q.global, autoScope: !q.global && !/\bsite:/i.test(q.query) };
    p.customDorks.push(item); setState(st); toast('Saved as custom dork template in this project.');
  }

  // ---------- Custom Dorks 2.0 ----------
  function renderCustom(root) {
    const st = getState(); const p = getActiveProject(st);
    const infoPanel = panel('Custom Dork Builder 2.0', 'Create, validate, edit, import packs, and manage project custom query templates');
    infoPanel._body.appendChild(el('div',{class:'desc',text:'Use {target} in target-scoped custom queries. Mark queries as Global discovery to avoid automatic target scoping. You can import dork packs (.txt, one per line) and replace placeholders like site.com / Name Or Username.'}));
    infoPanel._body.appendChild(el('div',{class:'actions mt8'},[
      btn('Add custom dork', ()=> openCustomEditor(null, (item)=>{ p.customDorks = p.customDorks || []; p.customDorks.push(item); setState(st); navigate('custom'); toast('Custom dork added.'); })),
      btn('Visual query composer', ()=> openComposer(), 'secondary'),
      btn('Import dork pack (.txt)', ()=> importDorkPackFile(), 'secondary'),
      btn('Load built-in packs', ()=> loadBuiltinDorkPacks(), 'secondary'),
      btn('Export templates', ()=> downloadFile(safeName(p.name)+'-custom-dorks.json', JSON.stringify(p.customDorks||[], null, 2), 'application/json'), 'secondary'),
      btn('Import templates (JSON)', ()=> importCustomTemplates(), 'secondary')
    ]));
    root.appendChild(infoPanel);

    // Bulk replace helper (inspired by Gui-Dorking replace text)
    const replacePanel = panel('Bulk Replace in Custom Dorks', 'Find and replace text across all custom dork queries in this project');
    const findIn = el('input',{type:'text',placeholder:'Find (e.g. site.com or Name Or Username)'});
    const replIn = el('input',{type:'text',placeholder:'Replace with (e.g. {target} or {keyword})'});
    replacePanel._body.appendChild(el('div',{class:'form-grid'},[fieldWrap('Find', findIn), fieldWrap('Replace with', replIn)]));
    replacePanel._body.appendChild(el('div',{class:'actions mt8'},[
      btn('Replace in all custom queries', ()=>{
        const f = findIn.value; const r = replIn.value;
        if (!f) return toast('Enter text to find.','warn');
        let n = 0; (p.customDorks||[]).forEach(c => { if (typeof c.query==='string' && c.query.includes(f)) { c.query = c.query.split(f).join(r); n++; } });
        if (n) { setState(getState()); navigate('custom'); toast(`Updated ${n} custom dork(s).`); } else toast('No matches found.','warn');
      }, 'secondary')
    ]));
    root.appendChild(el('div',{class:'mt12'},[replacePanel]));

    const listP = panel('Project Custom Dorks', `${(p.customDorks||[]).length} template(s)`);
    if (!(p.customDorks||[]).length) {
      listP._body.appendChild(el('div',{class:'empty',text:'No custom dorks yet. Add one, import a .txt pack, load built-in packs, or save a generated query as a custom template.'}));
    } else {
      const list = el('div',{class:'list'});
      p.customDorks.forEach((c, idx) => {
        const card = el('div',{class:'card-item'});
        card.appendChild(el('div',{class:'item-head'},[
          el('div',{},[el('div',{class:'item-title',text:c.label||('Custom '+(idx+1))}), el('div',{class:'item-meta'},[priorityBadge(c.priority||'medium'), el('span',{class:'badge',text:c.category||'Custom'}), c.global?el('span',{class:'badge',text:'Global'}):el('span',{class:'badge',text:'Target-scoped'})])]),
        ]));
        card.appendChild(el('div',{class:'query-box',text:c.query||''}));
        if (c.description) card.appendChild(el('div',{class:'desc',text:c.description}));
        if (c.tags && c.tags.length) card.appendChild(el('div',{class:'chips mt8'}, c.tags.map(t=>el('span',{class:'chip',text:t}))));
        card.appendChild(el('div',{class:'actions mt8'},[
          btn('Edit', ()=> openCustomEditor(c, (u)=>{ Object.assign(c,u); setState(st); navigate('custom'); toast('Updated.'); }), 'secondary'),
          btn('Duplicate', ()=>{ p.customDorks.push({ ...JSON.parse(JSON.stringify(c)), id: uid('cd'), label: (c.label||'Custom')+' (copy)' }); setState(st); navigate('custom'); }, 'secondary'),
          btn('Delete', async ()=>{ const ok = await confirmDialog('Delete custom dork', `Delete "${c.label}"?`, 'Delete', true); if(!ok) return; p.customDorks = p.customDorks.filter(x=>x!==c); setState(st); navigate('custom'); }, 'danger')
        ]));
        list.appendChild(card);
      });
      listP._body.appendChild(list);
    }
    root.appendChild(el('div',{class:'mt12'},[listP]));
  }

  function validateCustomDraft(d) {
    const errs = [];
    if (!String(d.label||'').trim()) errs.push('Label is required.');
    const q = String(d.query||'').trim();
    if (!q) errs.push('Query is required.');
    if (!d.global && !q.includes('{target}') && !/\bsite:/i.test(q) && d.autoScope === false) errs.push('Target-scoped query without {target}/site: and auto-scope disabled may not be scoped.');
    const inf = normalizeTargetInput(getActiveProject().target || 'example.com', getActiveProject().scope || 'root');
    const sampleTarget = inf.ok ? inf.normalized : 'example.com';
    let sample = q.replaceAll('{target}', sampleTarget);
    if (!d.global && d.autoScope !== false && !/\bsite:/i.test(q) && !/\bcache:/i.test(sample)) sample = `site:${sampleTarget} ${sample}`;
    const syn = validateQuerySyntax(normalizeQuery(sample), !!d.global);
    if (!syn.ok) errs.push('Syntax: ' + syn.error);
    return { ok: errs.length === 0, errs, sample };
  }

  function openCustomEditor(existing, onSave) {
    modalForm(existing ? 'Edit Custom Dork' : 'Add Custom Dork', (api) => {
      const d = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid('cd'), label:'', query:'', category:'Custom', priority:'medium', description:'', tags:[], global:false, autoScope:true, notes:'' };
      const fLabel = el('input',{type:'text',value:d.label||''});
      const fCat = el('input',{type:'text',value:d.category||'Custom'});
      const fPri = el('select'); ['critical','high','medium','low','informational'].forEach(v=>fPri.appendChild(el('option',{value:v,text:v,selected:(d.priority||'medium')===v})));
      const fQuery = el('textarea'); fQuery.value = d.query||'';
      const fDesc = el('textarea'); fDesc.value = d.description||'';
      const fTags = el('input',{type:'text',value:(d.tags||[]).join(', ')});
      const fGlobal = el('input',{type:'checkbox'}); fGlobal.checked = !!d.global;
      const fAuto = el('input',{type:'checkbox'}); fAuto.checked = d.autoScope !== false;
      const preview = el('div',{class:'query-box'}); const errs = el('div',{class:'error-text'});
      const updatePreview = () => {
        d.label = fLabel.value; d.category = fCat.value; d.priority = fPri.value; d.query = fQuery.value; d.description = fDesc.value;
        d.tags = fTags.value.split(',').map(s=>s.trim()).filter(Boolean); d.global = fGlobal.checked; d.autoScope = fAuto.checked;
        const v = validateCustomDraft(d);
        preview.textContent = v.sample || '';
        errs.textContent = v.errs.join(' ');
      };
      [fLabel,fCat,fPri,fQuery,fDesc,fTags,fGlobal,fAuto].forEach(x=>{ x.addEventListener('input', updatePreview); x.addEventListener('change', updatePreview); });
      api.body.appendChild(el('div',{class:'form-grid'},[
        fieldWrap('Label', fLabel), fieldWrap('Category', fCat), fieldWrap('Priority', fPri), fieldWrap('Tags (comma-separated)', fTags),
        el('div',{class:'span-2'},[fieldWrap('Query template', fQuery, 'Use {target} for target-scoped queries. One query string.')]),
        el('div',{class:'span-2'},[fieldWrap('Description', fDesc)]),
        el('label',{class:'checkline'},[fGlobal, document.createTextNode(' Global discovery query (do not scope to target)')]),
        el('label',{class:'checkline'},[fAuto, document.createTextNode(' Auto-scope target queries when no site:/cache: is present')]),
      ]));
      api.body.appendChild(el('div',{class:'mt8'},[el('div',{class:'field-label',text:'Validation preview (sample)'}), preview, errs]));
      updatePreview();
      api.ok.addEventListener('click', () => {
        updatePreview(); const v = validateCustomDraft(d);
        if (!v.ok) { toast('Fix validation errors before saving.','err'); return; }
        onSave(d); api.close(d);
      });
    });
  }

  function openComposer() {
    modalForm('Visual Query Composer', (api) => {
      const fSite = el('input',{type:'checkbox'}); fSite.checked = true;
      const fTarget = el('input',{type:'text',value:'{target}'});
      const fOp = el('select'); ['(none)','inurl:','intitle:','intext:','filetype:','ext:'].forEach(v=>fOp.appendChild(el('option',{value:v,text:v})));
      const fTerm = el('input',{type:'text',placeholder:'keyword or "phrase"'});
      const fExtra = el('input',{type:'text',placeholder:'additional terms e.g. (login OR signin)'});
      const out = el('div',{class:'query-box'});
      const build = () => {
        const parts = [];
        if (fSite.checked && fTarget.value.trim()) parts.push('site:' + fTarget.value.trim());
        if (fOp.value !== '(none)' && fTerm.value.trim()) parts.push(fOp.value + fTerm.value.trim());
        else if (fTerm.value.trim()) parts.push(fTerm.value.trim());
        if (fExtra.value.trim()) parts.push(fExtra.value.trim());
        out.textContent = parts.join(' ').trim();
      };
      [fSite,fTarget,fOp,fTerm,fExtra].forEach(x=>{ x.addEventListener('input', build); x.addEventListener('change', build); });
      api.body.appendChild(el('div',{class:'form-grid'},[
        el('label',{class:'checkline'},[fSite, document.createTextNode(' Include site scope')]),
        fieldWrap('Target/scope token', fTarget), fieldWrap('Operator', fOp), fieldWrap('Term/value', fTerm),
        el('div',{class:'span-2'},[fieldWrap('Additional terms', fExtra)])
      ]));
      api.body.appendChild(el('div',{class:'mt8'},[el('div',{class:'field-label',text:'Generated query string'}), out]));
      build();
      api.ok.textContent = 'Add as custom dork';
      api.ok.addEventListener('click', () => {
        const q = out.textContent.trim(); if (!q) { toast('Compose a query first.','warn'); return; }
        const st = getState(); const p = getActiveProject(st); p.customDorks = p.customDorks || [];
        p.customDorks.push({ id: uid('cd'), label: 'Composed query', query: q, category: 'Custom', priority: 'medium', description: 'Created with visual composer.', tags: [], global: !q.includes('{target}') && !fSite.checked, autoScope: fSite.checked ? false : true });
        setState(st); toast('Custom dork added.'); api.close(true); if (getState().ui.view === 'custom') navigate('custom');
      });
    });
  }

  async function importCustomTemplates() {
    const inp = el('input',{type:'file',accept:'.json,application/json'});
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.customDorks) ? parsed.customDorks : null);
        if (!arr) throw new Error('Expected a JSON array of custom dork templates.');
        const st = getState(); const p = getActiveProject(st); p.customDorks = p.customDorks || [];
        let added = 0;
        arr.forEach(x => {
          if (!x || typeof x !== 'object') return;
          const item = {
            id: uid('cd'), label: String(x.label||'Imported').slice(0,120), query: String(x.query||'').slice(0,2000),
            category: String(x.category||'Custom').slice(0,80), priority: ['critical','high','medium','low','informational'].includes(x.priority)?x.priority:'medium',
            description: String(x.description||'').slice(0,500), tags: Array.isArray(x.tags)?x.tags.map(t=>String(t).slice(0,40)).slice(0,20):[],
            global: !!x.global, autoScope: x.autoScope !== false
          };
          if (!item.query.trim()) return;
          p.customDorks.push(item); added++;
        });
        setState(st); toast(`Imported ${added} custom template(s).`); navigate('custom');
      } catch (e) { toast('Import failed: ' + e.message, 'err'); }
    });
    inp.click();
  }

  // ---------- Projects ----------
  function renderProjects(root) {
    const st = getState();
    const head = panel('Project & Workspace Management', 'Multiple local reconnaissance workspaces (browser storage)');
    head._body.appendChild(el('div',{class:'desc',text:'Projects, queries, notes, and history are stored locally in your browser (localStorage) and may persist until cleared. No target data is sent to application servers.'}));
    head._body.appendChild(el('div',{class:'actions mt8'},[
      btn('Create project', ()=> createProjectFlow()),
      btn('Import project (JSON)', ()=> importProject(), 'secondary'),
      btn('Export active project', ()=> exportProject(getActiveProject()), 'secondary')
    ]));
    root.appendChild(head);

    const listP = panel('Projects', `${st.projects.length} workspace(s)`);
    const list = el('div',{class:'list'});
    st.projects.slice().sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||'')).forEach(p => {
      const active = p.id === st.activeProjectId;
      const card = el('div',{class:'card-item' + (active?' selected':'')});
      card.appendChild(el('div',{class:'item-head'},[
        el('div',{},[
          el('div',{class:'item-title',text:p.name + (active?' (active)':'')}),
          el('div',{class:'muted tiny',text:`Target: ${p.target||'—'} • Scope: ${p.scope} • Engine: ${p.engine} • Queries: ${(p.generated||[]).length} • Updated: ${fmtDate(p.updatedAt)}`})
        ]),
        el('div',{class:'actions'},[
          btn('Open', ()=>{ const s=getState(); s.activeProjectId=p.id; setState(s); renderShellState(); navigate('dashboard'); }, 'secondary'),
          btn('Rename', async ()=>{ const name = await promptText('Rename project', 'Project name', p.name); if(name==null) return; p.name = name.trim()||p.name; p.updatedAt=nowIso(); setState(getState()); renderShellState(); navigate('projects'); }, 'secondary'),
          btn('Duplicate', ()=>{ const copy = JSON.parse(JSON.stringify(p)); copy.id=uid('prj'); copy.name=p.name+' (copy)'; copy.createdAt=nowIso(); copy.updatedAt=nowIso(); const s=getState(); s.projects.push(copy); setState(s); navigate('projects'); toast('Project duplicated.'); }, 'secondary'),
          btn('Export', ()=> exportProject(p), 'secondary'),
          btn('Delete', async ()=>{ if (getState().projects.length<=1) return toast('At least one project is required.','warn'); const ok = await confirmDialog('Delete project', `Delete "${p.name}"? This removes its local workspace data.`, 'Delete', true); if(!ok) return; const s=getState(); s.projects = s.projects.filter(x=>x.id!==p.id); if (s.activeProjectId===p.id) s.activeProjectId=s.projects[0].id; setState(s); renderShellState(); navigate('projects'); }, 'danger')
        ])
      ]));
      // notes
      const notes = el('textarea'); notes.value = p.notes || ''; notes.placeholder = 'Manual investigation notes for this project...';
      notes.addEventListener('change', ()=>{ p.notes = notes.value; p.updatedAt=nowIso(); setState(getState()); toast('Project notes saved.'); });
      card.appendChild(el('div',{class:'mt8'},[el('div',{class:'field-label',text:'Analyst notes'}), notes]));
      list.appendChild(card);
    });
    listP._body.appendChild(list);
    root.appendChild(el('div',{class:'mt12'},[listP]));
  }

  function promptText(title, label, value='') {
    return modalForm(title, (api) => {
      const inp = el('input',{type:'text',value});
      api.body.appendChild(fieldWrap(label, inp));
      api.ok.addEventListener('click', ()=> api.close(inp.value));
      setTimeout(()=>inp.focus(), 0);
    });
  }

  function createProjectFlow() {
    modalForm('Create Project', (api) => {
      const name = el('input',{type:'text',placeholder:'e.g. Example Security Assessment'});
      const target = el('input',{type:'text',value:'example.com'});
      const scope = el('select'); [['root','Root domain'],['root_sub','Root domain and subdomains'],['exact','Exact hostname'],['custom','Custom scope']].forEach(([v,l])=>scope.appendChild(el('option',{value:v,text:l})));
      api.body.appendChild(el('div',{class:'form-grid'},[fieldWrap('Project name', name), fieldWrap('Target domain', target), fieldWrap('Scope', scope)]));
      api.ok.addEventListener('click', ()=>{
        const inf = normalizeTargetInput(target.value, scope.value);
        if (!name.value.trim()) return toast('Project name required.','err');
        if (!inf.ok) return toast(inf.error,'err');
        const st = getState(); const settings = getSettings();
        const p = defaultProject(settings);
        p.name = name.value.trim(); p.target = inf.normalized; p.scope = scope.value;
        st.projects.push(p); st.activeProjectId = p.id; setState(st); renderShellState(); api.close(p); navigate('projects'); toast('Project created.');
      });
    });
  }

  function exportProject(p) {
    const data = { type: 'dorking-tool-project', version: 2, exportedAt: nowIso(), project: p };
    downloadFile(safeName(p.name)+'.json', JSON.stringify(data, null, 2), 'application/json');
  }
  function importProject() {
    const inp = el('input',{type:'file',accept:'.json,application/json'});
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      try {
        const text = await file.text(); const parsed = JSON.parse(text);
        const proj = parsed && parsed.project ? parsed.project : (parsed && parsed.type === 'dorking-tool-project' ? parsed : parsed);
        if (!proj || typeof proj !== 'object' || !proj.name) throw new Error('Invalid project file.');
        const clean = sanitizeProject(proj);
        const st = getState(); st.projects.push(clean); st.activeProjectId = clean.id; setState(st); renderShellState(); navigate('projects'); toast('Project imported.');
      } catch (e) { toast('Project import failed: ' + e.message, 'err'); }
    }); inp.click();
  }
  function sanitizeProject(p) {
    const settings = getSettings();
    const allowedMods = new Set(DATA.MODULES.map(m=>m.id));
    const proj = {
      id: uid('prj'),
      name: String(p.name||'Imported Project').slice(0,120),
      target: String(p.target||'example.com').slice(0,200),
      scope: ['root','root_sub','exact','custom'].includes(p.scope)?p.scope:'root',
      engine: (DATA.ENGINES.some(e=>e.id===p.engine)||p.engine==='custom')?p.engine:settings.defaultEngine,
      selectedModules: Array.isArray(p.selectedModules)?p.selectedModules.filter(m=>allowedMods.has(m)).slice(0,20):settings.defaultCategories.slice(),
      generated: Array.isArray(p.generated)?p.generated.map(sanitizeQuery).filter(Boolean).slice(0,2000):[],
      savedQueries: Array.isArray(p.savedQueries)?p.savedQueries.slice(0,2000):[],
      customDorks: Array.isArray(p.customDorks)?p.customDorks.map(sanitizeCustom).filter(Boolean).slice(0,500):[],
      notes: String(p.notes||'').slice(0,20000),
      createdAt: typeof p.createdAt==='string'?p.createdAt:nowIso(),
      updatedAt: nowIso(),
      lastPlaybook: p.lastPlaybook ? String(p.lastPlaybook).slice(0,120) : null
    };
    if (!proj.selectedModules.length) proj.selectedModules = settings.defaultCategories.slice();
    return proj;
  }
  function sanitizeQuery(q) {
    if (!q || typeof q!=='object') return null;
    const query = String(q.query||'').slice(0,2000).trim(); if(!query) return null;
    return {
      id: String(q.id||uid('q')), key: (q.key||query.toLowerCase()), label: String(q.label||'Query').slice(0,160),
      category: String(q.category||'Imported').slice(0,80), module: String(q.module||'custom').slice(0,40),
      priority: ['critical','high','medium','low','informational'].includes(q.priority)?q.priority:'informational',
      query, description: String(q.description||'').slice(0,500), explanation: String(q.explanation||'').slice(0,1000),
      operators: Array.isArray(q.operators)?q.operators.map(String).slice(0,30):detectOperators(query),
      enginesNote: String(q.enginesNote||'Varies by engine.').slice(0,300), global: !!q.global, source: q.source==='custom'?'custom':'preset',
      engineId: String(q.engineId||'google').slice(0,40), status: ['Not Reviewed','Reviewed','Interesting Lead','No Relevant Results','Requires Further Investigation'].includes(q.status)?q.status:'Not Reviewed',
      saved: !!q.saved, selected: q.selected !== false, notes: String(q.notes||'').slice(0,5000), tags: Array.isArray(q.tags)?q.tags.map(String).slice(0,20):[]
    };
  }
  function sanitizeCustom(c) {
    if (!c || typeof c!=='object') return null;
    const query = String(c.query||'').slice(0,2000).trim(); if(!query) return null;
    return { id: String(c.id||uid('cd')), label: String(c.label||'Custom').slice(0,120), query, category: String(c.category||'Custom').slice(0,80), priority: ['critical','high','medium','low','informational'].includes(c.priority)?c.priority:'medium', description: String(c.description||'').slice(0,500), tags: Array.isArray(c.tags)?c.tags.map(String).slice(0,20):[], global: !!c.global, autoScope: c.autoScope !== false };
  }

  // ---------- History ----------
  function renderHistory(root) {
    const h = getHistory();
    const p = panel('Reconnaissance History', 'Locally stored session history');
    p._body.appendChild(el('div',{class:'actions mb8'},[
      btn('Export history', ()=> downloadFile('dorking-tool-history.json', JSON.stringify(h, null, 2), 'application/json'), 'secondary'),
      btn('Clear history', async ()=>{ const ok = await confirmDialog('Clear history', 'Delete all local history entries?', 'Clear', true); if(!ok) return; setHistory([]); navigate('history'); toast('History cleared.'); }, 'danger')
    ]));
    const search = el('input',{type:'search',placeholder:'Search history by target, project, playbook, engine'});
    p._body.appendChild(fieldWrap('Search', search));
    const list = el('div',{class:'list mt8'}); p._body.appendChild(list);
    function renderList() {
      const term = search.value.trim().toLowerCase();
      const items = h.filter(x => !term || (x.target+' '+x.projectName+' '+(x.playbook||'')+' '+x.engine).toLowerCase().includes(term));
      clearEl(list);
      if (!items.length) { list.appendChild(el('div',{class:'empty',text:'No history entries.'})); return; }
      items.forEach(x => {
        const card = el('div',{class:'card-item'});
        card.appendChild(el('div',{class:'item-head'},[
          el('div',{},[el('div',{class:'item-title',text:`${x.target} — ${x.count} queries`}), el('div',{class:'muted tiny',text:`${fmtDate(x.at)} • Project: ${x.projectName||'—'} • ${x.playbook||'Manual'} • ${(DATA.ENGINES.find(e=>e.id===x.engine)||{label:x.engine}).label} • Modules: ${(x.modules||[]).length}`})]),
          el('div',{class:'actions'},[
            btn('Reopen', ()=> reopenHistory(x.id), 'secondary'),
            btn('Delete', ()=>{ const hh = getHistory().filter(i=>i.id!==x.id); setHistory(hh); navigate('history'); }, 'danger')
          ])
        ]));
        list.appendChild(card);
      });
    }
    search.addEventListener('input', renderList); renderList();
    root.appendChild(p);
  }

  function reopenHistory(id) {
    const h = getHistory(); const entry = h.find(x=>x.id===id); if(!entry) return toast('History entry not found.','err');
    const st = getState(); let p = st.projects.find(x=>x.id===entry.projectId);
    if (!p) { p = defaultProject(getSettings()); p.name = (entry.projectName||'Reopened') + ' (reopened)'; st.projects.push(p); }
    p.target = entry.target || p.target; p.scope = entry.scope || p.scope; p.engine = entry.engine || p.engine;
    if (Array.isArray(entry.modules) && entry.modules.length) p.selectedModules = entry.modules.filter(m=>DATA.MODULES.some(mm=>mm.id===m));
    st.activeProjectId = p.id; setState(st); renderShellState();
    generateForProject(p, { recordHistory: false, playbook: entry.playbook || null });
    navigate('workbench'); toast('History session reopened.');
  }

  // ---------- Cheatsheet ----------
  function renderCheatsheet(root) {
    const p = panel('Security Operator Cheatsheet 2.0', 'Interactive operator reference (support varies by search engine)');
    const search = el('input',{type:'search',placeholder:'Search operators, syntax, description'});
    p._body.appendChild(fieldWrap('Search', search));
    const groups = ['Domain','URL','Content','File','Date','Modifiers'];
    const container = el('div',{class:'mt8'}); p._body.appendChild(container);
    function render() {
      clearEl(container);
      const term = search.value.trim().toLowerCase();
      groups.forEach(g => {
        const ops = DATA.OPERATORS.filter(o => o.group===g).filter(o => !term || (o.op+' '+o.syntax+' '+o.desc+' '+o.example+' '+o.compat).toLowerCase().includes(term));
        if (!ops.length) return;
        container.appendChild(el('h3',{class:'panel-title mt12 mb8',text:g + ' operators'}));
        const list = el('div',{class:'op-list'});
        ops.forEach(o => {
          const item = el('div',{class:'op-item'});
          item.appendChild(el('div',{class:'op-head'},[el('div',{class:'op-name',text:o.op}), btn('Copy example', async()=>{ await copyText(o.example); toast('Example copied.'); }, 'secondary')]));
          item.appendChild(el('div',{class:'op-desc',text:o.desc}));
          item.appendChild(el('div',{class:'help',text:'Syntax: '})); item.lastChild.appendChild(el('code',{class:'code-inline',text:o.syntax}));
          item.appendChild(el('div',{class:'help mt8',text:'Example: '})); item.lastChild.appendChild(el('code',{class:'code-inline',text:o.example}));
          item.appendChild(el('div',{class:'tiny muted mt8',text:'Compatibility: ' + o.compat}));
          list.appendChild(item);
        });
        container.appendChild(list);
      });
      if (!container.children.length) container.appendChild(el('div',{class:'empty',text:'No operators match your search.'}));
      container.appendChild(el('div',{class:'help mt12',text:'Operator availability and behavior vary by engine and may change over time. This cheatsheet is a reference, not a guarantee of support.'}));
    }
    search.addEventListener('input', render); render();
    root.appendChild(p);
  }

  // ---------- Settings ----------
  function renderSettings(root) {
    const s = getSettings();
    const p = panel('Settings & Personalization', 'Defaults, preferences, and local data controls');
    const engine = el('select'); DATA.ENGINES.forEach(e=>engine.appendChild(el('option',{value:e.id,text:e.label,selected:s.defaultEngine===e.id}))); engine.appendChild(el('option',{value:'custom',text:'Custom URL template',selected:s.defaultEngine==='custom'}));
    const customUrl = el('input',{type:'url',value:s.customEngineUrl||'',placeholder:'https://search.example/?q={query}'});
    const scope = el('select'); [['root','Root domain'],['root_sub','Root domain and subdomains'],['exact','Exact hostname'],['custom','Custom scope']].forEach(([v,l])=>scope.appendChild(el('option',{value:v,text:l,selected:s.defaultScope===v})));
    const sort = el('select'); [['priority','Priority'],['category','Category'],['alpha','Alphabetical']].forEach(([v,l])=>sort.appendChild(el('option',{value:v,text:l,selected:s.defaultSort===v})));
    const perPage = el('input',{type:'number',value:String(s.resultsPerPage||100)}); perPage.min='10'; perPage.max='500';
    const autoSave = el('input',{type:'checkbox'}); autoSave.checked = !!s.autoSave;
    const modsWrap = el('div',{class:'small-grid'}); const modChecks = new Map();
    DATA.MODULES.forEach(m=>{ const cb = el('input',{type:'checkbox'}); cb.checked = (s.defaultCategories||[]).includes(m.id); modChecks.set(m.id, cb); modsWrap.appendChild(el('label',{class:'checkline'},[cb, document.createTextNode(' '+m.short)])); });

    p._body.appendChild(el('div',{class:'form-grid'},[
      fieldWrap('Default search engine', engine), fieldWrap('Custom search-engine URL template', customUrl, 'Use {query} placeholder. Applied when engine is "Custom URL".'),
      fieldWrap('Default reconnaissance scope', scope), fieldWrap('Default priority sorting', sort),
      fieldWrap('Results per page (Workbench)', perPage, '10–500'), el('div'),
      el('div',{class:'span-2'},[el('div',{class:'field-label',text:'Default query modules/categories'}), modsWrap]),
      el('label',{class:'checkline span-2'},[autoSave, document.createTextNode(' Auto-save workspace changes to local browser storage')])
    ]));
    p._body.appendChild(el('div',{class:'actions mt12'},[
      btn('Save settings', ()=>{
        const cats = Array.from(modChecks.entries()).filter(([,c])=>c.checked).map(([id])=>id);
        if (!cats.length) return toast('Select at least one default module.','warn');
        if (engine.value === 'custom' && !customUrl.value.includes('{query}')) return toast('Custom URL template must include {query}.','err');
        const ns = { ...s, defaultEngine: engine.value, customEngineUrl: customUrl.value.trim(), defaultScope: scope.value, defaultSort: sort.value, resultsPerPage: clamp(Number(perPage.value)||100,10,500), autoSave: !!autoSave.checked, defaultCategories: cats };
        setSettings(ns); renderShellState(); toast('Settings saved.');
      }),
      btn('Reset settings', async ()=>{ const ok = await confirmDialog('Reset settings', 'Restore default settings? Projects/history are not deleted.'); if(!ok) return; setSettings(defaultSettings()); navigate('settings'); renderShellState(); toast('Settings reset.'); }, 'secondary')
    ]));
    root.appendChild(p);

    const privacy = panel('Privacy & Local Data', 'Local-only architecture controls');
    privacy._body.appendChild(el('div',{class:'desc',text:'LOCAL-ONLY MODE: ACTIVE. All query generation, project data, history, and settings are processed and stored locally in this browser (localStorage). This application does not send targets to a backend, does not crawl targets, and does not scrape search results. Opening a query navigates to the selected search engine in your browser.'}));
    privacy._body.appendChild(el('div',{class:'actions mt8'},[
      btn('Export all local data', ()=>{
        const dump = { settings: getSettings(), state: getState(), history: getHistory(), exportedAt: nowIso(), app: 'dorking-tool-v2' };
        downloadFile('dorking-tool-local-data.json', JSON.stringify(dump, null, 2), 'application/json');
      }, 'secondary'),
      btn('Import preferences/settings', ()=> importSettings(), 'secondary'),
      btn('Clear all local application data', async ()=>{
        const ok = await confirmDialog('Clear all local data', 'This removes projects, history, and settings from this browser. Continue?', 'Clear all', true);
        if (!ok) return;
        try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(HISTORY_KEY); localStorage.removeItem(SETTINGS_KEY); } catch {}
        toast('Local data cleared.'); ensureSettings(); renderShellState(); navigate('dashboard');
      }, 'danger')
    ]));
    privacy._body.appendChild(el('div',{class:'help mt12',text:'Keyboard shortcuts: g = Reconnaissance, p = Playbooks, w = Workbench, Ctrl/Cmd+Enter = Generate.'}));
    root.appendChild(el('div',{class:'mt12'},[privacy]));
  }

  function importSettings() {
    const inp = el('input',{type:'file',accept:'.json,application/json'});
    inp.addEventListener('change', async ()=>{
      const file = inp.files && inp.files[0]; if(!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const s = parsed.settings || parsed;
        if (!s || typeof s !== 'object') throw new Error('Invalid settings JSON.');
        const d = defaultSettings();
        const ns = { ...d, ...s };
        ns.defaultCategories = Array.isArray(ns.defaultCategories)?ns.defaultCategories.filter(id=>DATA.MODULES.some(m=>m.id===id)):d.defaultCategories;
        if (!ns.defaultCategories.length) ns.defaultCategories = d.defaultCategories;
        if (!['google','bing','duckduckgo','custom'].includes(ns.defaultEngine)) ns.defaultEngine = d.defaultEngine;
        if (!['root','root_sub','exact','custom'].includes(ns.defaultScope)) ns.defaultScope = d.defaultScope;
        if (!['priority','category','alpha'].includes(ns.defaultSort)) ns.defaultSort = d.defaultSort;
        ns.resultsPerPage = clamp(Number(ns.resultsPerPage)||100,10,500);
        setSettings(ns); renderShellState(); navigate('settings'); toast('Settings imported.');
      } catch(e) { toast('Settings import failed: '+e.message, 'err'); }
    }); inp.click();
  }

  // ---------- Export ----------
  function openExportModal(items) {
    const proj = getActiveProject();
    modalForm('Export Reconnaissance Data', (api) => {
      const format = el('select'); [['txt','TXT - query list'],['csv','CSV - structured'],['json','JSON - full data'],['md','Markdown - worksheet']].forEach(([v,l])=>format.appendChild(el('option',{value:v,text:l})));
      const scopeSel = el('select'); [['view','Current filtered/shown items'],['selected','Selected items only'],['all','All generated items']].forEach(([v,l])=>scopeSel.appendChild(el('option',{value:v,text:l})));
      api.body.appendChild(el('div',{class:'form-grid'},[fieldWrap('Format', format), fieldWrap('Scope', scopeSel)]));
      api.body.appendChild(el('div',{class:'help mt8',text:'Exports include project/target metadata and manual statuses/notes. Generated queries are investigation leads, not confirmed findings.'}));
      api.ok.textContent = 'Export';
      api.ok.addEventListener('click', () => {
        let data = items || [];
        if (scopeSel.value === 'selected') data = getActiveProject().generated.filter(q=>q.selected);
        else if (scopeSel.value === 'all') data = getActiveProject().generated.slice();
        if (!data.length) return toast('No queries to export.','warn');
        doExport(format.value, proj, data);
        api.close(true);
      });
    });
  }

  function doExport(format, project, items) {
    const info = normalizeTargetInput(project.target||'', project.scope||'root');
    const meta = { project: project.name, target: project.target, scope: info.ok?info.scopeLabel:project.scope, generatedAt: nowIso(), engine: project.engine, categories: (project.selectedModules||[]).map(id=> (DATA.MODULES.find(m=>m.id===id)||{short:id}).short), total: items.length };
    const base = safeName(project.name) + '-recon';
    if (format === 'txt') {
      const lines = [ `# ${meta.project}`, `Target: ${meta.target}`, `Scope: ${meta.scope}`, `Generated: ${meta.generatedAt}`, `Engine: ${meta.engine}`, `Total: ${meta.total}`, '', ...items.map((q,i)=> `${i+1}. [${q.priority}] ${q.label}\n${q.query}\nStatus: ${q.status}\n`) ];
      downloadFile(base+'.txt', lines.join('\n'), 'text/plain');
    } else if (format === 'csv') {
      const cols = ['id','label','category','priority','global','query','description','status','notes','engine'];
      const rows = [cols.join(',')].concat(items.map(q => cols.map(c => csvCell(q[c] ?? (c==='engine'?project.engine:''))).join(',')));
      downloadFile(base+'.csv', rows.join('\n'), 'text/csv');
    } else if (format === 'json') {
      downloadFile(base+'.json', JSON.stringify({ meta, disclaimer: 'Generated search queries are investigation leads, not confirmed security findings.', queries: items }, null, 2), 'application/json');
    } else if (format === 'md') {
      const md = [];
      md.push(`# Reconnaissance Worksheet — ${meta.project}`);
      md.push('');
      md.push(`- **Target:** ${meta.target}`);
      md.push(`- **Scope:** ${meta.scope}`);
      md.push(`- **Generated:** ${fmtDate(meta.generatedAt)}`);
      md.push(`- **Search engine:** ${meta.engine}`);
      md.push(`- **Selected modules:** ${meta.categories.join(', ') || '—'}`);
      md.push(`- **Total queries:** ${meta.total}`);
      md.push('');
      md.push('> Disclaimer: Generated search queries are investigation leads, not confirmed security findings. Status/notes are manually assigned by the analyst.');
      md.push('');
      items.forEach((q,i)=>{
        md.push(`## ${i+1}. ${q.label}`);
        md.push(`- **Category:** ${q.category}`);
        md.push(`- **Priority:** ${q.priority} (indicator, not vulnerability severity)`);
        md.push(`- **Scope type:** ${q.global?'Global discovery':'Target-scoped'}`);
        md.push(`- **Manual status:** ${q.status}`);
        md.push(`- **Query:** \`${q.query}\``);
        if (q.description) md.push(`- **Description:** ${q.description}`);
        if (q.notes) md.push(`- **Analyst notes:** ${q.notes}`);
        md.push('');
      });
      downloadFile(base+'.md', md.join('\n'), 'text/markdown');
    }
    toast('Export created.');
  }
  function csvCell(v) { const s = String(v == null ? '' : v).replace(/"/g,'""'); return `"${s}"`; }
  function safeName(s) { return String(s||'export').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'export'; }

  // ---------- Imported feature helpers (packs, archive, tools) ----------
  async function apiGet(path) {
    const r = await fetch(path, { headers: { 'Accept': 'application/json' } });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch { j = { ok: false, error: t || 'Invalid response' }; }
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  }

  function normalizePackLineToQuery(line, packName) {
    let q = String(line || '').trim();
    if (!q) return '';
    // Adapt common placeholders from imported packs
    if (/\bsite\.com\b/i.test(q)) q = q.replace(/\bsite\.com\b/gi, '{target}');
    if (/Name Or Username/i.test(q)) q = q.replace(/Name Or Username/gi, '{keyword}');
    if (/\bName\b/.test(q) && /People|User/i.test(packName || '')) q = q.replace(/\bName\b/g, '{keyword}');
    return q.trim();
  }

  function inferPackMeta(packName) {
    const n = (packName || '').toLowerCase();
    if (n.includes('social')) return { category: 'Imported - Socials', global: true, tags: ['imported','socials','username'] };
    if (n.includes('people') || n.includes('user')) return { category: 'Imported - People/Username', global: true, tags: ['imported','people','username'] };
    return { category: 'Imported - Website', global: false, tags: ['imported','website'] };
  }

  async function importDorkPackLines(lines, packName) {
    const st = getState(); const p = getActiveProject(st); p.customDorks = p.customDorks || [];
    const meta = inferPackMeta(packName);
    let added = 0;
    (lines || []).forEach((line, idx) => {
      const q = normalizePackLineToQuery(line, packName);
      if (!q) return;
      p.customDorks.push({
        id: uid('cd'),
        label: `${packName || 'Pack'} ${idx + 1}`,
        query: q,
        category: meta.category,
        priority: 'medium',
        description: `Imported from ${packName || 'dork pack'}. Review and adjust placeholders ({target}/{keyword}) as needed.`,
        tags: meta.tags.slice(),
        global: meta.global,
        autoScope: !meta.global
      });
      added++;
    });
    setState(st);
    toast(`Imported ${added} dork(s) from ${packName || 'pack'}. Use Bulk Replace if you need to adjust placeholders.`);
    if (getState().ui.view === 'custom') navigate('custom');
  }

  async function importDorkPackFile() {
    const inp = el('input',{type:'file',accept:'.txt,text/plain'});
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (!lines.length) return toast('No dork lines found in file.','warn');
        await importDorkPackLines(lines, file.name.replace(/\.txt$/i,''));
      } catch (e) { toast('Failed to import pack: ' + e.message, 'err'); }
    });
    inp.click();
  }

  async function loadBuiltinDorkPacks() {
    try {
      // Prefer server-provided packs when running via Python server
      const data = await apiGet('/api/dorkpacks');
      const packs = (data && data.packs) || [];
      if (!packs.length) { toast('No built-in packs available.','warn'); return; }
      modalForm('Load Built-in Dork Packs', (api) => {
        const list = el('div',{class:'list'});
        const checks = new Map();
        packs.forEach(pk => {
          const cb = el('input',{type:'checkbox'});
          checks.set(pk.file, cb);
          list.appendChild(el('label',{class:'card-item'},[
            el('div',{class:'item-head'},[
              el('div',{},[el('div',{class:'item-title',text:pk.name}), el('div',{class:'muted tiny',text:`${pk.count} queries • ${pk.file}`})]),
              cb
            ])
          ]));
        });
        api.body.appendChild(el('div',{class:'desc mb8',text:'Select packs to import as custom dorks into the active project. Placeholders are normalized (site.com → {target}, Name Or Username → {keyword}).'}));
        api.body.appendChild(list);
        api.ok.textContent = 'Import selected';
        api.ok.addEventListener('click', async () => {
          let total = 0;
          for (const pk of packs) {
            if (!checks.get(pk.file) || !checks.get(pk.file).checked) continue;
            await importDorkPackLines(pk.lines || [], pk.name);
            total += (pk.lines || []).length;
          }
          if (!total) toast('No packs selected.','warn');
          api.close(true);
        });
      });
    } catch (e) {
      toast('Built-in packs require the Python server mode (python server.py). You can still import .txt packs manually.', 'warn');
    }
  }

  function categorizeUrlByRules(url, rules) {
    const u = String(url || '').toLowerCase();
    for (const [cat, keywords] of Object.entries(rules || {})) {
      if (!Array.isArray(keywords)) continue;
      for (const kw of keywords) {
        if (kw && u.includes(String(kw).toLowerCase())) return cat;
      }
    }
    return 'Other';
  }

  async function loadResultsStructure() {
    try {
      const data = await apiGet('/api/dorkpacks');
      return (data && data.results_structure) || {};
    } catch {
      // try local file fetch (works when served, may work in some file contexts)
      try { const r = await fetch('ResultsStructure.json'); if (r.ok) return await r.json(); } catch {}
      return {
        "Socials": ["instagram.com", "facebook.com", "twitter.com", "tiktok.com", "snapchat.com", "pinterest.com"],
        "Work": ["linkedin.com", "glassdoor.com", "indeed.com", "crunchbase.com"],
        "Forums": ["reddit.com", "4chan.org", "forum", "disqus.com"],
        "News": ["nytimes.com", "cnn.com", "bbc.co.uk", "theguardian.com"],
        "Vulnerabilities": ["exploit-db.com", "packetstormsecurity.com", "securityfocus.com", "vulndb.com"],
        "GitHub": ["github.com", "gitlab.com", "bitbucket.org"],
        "Personal": ["about.me", "whitepages.com", "spokeo.com", "peoplesearch.com"]
      };
    }
  }

  // ---------- Archive / Tools (inspired by Gui-Dorking, passive/local-safe) ----------
  function renderArchive(root) {
    const wrap = el('div', { class: 'grid' });

    // Wayback archive lookup
    const arch = panel('Wayback Archive Lookup', 'Passive lookup of archived URLs via Wayback CDX API (server-side when using Python server)');
    const dom = el('input',{type:'text',placeholder:'example.com'});
    const status = el('div',{class:'help mt8',text:'Enter a domain and fetch archived URLs. Best used in Python server mode (/api/archive).'});
    const filterIn = el('input',{type:'search',placeholder:'Filter archived URLs'});
    const listWrap = el('div',{class:'list mt8'});
    let archiveUrls = [];
    function renderArchiveList() {
      clearEl(listWrap);
      const term = (filterIn.value || '').toLowerCase().trim();
      const filtered = archiveUrls.filter(u => !term || u.toLowerCase().includes(term));
      const max = 500;
      status.textContent = `${filtered.length} shown / ${archiveUrls.length} fetched`;
      if (!filtered.length) { listWrap.appendChild(el('div',{class:'empty',text:'No archive URLs.'})); return; }
      filtered.slice(0,max).forEach(u => {
        const row = el('div',{class:'card-item'});
        const safe = safeHref(/^https?:\/\//i.test(u) ? u : ('http://' + u));
        row.appendChild(el('div',{class:'item-head'},[
          el('div',{class:'query-box',text:u}),
          el('div',{class:'actions'},[
            btn('Open', ()=>{ if(safe) window.open(safe,'_blank','noopener,noreferrer'); else toast('Invalid URL','err'); }, 'secondary'),
            btn('Copy', async()=>{ await copyText(u); toast('Copied.'); }, 'secondary')
          ])
        ]));
        listWrap.appendChild(row);
      });
      if (filtered.length > max) listWrap.appendChild(el('div',{class:'help mt8',text:`Showing first ${max} results. Use filter to narrow.`}));
    }
    filterIn.addEventListener('input', renderArchiveList);
    arch._body.appendChild(el('div',{class:'form-grid'},[
      fieldWrap('Domain', dom, 'e.g. example.com'),
      el('div',{class:'actions', style:'align-items:end;'},[
        btn('Fetch archive URLs', async ()=>{
          const d = dom.value.trim();
          if (!d) return toast('Enter a domain.','err');
          status.textContent = 'Fetching archive URLs...';
          archiveUrls = [];
          renderArchiveList();
          try {
            const j = await apiGet('/api/archive?domain=' + encodeURIComponent(d));
            archiveUrls = Array.isArray(j.urls) ? j.urls : [];
            status.textContent = `Fetched ${j.count || archiveUrls.length} URL(s)` + (j.truncated ? ' (truncated)' : '') + '.';
            renderArchiveList();
          } catch (e) {
            status.textContent = 'Archive fetch failed. If you opened index.html directly, run Python server mode (python server.py) and open http://127.0.0.1:8765/ for server-side archive lookup.';
            toast('Archive fetch failed: ' + e.message, 'err');
          }
        }),
        btn('Copy all shown', async ()=>{
          const term = (filterIn.value || '').toLowerCase().trim();
          const filtered = archiveUrls.filter(u => !term || u.toLowerCase().includes(term));
          if (!filtered.length) return toast('Nothing to copy.','warn');
          await copyText(filtered.join('\n')); toast(`Copied ${filtered.length} URL(s).`);
        }, 'secondary'),
        btn('Export shown', ()=>{
          const term = (filterIn.value || '').toLowerCase().trim();
          const filtered = archiveUrls.filter(u => !term || u.toLowerCase().includes(term));
          if (!filtered.length) return toast('Nothing to export.','warn');
          downloadFile(safeName(dom.value||'archive')+'-archive-urls.txt', filtered.join('\n'), 'text/plain');
        }, 'secondary')
      ])
    ]));
    arch._body.appendChild(status);
    arch._body.appendChild(el('div',{class:'mt8'},[fieldWrap('Filter', filterIn)]));
    arch._body.appendChild(listWrap);

    // URL categorizer (from ResultsStructure rules)
    const catPanel = panel('URL Categorizer', 'Categorize a list of URLs using ResultsStructure rules (Socials/Work/Forums/News/Vulnerabilities/GitHub/Personal)');
    const urlsIn = el('textarea',{placeholder:'Paste URLs here, one per line'});
    const catOut = el('div',{class:'list mt8'});
    catPanel._body.appendChild(fieldWrap('URLs (one per line)', urlsIn));
    catPanel._body.appendChild(el('div',{class:'actions mt8'},[
      btn('Categorize', async ()=>{
        const rules = await loadResultsStructure();
        const lines = urlsIn.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        const groups = {};
        lines.forEach(u => { const c = categorizeUrlByRules(u, rules); (groups[c] = groups[c] || []).push(u); });
        clearEl(catOut);
        const cats = Object.keys(groups).sort();
        if (!cats.length) { catOut.appendChild(el('div',{class:'empty',text:'No URLs to categorize.'})); return; }
        cats.forEach(c => {
          const section = el('div',{class:'card-item'});
          section.appendChild(el('div',{class:'item-head'},[el('div',{class:'item-title',text:`${c} (${groups[c].length})`}), btn('Copy', async()=>{ await copyText(groups[c].join('\n')); toast('Copied.'); }, 'secondary')]));
          section.appendChild(el('div',{class:'query-box',text:groups[c].slice(0,20).join('\n') + (groups[c].length>20?`\n... +${groups[c].length-20} more`:'' )}));
          catOut.appendChild(section);
        });
      }, 'secondary')
    ]));
    catPanel._body.appendChild(catOut);

    // Dork packs quick info
    const packsPanel = panel('Dork Packs (imported from Gui-Dorking resources)', 'Load website/social/people-username dork templates into Custom Dorks');
    packsPanel._body.appendChild(el('div',{class:'desc',text:'Built-in packs are available in Python server mode via /api/dorkpacks (from ./dorks/*.txt). You can also import any .txt dork file in Custom Dorks. Placeholders like site.com and "Name Or Username" are normalized to {target}/{keyword} on import.'}));
    packsPanel._body.appendChild(el('div',{class:'actions mt8'},[
      btn('Go to Custom Dorks', ()=> navigate('custom')),
      btn('Try load built-in packs', ()=> { navigate('custom'); setTimeout(()=>loadBuiltinDorkPacks(), 50); }, 'secondary')
    ]));

    wrap.appendChild(arch);
    wrap.appendChild(catPanel);
    wrap.appendChild(packsPanel);
    root.appendChild(wrap);
  }

  // ---------- boot ----------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
