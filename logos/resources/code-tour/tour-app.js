/* Code Tour Explorer — 读取内嵌 TOUR 数据，渲染概览/架构/依赖/执行流/模块/阅读路线六视图。 */
const TOUR = __TOUR__;

/* ── 基础工具 ─────────────────────────────────────────── */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  (children || []).forEach(child => {
    if (child === null || child === undefined || child === false) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

const LAYER_LABELS = {
  protocol: '协议适配', runtime: '运行时', storage: '存储',
  extension: '扩展', host: '宿主', external: '外部',
};
const LANE_ORDER = ['external', 'host', 'runtime', 'protocol', 'storage'];
const VIEW_TITLES = {
  overview: '概览', architecture: '系统架构', deps: '依赖图',
  flows: '执行流', modules: '模块浏览器', path: '阅读路线',
};

function layerClass(layer) { return 'layer-' + layer; }
function verBadge(verification) {
  if (!verification) return '';
  const label = { verified: '已验证', partial: '部分验证', unverified: '未验证' }[verification] || verification;
  return el('span', { class: 'badge ' + verification, text: label });
}
function fileBtn(path) {
  if (!path) return null;
  return el('button', {
    class: 'file-link', type: 'button', 'data-file': path, text: path,
    title: '点击复制路径',
  });
}

let toastTimer = null;
function toast(message) {
  let node = $('.toast');
  if (!node) { node = el('div', { class: 'toast' }); document.body.appendChild(node); }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
}

function copyText(text) {
  const done = () => toast('已复制：' + text);
  const fail = () => toast(text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fail);
  } else { fail(); }
}

/* ── 状态与历史 ───────────────────────────────────────── */
const state = {
  view: 'overview',
  flowId: null,
  depsMode: 'main',
  sel: null,          // { kind, id, flowId? }
  history: [],
};

const STORAGE_KEY = 'dsh-code-tour-state';
function saveState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      view: state.view, flowId: state.flowId, depsMode: state.depsMode, sel: state.sel,
    }));
  } catch (err) { /* 隐身模式等场景下 sessionStorage 不可用，状态保持降级为内存态 */ }
}
function restoreState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && VIEW_TITLES[saved.view]) {
      state.view = saved.view;
      state.flowId = saved.flowId || null;
      state.depsMode = saved.depsMode || 'main';
      state.sel = saved.sel || null;
    }
  } catch (err) { /* 损坏的存档视为无状态 */ }
}

function snapshot() {
  return { view: state.view, flowId: state.flowId, depsMode: state.depsMode, sel: state.sel };
}
function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 60) state.history.shift();
}
function goBack() {
  const prev = state.history.pop();
  if (!prev) { toast('已在最上层'); return; }
  state.view = prev.view;
  state.flowId = prev.flowId;
  state.depsMode = prev.depsMode;
  state.sel = prev.sel;
  render();
}
function apply(next) {
  pushHistory();
  Object.assign(state, next);
  saveState();
  render();
}

/* ── 数据索引 ─────────────────────────────────────────── */
const overviewById = {};
TOUR.overviewNodes.forEach(node => { overviewById[node.id] = node; });
const moduleById = {};
TOUR.modules.forEach(mod => { moduleById[mod.id] = mod; });
const flowById = TOUR.flows || {};

function flowsForModule(moduleId) {
  return Object.keys(flowById).filter(flowId =>
    flowById[flowId].nodes.some(node => node.crate === moduleId));
}
function flowNodeNeighbors(flowId, nodeId) {
  const flow = flowById[flowId];
  const ups = [];
  const downs = [];
  flow.edges.forEach(edge => {
    const from = Array.isArray(edge) ? edge[0] : edge.from;
    const to = Array.isArray(edge) ? edge[1] : edge.to;
    if (to === nodeId) ups.push(from);
    if (from === nodeId) downs.push(to);
  });
  return {
    ups: ups.map(id => flow.nodes.find(node => node.id === id)),
    downs: downs.map(id => flow.nodes.find(node => node.id === id)),
  };
}

/* ── 顶栏 ─────────────────────────────────────────────── */
function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  Object.keys(VIEW_TITLES).forEach(view => {
    const button = el('button', {
      'data-view': view,
      class: view === state.view ? 'active' : '',
      text: VIEW_TITLES[view],
    });
    tabs.appendChild(button);
  });
}

/* ── 详情面板 ─────────────────────────────────────────── */
function relItem(kind, id, label) {
  return el('li', {}, [el('button', {
    class: 'rel-link', type: 'button',
    'data-kind': kind, 'data-id': id, text: label,
  })]);
}

function renderDetail() {
  const box = $('#detail');
  box.innerHTML = '';
  const sel = state.sel;
  if (!sel) {
    box.appendChild(el('div', { class: 'detail-empty', text: '点击图中的节点，查看职责、文件、符号与证据。' }));
    return;
  }
  const wrap = el('div', { class: 'detail' });
  if (sel.kind === 'overview-node') {
    const node = overviewById[sel.id];
    if (!node) { box.appendChild(el('div', { class: 'detail-empty', text: '未知节点' })); return; }
    wrap.appendChild(el('h3', { text: node.label }));
    wrap.appendChild(el('div', {}, [verBadge(node.verification), ' ', el('span', { class: 'chip ' + layerClass(node.layer), text: LAYER_LABELS[node.layer] || node.layer })]));
    const dl = el('dl');
    dl.appendChild(el('dt', { text: '职责' }));
    dl.appendChild(el('dd', { text: node.responsibility || '—' }));
    if (node.keyFiles && node.keyFiles.length) {
      dl.appendChild(el('dt', { text: '关键文件' }));
      const dd = el('dd');
      node.keyFiles.forEach(path => dd.appendChild(el('div', {}, [fileBtn(path)])));
      dl.appendChild(dd);
    }
    if (node.keySymbols && node.keySymbols.length) {
      dl.appendChild(el('dt', { text: '关键符号' }));
      dl.appendChild(el('dd', {}, node.keySymbols.map(sym => el('div', { class: 'sym', text: sym }))));
    }
    dl.appendChild(el('dt', { text: '上游（它调用的组件）' }));
    const depsList = el('dd', {}, [el('ul', { class: 'rel-list' })]);
    const depsUl = depsList.firstChild;
    (node.dependsOn || []).forEach(id => depsUl.appendChild(relItem('overview-node', id, (overviewById[id] || {}).label || id)));
    if (!(node.dependsOn || []).length) depsUl.appendChild(el('li', { text: '—', style: 'color:var(--text-faint)' }));
    dl.appendChild(depsList);
    dl.appendChild(el('dt', { text: '下游（调用它的组件）' }));
    const usedList = el('dd', {}, [el('ul', { class: 'rel-list' })]);
    const usedUl = usedList.firstChild;
    (node.usedBy || []).forEach(id => usedUl.appendChild(relItem('overview-node', id, (overviewById[id] || {}).label || id)));
    if (!(node.usedBy || []).length) usedUl.appendChild(el('li', { text: '—', style: 'color:var(--text-faint)' }));
    dl.appendChild(usedList);
    wrap.appendChild(dl);
    if (node.evidence) wrap.appendChild(el('div', { class: 'evidence-block', text: '证据：' + node.evidence }));
  } else if (sel.kind === 'module') {
    const mod = moduleById[sel.id];
    if (!mod) { box.appendChild(el('div', { class: 'detail-empty', text: '未知模块' })); return; }
    wrap.appendChild(el('h3', { text: mod.id }));
    wrap.appendChild(el('div', {}, [verBadge(mod.verification), ' ', el('span', { class: 'chip ' + layerClass(mod.role), text: LAYER_LABELS[mod.role] || mod.role })]));
    const dl = el('dl');
    dl.appendChild(el('dt', { text: '职责' }));
    dl.appendChild(el('dd', { text: mod.responsibility || '—' }));
    if (mod.keyFiles && mod.keyFiles.length) {
      dl.appendChild(el('dt', { text: '关键文件' }));
      const dd = el('dd');
      mod.keyFiles.forEach(path => dd.appendChild(el('div', {}, [fileBtn(path)])));
      dl.appendChild(dd);
    }
    if (mod.keySymbols && mod.keySymbols.length) {
      dl.appendChild(el('dt', { text: '关键符号' }));
      dl.appendChild(el('dd', {}, mod.keySymbols.map(sym => el('div', { class: 'sym', text: sym }))));
    }
    if (mod.entryPoints && mod.entryPoints.length) {
      dl.appendChild(el('dt', { text: '入口' }));
      const dd = el('dd');
      mod.entryPoints.forEach(path => dd.appendChild(el('div', {}, [fileBtn(path)])));
      dl.appendChild(dd);
    }
    dl.appendChild(el('dt', { text: '直接依赖（manifest）' }));
    const depsWrap = el('dd', {}, [el('ul', { class: 'rel-list' })]);
    const depsUl = depsWrap.firstChild;
    (mod.deps || []).forEach(id => depsUl.appendChild(relItem('module', id, id)));
    if (!(mod.deps || []).length) depsUl.appendChild(el('li', { text: '—', style: 'color:var(--text-faint)' }));
    dl.appendChild(depsWrap);
    dl.appendChild(el('dt', { text: '被依赖（dependents）' }));
    const depsOnWrap = el('dd', {}, [el('ul', { class: 'rel-list' })]);
    const depOnUl = depsOnWrap.firstChild;
    (mod.dependents || []).forEach(id => depOnUl.appendChild(relItem('module', id, id)));
    if (!(mod.dependents || []).length) depOnUl.appendChild(el('li', { text: '—', style: 'color:var(--text-faint)' }));
    dl.appendChild(depsOnWrap);
    const related = flowsForModule(sel.id);
    if (related.length) {
      dl.appendChild(el('dt', { text: '相关执行流' }));
      const flowWrap = el('dd', {}, [el('ul', { class: 'rel-list' })]);
      const flowUl = flowWrap.firstChild;
      related.forEach(flowId => flowUl.appendChild(el('li', {}, [el('button', {
        class: 'rel-link', type: 'button', 'data-flow': flowId, text: flowById[flowId].title,
      })])));
      dl.appendChild(flowWrap);
    }
    wrap.appendChild(dl);
    if (mod.evidence) wrap.appendChild(el('div', { class: 'evidence-block', text: '证据：' + mod.evidence }));
  } else if (sel.kind === 'flow-node') {
    const flow = flowById[sel.flowId];
    const node = flow && flow.nodes.find(item => item.id === sel.id);
    if (!node) { box.appendChild(el('div', { class: 'detail-empty', text: '未知步骤' })); return; }
    wrap.appendChild(el('h3', { text: node.label }));
    wrap.appendChild(el('div', {}, [verBadge(node.verification)]));
    const dl = el('dl');
    dl.appendChild(el('dt', { text: '所在模块' }));
    const crateDd = el('dd');
    if (node.crate && moduleById[node.crate]) {
      crateDd.appendChild(relItem('module', node.crate, node.crate).firstChild);
    } else {
      crateDd.textContent = node.crate || '—';
    }
    dl.appendChild(crateDd);
    if (node.file) {
      dl.appendChild(el('dt', { text: '文件' }));
      dl.appendChild(el('dd', {}, [fileBtn(node.file)]));
    }
    if (node.symbol) {
      dl.appendChild(el('dt', { text: '符号' }));
      dl.appendChild(el('dd', {}, [el('span', { class: 'sym', text: node.symbol })]));
    }
    dl.appendChild(el('dt', { text: '职责' }));
    dl.appendChild(el('dd', { text: node.responsibility || '—' }));
    const neighbors = flowNodeNeighbors(sel.flowId, sel.id);
    dl.appendChild(el('dt', { text: '上游' }));
    const upWrap = el('dd', {}, [el('ul', { class: 'rel-list' })]);
    neighbors.ups.forEach(up => upWrap.firstChild.appendChild(relItem('flow-node', up.id, up.label)));
    if (!neighbors.ups.length) upWrap.firstChild.appendChild(el('li', { text: '—', style: 'color:var(--text-faint)' }));
    dl.appendChild(upWrap);
    dl.appendChild(el('dt', { text: '下游' }));
    const downWrap = el('dd', {}, [el('ul', { class: 'rel-list' })]);
    neighbors.downs.forEach(down => downWrap.firstChild.appendChild(relItem('flow-node', down.id, down.label)));
    if (!neighbors.downs.length) downWrap.firstChild.appendChild(el('li', { text: '—', style: 'color:var(--text-faint)' }));
    dl.appendChild(downWrap);
    wrap.appendChild(dl);
    if (node.evidence) wrap.appendChild(el('div', { class: 'evidence-block', text: '证据：' + node.evidence }));
  } else if (sel.kind === 'path-step') {
    const step = TOUR.readingPath[sel.id];
    if (!step) { box.appendChild(el('div', { class: 'detail-empty', text: '未知步骤' })); return; }
    wrap.appendChild(el('h3', { text: (sel.id + 1) + '. ' + step.module }));
    const dl = el('dl');
    dl.appendChild(el('dt', { text: '为什么先读' }));
    dl.appendChild(el('dd', { text: step.why || '—' }));
    if (step.whatToRead && step.whatToRead.length) {
      dl.appendChild(el('dt', { text: '读什么' }));
      const dd = el('dd');
      step.whatToRead.forEach(path => dd.appendChild(el('div', {}, [fileBtn(path)])));
      dl.appendChild(dd);
    }
    if (step.whatToUnderstand && step.whatToUnderstand.length) {
      dl.appendChild(el('dt', { text: '要理解什么' }));
      dl.appendChild(el('dd', {}, step.whatToUnderstand.map(item => el('div', { text: '· ' + item }))));
    }
    if (step.skip && step.skip.length) {
      dl.appendChild(el('dt', { text: '可以先跳过' }));
      dl.appendChild(el('dd', { text: step.skip.join('；') }));
    }
    wrap.appendChild(dl);
  }
  box.appendChild(wrap);
}

/* ── SVG 连线 ─────────────────────────────────────────── */
const EDGE_COLORS = {
  main: '#22d3ee', support: '#64748b', orchestration: '#a78bfa',
  planned: '#475569', loop: '#fbbf24', 'hl-deps': '#38bdf8', 'hl-dependents': '#fb923c',
};
function edgeKey(edge) {
  return (Array.isArray(edge) ? edge[0] : edge.from) + '→' + (Array.isArray(edge) ? edge[1] : edge.to);
}
function edgeEnds(edge) {
  return Array.isArray(edge) ? [edge[0], edge[1]] : [edge.from, edge.to];
}

function drawEdges(canvas, edges, highlight) {
  const svg = canvas.querySelector('svg.edges');
  if (!svg) return;
  svg.innerHTML = '';
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  const defs = elSVG('defs', {});
  let markers = '';
  Object.keys(EDGE_COLORS).forEach(kind => {
    markers += '<marker id="arrow-' + kind + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="' + EDGE_COLORS[kind] + '"/></marker>';
  });
  defs.innerHTML = markers;
  svg.appendChild(defs);

  const boxes = {};
  $$('[data-node-id]', canvas).forEach(node => {
    boxes[node.getAttribute('data-node-id')] = {
      x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight,
    };
  });

  const used = {};
  edges.forEach(edge => {
    const parts = edgeEnds(edge);
    const key = edgeKey(edge);
    const kind = (edge && edge.kind) || 'main';
    const a = boxes[parts[0]];
    const b = boxes[parts[1]];
    if (!a || !b) return;
    const hlKind = highlight && highlight.set[key];
    const markerKind = hlKind || kind;
    let pathD;
    let labelAt = null;
    const loop = kind === 'loop' || b.y + b.h <= a.y + 4;
    if (loop) {
      const serial = (used[key] = (used[key] || 0) + 1);
      const sx = a.x + a.w;
      const sy = a.y + a.h / 2;
      const ex = b.x + b.w;
      const ey = b.y + b.h / 2;
      const reach = Math.max(a.x + a.w, b.x + b.w);
      const dx = 46 + serial * 22 + Math.max(0, (sx - ex)) * 0.25;
      const mx = reach + dx;
      pathD = 'M ' + sx + ' ' + sy + ' C ' + mx + ' ' + sy + ', ' + mx + ' ' + ey + ', ' + ex + ' ' + ey;
      labelAt = { x: mx + 4, y: (sy + ey) / 2 };
    } else {
      const sameLane = Math.abs(a.x - b.x) < a.w / 2;
      let sx; let sy; let ex; let ey;
      if (sameLane) {
        sx = a.x + a.w; sy = a.y + a.h / 2;
        ex = b.x + b.w; ey = b.y + b.h / 2;
        const mx = Math.max(sx, ex) + 26;
        pathD = 'M ' + sx + ' ' + sy + ' C ' + mx + ' ' + sy + ', ' + mx + ' ' + ey + ', ' + ex + ' ' + ey;
        labelAt = { x: mx + 4, y: (sy + ey) / 2 };
      } else {
        sx = a.x + a.w / 2; sy = a.y + a.h;
        ex = b.x + b.w / 2; ey = b.y;
        const bend = sy + (ey - sy) * 0.45;
        pathD = 'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + bend + ', ' + ex + ' ' + bend + ', ' + ex + ' ' + ey;
        labelAt = { x: (sx + ex) / 2, y: bend - 4 };
      }
    }
    const dimmed = highlight && !hlKind && !highlight.keep.has(key);
    const path = elSVG('path', {
      d: pathD,
      class: 'edge-path ' + (hlKind ? 'hl-' + hlKind : 'edge-' + kind) + (dimmed ? ' dimmed' : ''),
    });
    if (!dimmed) path.setAttribute('marker-end', 'url(#arrow-' + markerKind + ')');
    svg.appendChild(path);
    if (edge.label && labelAt) {
      const text = elSVG('text', { class: 'edge-label', x: labelAt.x, y: labelAt.y, 'text-anchor': 'middle' });
      text.textContent = edge.label;
      svg.appendChild(text);
    }
  });
}

function elSVG(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const key of Object.keys(attrs || {})) {
    if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
  }
  return node;
}

/* ── 缩放 ─────────────────────────────────────────────── */
function activeCanvas() { return $('#main .canvas'); }
function applyZoom(canvas, scale) {
  canvas.__scale = scale;
  canvas.style.transform = 'scale(' + scale + ')';
  const holder = canvas.parentElement;
  holder.style.width = canvas.offsetWidth * scale + 'px';
  holder.style.height = canvas.offsetHeight * scale + 'px';
}
function onZoomClick(event) {
  const button = event.target.closest('[data-zoom]');
  if (!button) return;
  const canvas = activeCanvas();
  if (!canvas) return;
  const current = canvas.__scale || 1;
  const mode = button.getAttribute('data-zoom');
  const next = mode === 'in' ? Math.min(2, current * 1.15)
    : mode === 'out' ? Math.max(0.5, current / 1.15) : 1;
  applyZoom(canvas, next);
}

/* ── 视图：概览 ───────────────────────────────────────── */
function renderOverview(main) {
  const hero = el('div', { class: 'hero' });
  hero.appendChild(el('h2', { text: 'DeepSeek Harness 如何工作' }));
  hero.appendChild(el('p', {
    class: 'lead',
    text: 'dsh 是一个全插件 Cordis agent harness：没有需要打补丁的特权内核，模型适配器、工具注册表、会话日志乃至 agent 循环本身都是挂在同一上下文上的插件，全部可以由配置替换。',
  }));
  hero.appendChild(el('div', {
    class: 'one-line',
    text: '一条主线：dsh CLI 按 profile 组合 bundle 与 patch → 挂载插件树 → agent-loop 驱动 turn（组装提示词 → 流式请求模型 → 执行工具）→ 每一步都追加进 append-only 会话日志，模型可见的一切都能从日志重建。',
  }));
  const grid = el('div', { class: 'ov-grid' });
  const cards = [
    ['一切皆插件', 'vendor/cordis 提供服务、类型化事件与可回滚 effect；注册即 effect，插件卸载即回退。扩展点就是事件域：session/* 落账、agent/* 观察、能力事件挂接策略。'],
    ['profile + bundle 组合', 'profile 列出 bundle 叠加顺序，bundle 是"配置行 + 代码"的分发单元；每层 patch 按 id 整行替换或插入，dsh --dump-config 可见本机启动树。'],
    ['事件账本即上下文', 'core/session 维护 append-only SessionEvent 日志；deriveMessages 从日志投影模型历史，持久化、fork、导出全部派生自账本。'],
    ['能力 seam 三角色', 'Service Definition / Provider / Consumer 三位一体：换一个 fs 或 subprocess provider，Bash、PTY、LSP 一起换世界。'],
    ['多用户 fleet 隔离线', 'fleet/gateway 以 OIDC 登录签发会话 cookie，按 subject 经 fleet-manager 路由到该用户自己的 dsh web 子进程（独立 $DSH_HOME），空闲回收、崩溃重启、并发上限。'],
  ];
  cards.forEach(pair => {
    grid.appendChild(el('div', { class: 'ov-card' }, [
      el('h4', { text: pair[0] }),
      el('p', { text: pair[1] }),
    ]));
  });
  hero.appendChild(grid);
  const stats = el('p', { class: 'ov-stats' });
  const flowCount = Object.keys(flowById).length;
  const verifiedFlowNodes = Object.keys(flowById).reduce((sum, id) =>
    sum + flowById[id].nodes.filter(node => node.verification === 'verified').length, 0);
  const allFlowNodes = Object.keys(flowById).reduce((sum, id) => sum + flowById[id].nodes.length, 0);
  stats.innerHTML = '';
  stats.appendChild(el('span', {}, [
    el('b', { text: String(TOUR.overviewNodes.length) }), ' 个系统组件 · ',
    el('b', { text: String(TOUR.modules.length) }), ' 个核心模块 · ',
    el('b', { text: String(flowCount) }), ' 条执行流（',
    el('b', { text: String(verifiedFlowNodes) }), '/' + allFlowNodes + ' 步骤已验证） · 分支 ',
    el('b', { text: TOUR.meta.branch }),
  ]));
  hero.appendChild(stats);
  hero.appendChild(el('h3', { class: 'section-title', text: '主执行链' }));
  const chain = el('div', { class: 'btn-row' });
  ['浏览器', 'dsh CLI/profile', 'agent-loop', '模型 + 工具', '会话日志'].forEach((item, index, arr) => {
    chain.appendChild(el('span', { class: 'chip layer-runtime', text: item }));
    if (index < arr.length - 1) chain.appendChild(el('span', { class: 'chip', text: '→' }));
  });
  hero.appendChild(chain);
  main.appendChild(hero);
  // 首屏即见架构：概览底部内嵌同一张泳道图（与「系统架构」页共享绘制逻辑）。
  hero.appendChild(el('h3', { class: 'section-title', text: '系统架构一览（点击节点看详情，或切到「系统架构」页）' }));
  const parts = buildArchitectureCanvas(
    '实线青=主链 · 灰=支撑 · 虚线紫=编排入口；边=调用方→被调方',
  );
  main.appendChild(parts.tools);
  main.appendChild(parts.scroll);
  requestAnimationFrame(() => {
    drawEdges(parts.canvas, TOUR.overviewEdges, overviewHighlight());
  });
}

/* ── 视图：系统架构（泳道） ───────────────────────────── */
function nodeCard(node, kind) {
  // 选中语义与 deps 视图一致：蓝=选中节点的上游（它调用），橙=下游（调用它），其余变暗。
  let extra = '';
  const sel = state.sel && state.sel.kind === kind ? state.sel : null;
  if (sel && sel.id !== node.id) {
    const selected = overviewById[sel.id];
    if (selected) {
      if ((selected.dependsOn || []).includes(node.id)) extra = ' hl-deps';
      else if ((selected.usedBy || []).includes(node.id)) extra = ' hl-dependents';
      else extra = ' dimmed';
    }
  }
  return el('div', {
    class: 'node' + (sel && sel.id === node.id ? ' selected' : '') + extra,
    'data-kind': kind, 'data-id': node.id, 'data-node-id': node.id,
    style: 'border-left-color:var(--layer-' + node.layer + ')',
  }, [
    el('div', { class: 'n-title', text: node.label }),
    el('div', { class: 'n-sub', text: (node.packages || []).join(' ') || '' }),
    el('div', { class: 'n-desc', text: node.responsibility || '' }),
  ]);
}

function buildArchitectureCanvas(hint) {
  const tools = el('div', { class: 'canvas-tools' }, [
    el('button', { class: 'btn', type: 'button', 'data-zoom': 'in', text: '＋ 放大' }),
    el('button', { class: 'btn', type: 'button', 'data-zoom': 'out', text: '－ 缩小' }),
    el('button', { class: 'btn', type: 'button', 'data-zoom': 'reset', text: '1:1' }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'hint', text: hint }),
  ]);
  const scroll = el('div', { class: 'canvas-scroll' });
  const holder = el('div');
  const canvas = el('div', { class: 'canvas' });
  const lanesWrap = el('div', { class: 'lanes' });
  LANE_ORDER.forEach(layer => {
    const lane = el('div', { class: 'lane' });
    lane.appendChild(el('div', {
      class: 'lane-head', style: 'color:var(--layer-' + layer + ')',
      text: LAYER_LABELS[layer],
    }));
    TOUR.overviewNodes.filter(node => node.layer === layer)
      .sort((x, y) => (x.readingPriority || 9) - (y.readingPriority || 9))
      .forEach(node => lane.appendChild(nodeCard(node, 'overview-node')));
    lanesWrap.appendChild(lane);
  });
  canvas.appendChild(lanesWrap);
  canvas.appendChild(elSVG('svg', { class: 'edges' }));
  holder.appendChild(canvas);
  scroll.appendChild(holder);
  return { tools, scroll, canvas };
}

function renderArchitecture(main) {
  const parts = buildArchitectureCanvas(
    '边=调用方→被调方：实线青=主链 · 灰=支撑 · 虚线紫=编排；选中节点：蓝=它调用的组件，橙=调用它的组件',
  );
  main.appendChild(parts.tools);
  main.appendChild(parts.scroll);
  requestAnimationFrame(() => {
    drawEdges(parts.canvas, TOUR.overviewEdges, overviewHighlight());
    if (parts.canvas.__scale) applyZoom(parts.canvas, parts.canvas.__scale);
  });
}

function overviewHighlight() {
  if (!state.sel || state.sel.kind !== 'overview-node') return null;
  const node = overviewById[state.sel.id];
  if (!node) return null;
  const set = {};
  const keep = new Set();
  // 边语义为“调用方 → 被调方”：出边是它调用的组件（上游），入边是调用它的组件（下游）。
  TOUR.overviewEdges.forEach(edge => {
    const parts = edgeEnds(edge);
    const key = edgeKey(edge);
    keep.add(key);
    if (parts[0] === node.id && (node.dependsOn || []).includes(parts[1])) set[key] = 'deps';
    if (parts[1] === node.id && (node.usedBy || []).includes(parts[0])) set[key] = 'dependents';
  });
  return { set, keep };
}

/* ── 视图：依赖图 ─────────────────────────────────────── */
const DEP_ROLES = ['runtime', 'protocol', 'host', 'storage', 'extension', 'external'];
function depEdgesFor(mode) {
  const mainChain = TOUR.meta.depMainChain || [];
  return TOUR.modules.reduce((acc, mod) => {
    (mod.deps || []).forEach(dep => {
      const inMain = mainChain.includes(mod.id) && mainChain.includes(dep);
      const adjacentToSel = state.sel && state.sel.kind === 'module' &&
        (mod.id === state.sel.id || dep === state.sel.id);
      if (mode === 'main' && !inMain && !adjacentToSel) return;
      acc.push({ from: dep, to: mod.id, kind: 'main', label: '' });
    });
    return acc;
  }, []);
}

function renderDeps(main) {
  const tools = el('div', { class: 'canvas-tools' }, [
    el('button', {
      class: 'btn' + (state.depsMode === 'main' ? ' primary' : ''), type: 'button',
      'data-deps-mode': 'main', text: '核心主链',
    }),
    el('button', {
      class: 'btn' + (state.depsMode === 'full' ? ' primary' : ''), type: 'button',
      'data-deps-mode': 'full', text: '完整直接依赖',
    }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'hint', text: '箭头 A → B 表示 B 直接依赖 A；蓝色=选中模块的依赖（流入），橙色=依赖它的模块（流出）' }),
  ]);
  const scroll = el('div', { class: 'canvas-scroll' });
  const holder = el('div');
  const canvas = el('div', { class: 'canvas' });
  const grid = el('div', { class: 'dep-grid' });
  const selId = state.sel && state.sel.kind === 'module' ? state.sel.id : null;
  DEP_ROLES.forEach(role => {
    const mods = TOUR.modules.filter(mod => (mod.role || 'runtime') === role);
    if (!mods.length) return;
    const col = el('div', { class: 'dep-col' });
    col.appendChild(el('div', {
      class: 'lane-head', style: 'color:var(--layer-' + role + ')',
      text: LAYER_LABELS[role],
    }));
    mods.forEach(mod => {
      const isSel = selId === mod.id;
      const isDep = selId && (moduleById[selId].deps || []).includes(mod.id);
      const isDependent = selId && (moduleById[selId].dependents || []).includes(mod.id);
      const cls = 'node' + (isSel ? ' selected' : '') +
        (isDep ? ' hl-deps' : '') + (isDependent ? ' hl-dependents' : '') +
        (selId && !isSel && !isDep && !isDependent ? ' dimmed' : '');
      col.appendChild(el('div', {
        class: cls, 'data-kind': 'module', 'data-id': mod.id, 'data-node-id': mod.id,
        style: 'border-left-color:var(--layer-' + role + ')',
      }, [
        el('div', { class: 'n-title', text: mod.id }),
        el('div', { class: 'n-sub', text: (mod.packages || [mod.id]).join(' ') }),
        el('div', { class: 'n-desc', text: mod.responsibility || '' }),
      ]));
    });
    grid.appendChild(col);
  });
  canvas.appendChild(grid);
  canvas.appendChild(elSVG('svg', { class: 'edges' }));
  holder.appendChild(canvas);
  scroll.appendChild(holder);
  main.appendChild(tools);
  main.appendChild(scroll);
  requestAnimationFrame(() => {
    drawEdges(canvas, depEdgesFor(state.depsMode), moduleHighlight());
    if (canvas.__scale) applyZoom(canvas, canvas.__scale);
  });
}

function moduleHighlight() {
  if (!state.sel || state.sel.kind !== 'module') return null;
  const mod = moduleById[state.sel.id];
  if (!mod) return null;
  const set = {};
  const keep = new Set();
  TOUR.modules.forEach(item => {
    (item.deps || []).forEach(dep => {
      const key = dep + '→' + item.id;
      keep.add(key);
      if (item.id === mod.id) set[key] = 'deps';
      if (dep === mod.id) set[key] = 'dependents';
    });
  });
  return { set, keep };
}

/* ── 视图：执行流 ─────────────────────────────────────── */
function renderFlows(main) {
  if (!state.flowId || !flowById[state.flowId]) {
    main.appendChild(el('div', { class: 'flow-head' }, [
      el('h3', { text: '执行流库（Flow Library）' }),
      el('p', { text: '选择一条执行流，按真实调用顺序逐步钻取；黄色虚线为回边（工具欠一次请求、重试、循环）。' }),
    ]));
    const lib = el('div', { class: 'flow-lib' });
    Object.keys(flowById).forEach(flowId => {
      const flow = flowById[flowId];
      lib.appendChild(el('button', {
        class: 'flow-card', type: 'button', 'data-flow': flowId,
      }, [
        el('h4', { text: flow.title }),
        el('div', { class: 'fc-meta', text: flow.priority + ' · ' + flow.nodes.length + ' 步' }),
        el('p', { text: flow.summary }),
      ]));
    });
    main.appendChild(lib);
    return;
  }
  const flow = flowById[state.flowId];
  main.appendChild(el('div', { class: 'flow-head' }, [
    el('h3', { text: flow.title }),
    el('p', { text: flow.priority + ' · ' + flow.summary }),
  ]));
  const tools = el('div', { class: 'canvas-tools' }, [
    el('button', { class: 'btn', type: 'button', 'data-zoom': 'in', text: '＋ 放大' }),
    el('button', { class: 'btn', type: 'button', 'data-zoom': 'out', text: '－ 缩小' }),
    el('button', { class: 'btn', type: 'button', 'data-zoom': 'reset', text: '1:1' }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'hint', text: '点击步骤看 crate / 文件 / 符号 / 上下游 / 证据' }),
  ]);
  const scroll = el('div', { class: 'canvas-scroll' });
  const holder = el('div');
  const canvas = el('div', { class: 'canvas' });
  const steps = el('div', { class: 'flow-steps' });
  flow.nodes.forEach((node, index) => {
    steps.appendChild(el('div', {
      class: 'flow-node' + (state.sel && state.sel.kind === 'flow-node' && state.sel.id === node.id ? ' selected' : ''),
      'data-kind': 'flow-node', 'data-id': node.id, 'data-node-id': node.id,
    }, [
      el('span', { class: 'fn-idx', text: String(index + 1) }),
      el('span', { class: 'fn-title', text: node.label }),
      el('div', { class: 'fn-meta', text: [node.crate, node.file, node.symbol].filter(Boolean).join(' · ') }),
    ]));
  });
  canvas.appendChild(steps);
  canvas.appendChild(elSVG('svg', { class: 'edges' }));
  holder.appendChild(canvas);
  scroll.appendChild(holder);
  main.appendChild(tools);
  main.appendChild(scroll);
  requestAnimationFrame(() => {
    drawEdges(canvas, flow.edges, null);
    if (canvas.__scale) applyZoom(canvas, canvas.__scale);
  });
}

/* ── 视图：模块浏览器 ─────────────────────────────────── */
function renderModules(main) {
  main.appendChild(el('div', { class: 'flow-head' }, [
    el('h3', { text: '模块浏览器' }),
    el('p', { text: '核心模块的 manifest 级依赖；点击模块查看关键文件、符号与相关执行流，或在依赖图中定位。' }),
  ]));
  const list = el('div', { class: 'mod-list' });
  TOUR.modules.forEach(mod => {
    list.appendChild(el('div', {
      class: 'node', 'data-kind': 'module', 'data-id': mod.id,
      style: 'border-left-color:var(--layer-' + (mod.role || 'runtime') + ');cursor:pointer;margin:0',
    }, [
      el('div', { class: 'n-title', text: mod.id }),
      el('div', { class: 'n-sub', text: (mod.packages || []).join(' ') }),
      el('div', { class: 'n-desc', text: mod.responsibility || '' }),
      el('div', { class: 'n-desc', text: 'deps: ' + ((mod.deps || []).join(', ') || '—') }),
    ]));
  });
  main.appendChild(list);
}

/* ── 视图：阅读路线 ───────────────────────────────────── */
function renderPath(main) {
  main.appendChild(el('div', { class: 'flow-head' }, [
    el('h3', { text: '推荐阅读路线' }),
    el('p', { text: '自顶向下的钻取顺序；每步只读少量文件与符号。' }),
  ]));
  TOUR.readingPath.forEach((step, index) => {
    const body = el('div', { class: 'path-body' }, [
      el('h4', { text: step.module }),
      el('p', { class: 'why', text: '为什么：' + (step.why || '—') }),
    ]);
    (step.whatToRead || []).forEach(path => {
      body.appendChild(el('p', {}, [fileBtn(path)]));
    });
    (step.whatToUnderstand || []).forEach(item => body.appendChild(el('p', { text: '理解：' + item })));
    if (step.skip && step.skip.length) {
      body.appendChild(el('p', { class: 'path-skip', text: '先跳过：' + step.skip.join('；') }));
    }
    main.appendChild(el('div', {
      class: 'path-step', 'data-kind': 'path-step', 'data-id': String(index),
    }, [el('div', { class: 'path-idx', text: String(index + 1) }), body]));
  });
}

/* ── 主渲染 ───────────────────────────────────────────── */
function render() {
  renderTabs();
  const main = $('#main');
  main.innerHTML = '';
  if (state.view === 'overview') renderOverview(main);
  else if (state.view === 'architecture') renderArchitecture(main);
  else if (state.view === 'deps') renderDeps(main);
  else if (state.view === 'flows') renderFlows(main);
  else if (state.view === 'modules') renderModules(main);
  else if (state.view === 'path') renderPath(main);
  renderDetail();
}

/* ── 搜索 ─────────────────────────────────────────────── */
function buildSearchIndex() {
  const index = [];
  TOUR.overviewNodes.forEach(node => index.push({
    kind: 'overview-node', id: node.id, title: node.label,
    sub: [node.file || (node.keyFiles || [])[0], node.responsibility].filter(Boolean).join(' · '),
    haystack: [node.id, node.label, node.responsibility, (node.keyFiles || []).join(' '), (node.keySymbols || []).join(' ')].join(' ').toLowerCase(),
  }));
  TOUR.modules.forEach(mod => index.push({
    kind: 'module', id: mod.id, title: mod.id,
    sub: [(mod.packages || []).join(' '), mod.responsibility].filter(Boolean).join(' · '),
    haystack: [mod.id, (mod.packages || []).join(' '), mod.responsibility, (mod.keyFiles || []).join(' '), (mod.keySymbols || []).join(' ')].join(' ').toLowerCase(),
  }));
  Object.keys(flowById).forEach(flowId => {
    flowById[flowId].nodes.forEach(node => index.push({
      kind: 'flow-node', id: node.id, flowId, title: node.label,
      sub: [node.crate, node.file, node.symbol].filter(Boolean).join(' · '),
      haystack: [node.label, node.crate, node.file, node.symbol, node.responsibility].filter(Boolean).join(' ').toLowerCase(),
    }));
  });
  return index;
}
let SEARCH_INDEX = [];

function openSearchHit(hit) {
  if (hit.kind === 'overview-node') {
    apply({ view: 'architecture', flowId: null, sel: { kind: 'overview-node', id: hit.id } });
  } else if (hit.kind === 'module') {
    apply({ view: 'deps', flowId: null, sel: { kind: 'module', id: hit.id } });
  } else if (hit.kind === 'flow-node') {
    apply({ view: 'flows', flowId: hit.flowId, sel: { kind: 'flow-node', id: hit.id, flowId: hit.flowId } });
  }
}

function setupSearch() {
  const input = $('#search');
  const results = $('#searchResults');
  SEARCH_INDEX = buildSearchIndex();
  const close = () => results.classList.remove('open');
  const run = () => {
    const query = input.value.trim().toLowerCase();
    results.innerHTML = '';
    if (query.length < 1) { close(); return; }
    const hits = SEARCH_INDEX.filter(item => item.haystack.includes(query)).slice(0, 24);
    if (!hits.length) {
      results.appendChild(el('div', { class: 'search-empty', text: '无匹配' }));
    }
    hits.forEach(hit => {
      results.appendChild(el('button', {
        class: 'search-hit', type: 'button',
        onmousedown: event => { event.preventDefault(); openSearchHit(hit); close(); input.blur(); },
      }, [
        el('span', { class: 'hit-kind', text: VIEW_TITLES[{ 'overview-node': 'architecture', 'module': 'deps', 'flow-node': 'flows' }[hit.kind]] }),
        el('span', { text: hit.title }),
        el('span', { class: 'hit-sub', text: hit.sub }),
      ]));
    });
    results.classList.add('open');
  };
  input.addEventListener('input', run);
  input.addEventListener('focus', run);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); input.blur(); }
    if (event.key === 'Enter') {
      const first = $('.search-hit', results);
      if (first) first.dispatchEvent(new MouseEvent('mousedown'));
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.search-wrap')) close();
  });
}

/* ── 事件委托 ─────────────────────────────────────────── */
function handleClick(event) {
  const target = event.target;
  const fileLink = target.closest('[data-file]');
  if (fileLink) { copyText(fileLink.getAttribute('data-file')); return; }
  const zoomBtn = target.closest('[data-zoom]');
  if (zoomBtn) { onZoomClick(event); return; }
  const depsModeBtn = target.closest('[data-deps-mode]');
  if (depsModeBtn) {
    apply({ view: 'deps', depsMode: depsModeBtn.getAttribute('data-deps-mode'), sel: state.sel });
    return;
  }
  const flowCard = target.closest('[data-flow]');
  if (flowCard) {
    apply({ view: 'flows', flowId: flowCard.getAttribute('data-flow'), sel: null });
    return;
  }
  const viewBtn = target.closest('[data-view]');
  if (viewBtn) {
    const view = viewBtn.getAttribute('data-view');
    apply({ view, flowId: view === 'flows' ? state.flowId : null, sel: state.sel && state.sel.kind === 'module' && view !== 'deps' ? state.sel : (view === 'deps' ? state.sel : null) });
    return;
  }
  const clickable = target.closest('[data-kind]');
  if (clickable) {
    const kind = clickable.getAttribute('data-kind');
    const id = clickable.getAttribute('data-id');
    const sel = kind === 'flow-node'
      ? { kind, id, flowId: state.flowId }
      : { kind, id: kind === 'path-step' ? Number(id) : id };
    const same = state.sel && state.sel.kind === sel.kind && String(state.sel.id) === String(sel.id);
    apply({ sel: same ? null : sel });
    return;
  }
}

let resizeTimer = null;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const canvas = activeCanvas();
    if (!canvas) return;
    canvas.style.transform = '';
    if (canvas.__scale) applyZoom(canvas, canvas.__scale);
    if (state.view === 'architecture') drawEdges(canvas, TOUR.overviewEdges, overviewHighlight());
    else if (state.view === 'deps') drawEdges(canvas, depEdgesFor(state.depsMode), moduleHighlight());
    else if (state.view === 'flows' && state.flowId) drawEdges(canvas, flowById[state.flowId].edges, null);
  }, 150);
}

/* ── 启动 ─────────────────────────────────────────────── */
function boot() {
  restoreState();
  $('#btnBack').addEventListener('click', goBack);
  document.addEventListener('click', handleClick);
  window.addEventListener('resize', onResize);
  setupSearch();
  render();
}

boot();
