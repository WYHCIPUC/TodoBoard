/* - 知识关系画布：将本地条目、归档状态与分析关系放到同一操作空间 - */
const RELATIONSHIP_CANVAS = Object.freeze({ width: 1160, height: 1060, nodeWidth: 236, nodeHeight: 108 });
const RELATIONSHIP_SOURCE_LABELS = Object.freeze({
  all: "全部来源", web: "网页链接", github: "GitHub", social: "社交平台", local: "本地记录",
});
const relationshipState = {
  analysis: null,
  source: "all",
  archive: "all",
  scope: "all",
  selectedId: null,
  detailOpen: false,
  positions: new Map(),
  zoom: 1,
  panX: 0,
  panY: 0,
  sequence: 0,
  controller: null,
  pointer: null,
  suppressClick: false,
};

function relationshipSourceType(item) {
  if (!item || !item.url) return "local";
  const host = domain(item.url).toLowerCase();
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (["x.com", "twitter.com", "weibo.com", "bilibili.com", "xiaohongshu.com"].some(value => host === value || host.endsWith("." + value))) return "social";
  return "web";
}

function relationshipArchiveGroup(item) {
  const value = archiveStatus(item).state;
  return ["succeeded", "partial"].includes(value) ? "saved" : "attention";
}

function relationshipField(item, pattern) {
  const field = (item && item.fields || []).find(entry => pattern.test(entry.k));
  return field ? String(field.v || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").trim() : "";
}

function relationshipFallbackGraph(items) {
  const nodes = items.map(item => ({
    id: item.id,
    title: item.name,
    category: item.category,
    status: item.status,
    url: item.url || "",
    domain: item.url ? domain(item.url) : "",
    tags: item.tags || [],
    hasArchive: relationshipArchiveGroup(item) === "saved",
    cluster: catNo(item.category),
    degree: 0,
  }));
  const candidates = [];
  for (let index = 0; index < nodes.length; index++) {
    for (let next = index + 1; next < nodes.length; next++) {
      const a = nodes[index], b = nodes[next];
      const common = (a.tags || []).filter(tag => (b.tags || []).includes(tag)).slice(0, 3);
      const sameCategory = a.category === b.category;
      const sameDomain = Boolean(a.domain && a.domain === b.domain);
      if (!common.length && !sameDomain && !sameCategory) continue;
      const weight = Math.min(1, common.length * 0.24 + (sameDomain ? 0.3 : 0) + (sameCategory ? 0.16 : 0));
      candidates.push({
        source: a.id, target: b.id, weight,
        signals: common.length ? common : [sameDomain ? a.domain : a.category],
        relation: common.length ? "主题共振" : sameDomain ? "来源生态" : "同类对照",
        types: common.length ? ["theme"] : sameDomain ? ["source"] : ["portfolio"],
      });
    }
  }
  candidates.sort((a, b) => b.weight - a.weight);
  const degree = new Map(nodes.map(node => [node.id, 0]));
  const edges = [];
  for (const edge of candidates) {
    if (edges.length >= 60) break;
    if (degree.get(edge.source) >= 5 || degree.get(edge.target) >= 5) continue;
    edges.push(edge);
    degree.set(edge.source, degree.get(edge.source) + 1);
    degree.set(edge.target, degree.get(edge.target) + 1);
  }
  nodes.forEach(node => { node.degree = degree.get(node.id) || 0; });
  return { nodes, edges };
}

function relationshipHydrateGraph(graph) {
  const itemById = new Map(state.items.map(item => [item.id, item]));
  const sourceNodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodes = sourceNodes.map(node => {
    const item = itemById.get(String(node.id));
    if (!item) return null;
    return Object.assign({}, node, {
      id: String(node.id), title: item.name, category: item.category, status: item.status,
      url: item.url || node.url || "", domain: item.url ? domain(item.url) : node.domain || "",
      tags: item.tags || node.tags || [], hasArchive: relationshipArchiveGroup(item) === "saved",
    });
  }).filter(Boolean);
  const ids = new Set(nodes.map(node => node.id));
  const edges = (graph && Array.isArray(graph.edges) ? graph.edges : []).filter(edge => ids.has(String(edge.source)) && ids.has(String(edge.target))).map(edge => Object.assign({}, edge, {
    source: String(edge.source), target: String(edge.target),
  }));
  return { nodes, edges };
}

function relationshipFilteredGraph() {
  const graph = relationshipState.analysis || relationshipFallbackGraph(state.items);
  const itemById = new Map(state.items.map(item => [item.id, item]));
  let nodes = graph.nodes.filter(node => {
    const item = itemById.get(node.id);
    if (!item) return false;
    if (relationshipState.scope === "inbox" && item.status !== "pending") return false;
    if (relationshipState.scope === "review" && item.status !== "done") return false;
    if (relationshipState.source !== "all" && relationshipSourceType(item) !== relationshipState.source) return false;
    if (relationshipState.archive !== "all" && relationshipArchiveGroup(item) !== relationshipState.archive) return false;
    return true;
  });
  nodes = [...nodes].sort((a, b) => {
    if (a.id === relationshipState.selectedId) return -1;
    if (b.id === relationshipState.selectedId) return 1;
    return (b.degree || 0) - (a.degree || 0) || a.id.localeCompare(b.id, "en", { numeric: true });
  }).slice(0, 21);
  const ids = new Set(nodes.map(node => node.id));
  const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  return { nodes, edges, total: graph.nodes.length };
}

function relationshipLayout(nodes) {
  const ranked = [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0) || a.id.localeCompare(b.id, "en", { numeric: true }));
  const laneSize = Math.ceil(ranked.length / 3);
  const buckets = [
    ranked.slice(laneSize, laneSize * 2),
    ranked.slice(0, laneSize),
    ranked.slice(laneSize * 2),
  ];
  const zones = [];
  const positions = new Map();
  const occupied = [];
  let adjusted = false;
  const orderedBuckets = buckets.filter(members => members.length).sort((a, b) => {
    const aDegree = Math.max(...a.map(node => node.degree || 0));
    const bDegree = Math.max(...b.map(node => node.degree || 0));
    return bDegree - aDegree || b.length - a.length;
  });
  const columnOrder = [1, 0, 2];
  orderedBuckets.forEach((members, orderIndex) => {
    const column = columnOrder[orderIndex] == null ? orderIndex : columnOrder[orderIndex];
    members.sort((a, b) => (b.degree || 0) - (a.degree || 0) || a.id.localeCompare(b.id, "en", { numeric: true }));
    const zoneMeta = [
      { title: "关联来源", color: "#2c9b73" },
      { title: "重点关系", color: "#8b5cf6" },
      { title: "探索补充", color: "#e6506e" },
    ][column];
    const x = 25 + column * 375;
    const zone = { id: column, title: zoneMeta.title, count: members.length, color: zoneMeta.color, x, y: 58, width: 340, height: 930, nodeIds: new Set(members.map(node => node.id)) };
    zones.push(zone);
    const step = members.length > 1 ? Math.min(185, Math.floor(730 / (members.length - 1))) : 0;
    members.forEach((node, index) => {
      const saved = relationshipState.positions.get(node.id);
      const natural = {
        x: x + 22 + (index % 2) * 70,
        y: 112 + index * step,
      };
      const candidates = [];
      if (saved && relationshipPointInsideZone(saved, zone)) candidates.push(saved);
      else if (saved) adjusted = true;
      candidates.push(natural);
      for (let slot = 0; slot < Math.max(8, members.length + 3); slot++) {
        candidates.push({ x: x + 22 + (slot % 2) * 70, y: 112 + slot * 132 });
      }
      const point = candidates.map(relationshipClampPoint).find(candidate => !occupied.some(other => relationshipPointsOverlap(candidate, other))) || relationshipClampPoint(natural);
      if (saved && (Math.abs(point.x - saved.x) > 1 || Math.abs(point.y - saved.y) > 1)) adjusted = true;
      positions.set(node.id, point);
      occupied.push(point);
    });
  });
  return { positions, zones, adjusted };
}

function relationshipClampPoint(point) {
  return {
    x: Math.max(10, Math.min(RELATIONSHIP_CANVAS.width - RELATIONSHIP_CANVAS.nodeWidth - 10, Number(point.x) || 0)),
    y: Math.max(10, Math.min(RELATIONSHIP_CANVAS.height - RELATIONSHIP_CANVAS.nodeHeight - 10, Number(point.y) || 0)),
  };
}

function relationshipPointInsideZone(point, zone) {
  return point.x >= zone.x + 12
    && point.x <= zone.x + zone.width - RELATIONSHIP_CANVAS.nodeWidth - 12
    && point.y >= zone.y + 42
    && point.y <= zone.y + zone.height - RELATIONSHIP_CANVAS.nodeHeight - 12;
}

function relationshipPointsOverlap(a, b, gap = 16) {
  return a.x < b.x + RELATIONSHIP_CANVAS.nodeWidth + gap
    && a.x + RELATIONSHIP_CANVAS.nodeWidth + gap > b.x
    && a.y < b.y + RELATIONSHIP_CANVAS.nodeHeight + gap
    && a.y + RELATIONSHIP_CANVAS.nodeHeight + gap > b.y;
}

function relationshipNodeLabel(node) {
  if (node.status === "done") return "阶段结论";
  if (node.status === "doing") return "研究判断";
  return "待验证来源";
}

function relationshipArchiveLabel(item) {
  const value = archiveStatus(item).state;
  if (value === "succeeded") return "完整留存";
  if (value === "partial") return "部分留存";
  if (["failed", "manual_required"].includes(value)) return "需要处理";
  return "留存排队中";
}

function relationshipRenderSidebar() {
  const typeCounts = new Map(Object.keys(RELATIONSHIP_SOURCE_LABELS).map(key => [key, 0]));
  state.items.forEach(item => {
    typeCounts.set("all", typeCounts.get("all") + 1);
    const type = relationshipSourceType(item);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  });
  const sourceHost = document.getElementById("relationshipSourceFilters");
  sourceHost.innerHTML = [...typeCounts.entries()].filter(([, count]) => count > 0).map(([type, count]) => `
    <button type="button" class="${relationshipState.source === type ? "active" : ""}" data-relationship-source="${type}" aria-pressed="${relationshipState.source === type}">
      <span>${escapeHtml(RELATIONSHIP_SOURCE_LABELS[type])}</span><b>${count}</b>
    </button>`).join("");
  document.getElementById("relationshipAllCount").textContent = state.items.length;
  document.getElementById("relationshipInboxCount").textContent = state.items.filter(item => item.status === "pending").length;
  document.getElementById("relationshipReviewCount").textContent = state.items.filter(item => item.status === "done").length;
  document.getElementById("relationshipArchiveAll").textContent = state.items.length;
  document.getElementById("relationshipArchiveSaved").textContent = state.items.filter(item => relationshipArchiveGroup(item) === "saved").length;
  document.getElementById("relationshipArchiveAttention").textContent = state.items.filter(item => relationshipArchiveGroup(item) === "attention").length;
  document.getElementById("relationshipLocalStatus").textContent = state.httpMode
    ? `${state.items.length} 条记录 · 本地服务已连接`
    : `${state.items.length} 条记录 · 当前为只读模式`;
}

function relationshipPath(a, b) {
  const ax = a.x + RELATIONSHIP_CANVAS.nodeWidth / 2;
  const ay = a.y + RELATIONSHIP_CANVAS.nodeHeight / 2;
  const bx = b.x + RELATIONSHIP_CANVAS.nodeWidth / 2;
  const by = b.y + RELATIONSHIP_CANVAS.nodeHeight / 2;
  const bend = Math.max(42, Math.abs(bx - ax) * 0.42);
  const direction = bx >= ax ? 1 : -1;
  return `M ${ax.toFixed(1)} ${ay.toFixed(1)} C ${(ax + bend * direction).toFixed(1)} ${ay.toFixed(1)}, ${(bx - bend * direction).toFixed(1)} ${by.toFixed(1)}, ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

function relationshipRenderLinks(graph) {
  const selected = relationshipState.selectedId;
  document.getElementById("relationshipLinks").innerHTML = graph.edges.map((edge, index) => {
    const a = relationshipState.positions.get(edge.source), b = relationshipState.positions.get(edge.target);
    if (!a || !b) return "";
    const related = selected && (edge.source === selected || edge.target === selected);
    const muted = selected && !related;
    const relation = edge.relation || "关联";
    const type = (edge.types || [])[0] || "other";
    const cls = `relationship-link relationship-link-${escapeAttr(type)}${related ? " is-related" : ""}${muted ? " is-muted" : ""}`;
    const label = related ? `<text class="relationship-link-label" x="${((a.x + b.x) / 2 + RELATIONSHIP_CANVAS.nodeWidth / 2).toFixed(1)}" y="${((a.y + b.y) / 2 + RELATIONSHIP_CANVAS.nodeHeight / 2 - 9).toFixed(1)}">${escapeHtml(relation)}</text>` : "";
    return `<path class="${cls}" data-relationship-edge="${index}" d="${relationshipPath(a, b)}"><title>${escapeHtml(relation + " · " + (edge.signals || []).join(" / "))}</title></path>${label}`;
  }).join("");
}

function relationshipRenderMinimap(graph) {
  const scaleX = 132 / RELATIONSHIP_CANVAS.width;
  const scaleY = 86 / RELATIONSHIP_CANVAS.height;
  const nodes = graph.nodes.map(node => {
    const point = relationshipState.positions.get(node.id);
    if (!point) return "";
    return `<i class="relationship-minimap-node" style="left:${(point.x * scaleX).toFixed(1)}px;top:${(point.y * scaleY).toFixed(1)}px;--mini-color:${escapeAttr(catColor(node.category))}"></i>`;
  }).join("");
  const viewport = document.getElementById("relationshipViewport");
  const width = Math.min(132, viewport.clientWidth / relationshipState.zoom * scaleX);
  const height = Math.min(86, viewport.clientHeight / relationshipState.zoom * scaleY);
  const left = Math.max(0, Math.min(132 - width, -relationshipState.panX / relationshipState.zoom * scaleX));
  const top = Math.max(0, Math.min(86 - height, -relationshipState.panY / relationshipState.zoom * scaleY));
  document.getElementById("relationshipMinimap").innerHTML = nodes + `<span class="relationship-minimap-window" style="left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${width.toFixed(1)}px;height:${height.toFixed(1)}px"></span>`;
}

function relationshipRenderDetail(graph) {
  const detail = document.getElementById("relationshipDetail");
  const body = document.getElementById("relationshipDetailBody");
  const actions = document.getElementById("relationshipDetailActions");
  const item = state.items.find(entry => entry.id === relationshipState.selectedId);
  const node = graph.nodes.find(entry => entry.id === relationshipState.selectedId);
  if (!item || !node) {
    document.getElementById("relationshipDetailTitle").textContent = "选择一个节点";
    body.innerHTML = '<div class="relationship-detail-empty">点击画布中的来源、判断或待验证事项，查看本地留存状态和关系依据。</div>';
    actions.hidden = true;
    actions.innerHTML = "";
    detail.classList.add("is-collapsed");
    return;
  }
  detail.classList.toggle("is-collapsed", window.innerWidth <= 940 && !relationshipState.detailOpen);
  document.getElementById("relationshipDetailTitle").textContent = item.name;
  const archive = archiveStatus(item);
  const archiveMeta = ARCHIVE_STATUS_META[archive.state];
  const excerpt = relationshipField(item, /关键发现|结论|研究要点|为什么收藏|简介/) || item.desc || "还没有形成摘录。打开研究档案后，可以补充判断、行动项和结论。";
  const related = graph.edges.filter(edge => edge.source === item.id || edge.target === item.id).sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 6);
  const relatedHtml = related.length ? related.map(edge => {
    const otherId = edge.source === item.id ? edge.target : edge.source;
    const other = state.items.find(entry => entry.id === otherId);
    if (!other) return "";
    return `<button type="button" data-relationship-select="${escapeAttr(other.id)}"><strong>${escapeHtml(other.name)}</strong><small>${escapeHtml(edge.relation || "关联")} · ${escapeHtml((edge.signals || []).slice(0, 2).join(" / ") || other.category)}</small></button>`;
  }).join("") : '<p>当前筛选范围内还没有可靠关联。</p>';
  const tags = (item.tags || []).slice(0, 8).map(tag => `<span>${escapeHtml(tag)}</span>`).join("");
  body.innerHTML = `
    <span class="relationship-source-kind">${escapeHtml(relationshipNodeLabel(node))} · ${escapeHtml(RELATIONSHIP_SOURCE_LABELS[relationshipSourceType(item)])}</span>
    <span class="relationship-detail-domain">${escapeHtml(item.url ? domain(item.url) : "本地记录")} · #${escapeHtml(item.id)}</span>
    ${tags ? `<div class="relationship-detail-tags">${tags}</div>` : ""}
    <section class="relationship-detail-section"><strong>内容摘录</strong><p>${escapeHtml(excerpt)}</p></section>
    <section class="relationship-detail-section"><strong>本地存储状态</strong><div class="relationship-archive-summary"><b>${escapeHtml(archiveMeta.label)}</b><span>${escapeHtml(archiveMeta.description)}</span><span>${escapeHtml(archive.updatedAt ? "更新于 " + archiveTimeLabel(archive.updatedAt) : "本地归档状态会在后台刷新")}</span></div></section>
    <section class="relationship-detail-section"><strong>反向链接（${related.length}）</strong><div class="relationship-related-list">${relatedHtml}</div></section>`;
  actions.hidden = false;
  actions.innerHTML = `
    <button type="button" data-relationship-action="study">研究档案</button>
    ${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">打开原文</a>` : '<button type="button" disabled>没有原文链接</button>'}
    <button type="button" data-relationship-action="copy">复制本地线索</button>
    <button type="button" class="primary" data-relationship-action="verify">带入验证方案</button>`;
}

function updateRelationshipTransform() {
  const scene = document.getElementById("relationshipScene");
  scene.style.transform = `translate3d(${relationshipState.panX.toFixed(1)}px, ${relationshipState.panY.toFixed(1)}px, 0) scale(${relationshipState.zoom.toFixed(3)})`;
  document.getElementById("relationshipZoomLabel").textContent = Math.round(relationshipState.zoom * 100) + "%";
  if (relationshipState.analysis) relationshipRenderMinimap(relationshipFilteredGraph());
}

function fitRelationshipView(options = {}) {
  const viewport = document.getElementById("relationshipViewport");
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  if (options.instant) viewport.classList.add("is-instant-fit");
  const mobileViewport = viewport.clientWidth < 700;
  const minimumZoom = mobileViewport ? 0.42 : 0.62;
  const contentBottom = Math.max(360, ...relationshipFilteredGraph().nodes.map(node => {
    const point = relationshipState.positions.get(node.id);
    return point ? point.y + RELATIONSHIP_CANVAS.nodeHeight : 0;
  })) + 80;
  const zoom = Math.min(1, Math.max(minimumZoom, Math.min((viewport.clientWidth - 34) / RELATIONSHIP_CANVAS.width, (viewport.clientHeight - 34) / contentBottom)));
  relationshipState.zoom = zoom;
  const selectedPoint = relationshipState.positions.get(relationshipState.selectedId);
  relationshipState.panX = selectedPoint
    ? viewport.clientWidth / 2 - (selectedPoint.x + RELATIONSHIP_CANVAS.nodeWidth / 2) * zoom
    : mobileViewport
      ? (viewport.clientWidth - RELATIONSHIP_CANVAS.width * zoom) / 2
      : Math.max(16, (viewport.clientWidth - RELATIONSHIP_CANVAS.width * zoom) / 2);
  relationshipState.panY = 24;
  updateRelationshipTransform();
  if (options.instant) requestAnimationFrame(() => viewport.classList.remove("is-instant-fit"));
}

function setRelationshipZoom(nextZoom, anchorX, anchorY) {
  const viewport = document.getElementById("relationshipViewport");
  const rect = viewport.getBoundingClientRect();
  const x = anchorX == null ? viewport.clientWidth / 2 : anchorX - rect.left;
  const y = anchorY == null ? viewport.clientHeight / 2 : anchorY - rect.top;
  const old = relationshipState.zoom;
  const next = Math.max(0.42, Math.min(1.7, nextZoom));
  const sceneX = (x - relationshipState.panX) / old;
  const sceneY = (y - relationshipState.panY) / old;
  relationshipState.zoom = next;
  relationshipState.panX = x - sceneX * next;
  relationshipState.panY = y - sceneY * next;
  updateRelationshipTransform();
}

function renderRelationship(options = {}) {
  relationshipRenderSidebar();
  const graph = relationshipFilteredGraph();
  if (relationshipState.selectedId && !graph.nodes.some(node => node.id === relationshipState.selectedId)) {
    relationshipState.selectedId = null;
    relationshipState.detailOpen = false;
  }
  const empty = document.getElementById("relationshipEmpty");
  if (!graph.nodes.length) {
    document.getElementById("relationshipNodes").innerHTML = "";
    document.getElementById("relationshipLinks").innerHTML = "";
    document.getElementById("relationshipZones").innerHTML = "";
    empty.hidden = false;
    document.getElementById("relationshipSummary").textContent = state.items.length
      ? "当前筛选组合暂无结果"
      : "收藏第一条内容后，这里会自动建立关系";
    empty.innerHTML = state.items.length
      ? '<strong>这个筛选组合下没有内容</strong><span>返回全部范围，重新查看本地条目之间的关系。</span><button type="button" id="relationshipClearFilters">显示全部内容</button>'
      : '<strong>还没有可以整理的内容</strong><span>先收藏一个来源，画布会自动建立可追溯关系。</span><button type="button" id="relationshipEmptyAdd">收藏第一条内容</button>';
    relationshipRenderDetail(graph);
    return;
  }
  empty.hidden = true;
  const layout = relationshipLayout(graph.nodes);
  layout.positions.forEach((point, id) => relationshipState.positions.set(id, point));
  if (layout.adjusted) queueMicrotask(saveRelationshipPositions);
  const selected = relationshipState.selectedId;
  const relatedIds = new Set();
  if (selected) graph.edges.forEach(edge => {
    if (edge.source === selected) relatedIds.add(edge.target);
    if (edge.target === selected) relatedIds.add(edge.source);
  });
  const itemById = new Map(state.items.map(item => [item.id, item]));
  document.getElementById("relationshipZones").innerHTML = layout.zones.map(zone => `<div class="relationship-zone" style="left:${zone.x}px;top:${zone.y}px;width:${zone.width}px;height:${zone.height}px;--zone-color:${escapeAttr(zone.color)}"><span><b>${escapeHtml(zone.title)}</b><small>${zone.count} 个节点</small></span></div>`).join("");
  document.getElementById("relationshipNodes").innerHTML = graph.nodes.map(node => {
    const item = itemById.get(node.id);
    const point = relationshipState.positions.get(node.id);
    const muted = selected && selected !== node.id && !relatedIds.has(node.id);
    const sourceLabel = RELATIONSHIP_SOURCE_LABELS[relationshipSourceType(item)];
    return `<button type="button" class="relationship-node${selected === node.id ? " is-selected" : ""}${relatedIds.has(node.id) ? " is-related" : ""}${muted ? " is-muted" : ""}" data-relationship-node="${escapeAttr(node.id)}" style="--node-x:${point.x}px;--node-y:${point.y}px;--node-color:${escapeAttr(catColor(item.category))}" role="listitem" aria-label="${escapeAttr(node.title)}，${escapeAttr(relationshipArchiveLabel(item))}">
      <span class="relationship-node-type"><span>${escapeHtml(relationshipNodeLabel(node))}</span><b>${escapeHtml(item.category)}</b></span>
      <strong>${escapeHtml(node.title)}</strong>
      <span class="relationship-node-meta"><span>${escapeHtml(item.url ? domain(item.url) : sourceLabel)}</span><b>${escapeHtml(relationshipArchiveLabel(item))}</b></span>
    </button>`;
  }).join("");
  relationshipRenderLinks(graph);
  relationshipRenderMinimap(graph);
  relationshipRenderDetail(graph);
  document.getElementById("relationshipSummary").textContent = `${graph.nodes.length} 个可见节点 · ${graph.edges.length} 条可追溯关系${graph.total > graph.nodes.length ? ` · 已聚焦高关联节点` : ""}`;
  if (options.fit) {
    fitRelationshipView({ instant: options.instantFit });
    requestAnimationFrame(() => fitRelationshipView({ instant: options.instantFit }));
  }
  else updateRelationshipTransform();
}

function saveRelationshipPositions() {
  const record = {};
  relationshipState.positions.forEach((point, id) => { record[id] = { x: Math.round(point.x), y: Math.round(point.y) }; });
  try { localStorage.setItem("relationship_positions_v1", JSON.stringify(record)); } catch (_) {}
}

function restoreRelationshipPositions() {
  try {
    const record = JSON.parse(localStorage.getItem("relationship_positions_v1") || "{}");
    Object.entries(record).forEach(([id, point]) => {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) relationshipState.positions.set(id, { x: point.x, y: point.y });
    });
  } catch (_) {}
}
restoreRelationshipPositions();

async function loadRelationship() {
  const sequence = ++relationshipState.sequence;
  if (relationshipState.controller) relationshipState.controller.abort();
  relationshipState.controller = new AbortController();
  const status = document.getElementById("relationshipAnalysisState");
  status.textContent = "正在分析本地关系…";
  try {
    let graph;
    if (state.demoMode) {
      const response = await fetch("demo-brainstorm.json", { cache: "no-store", signal: relationshipState.controller.signal });
      const data = await readJsonResponse(response);
      graph = data.graph;
    } else if (state.httpMode) {
      const goal = state.category ? `整理“${state.category}”中的项目关系` : "整理本地知识库中的来源、判断与验证关系";
      const response = await localApiFetch("/api/brainstorm?mode=panorama&goal=" + encodeURIComponent(goal), { cache: "no-store", signal: relationshipState.controller.signal });
      const data = await readJsonResponse(response);
      graph = data.graph;
    }
    if (sequence !== relationshipState.sequence) return;
    const hydrated = relationshipHydrateGraph(graph || relationshipFallbackGraph(state.items));
    relationshipState.analysis = hydrated.nodes.length ? hydrated : relationshipFallbackGraph(state.items);
    status.textContent = "本地分析已更新";
  } catch (error) {
    if (error.name === "AbortError" || sequence !== relationshipState.sequence) return;
    relationshipState.analysis = relationshipFallbackGraph(state.items);
    status.textContent = "已使用离线基础关系";
  } finally {
    if (sequence !== relationshipState.sequence) return;
    relationshipState.controller = null;
    renderRelationship({ fit: true });
  }
}

function selectRelationshipNode(id) {
  if (!state.items.some(item => item.id === String(id))) return;
  relationshipState.selectedId = String(id);
  relationshipState.detailOpen = true;
  renderRelationship({ fit: true, instantFit: true });
  requestAnimationFrame(() => document.querySelector(`[data-relationship-node="${CSS.escape(String(id))}"]`)?.focus({ preventScroll: true }));
}

function selectedRelationshipItem() {
  return state.items.find(item => item.id === relationshipState.selectedId) || null;
}

function openRelationship() {
  if (!state.items.length) { toast("请先新增至少一条本地记录", "err"); return; }
  setProductView("relationship");
}

const relationshipSidebar = document.getElementById("relationshipSidebar");
const relationshipSidebarScrim = document.getElementById("relationshipSidebarScrim");
const relationshipFilterButton = document.getElementById("relationshipFilterBtn");
let relationshipSidebarGesture = null;
function relationshipCompactLayout() {
  return window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
}
function setRelationshipSidebar(open, options = {}) {
  const compact = relationshipCompactLayout();
  const visible = compact && Boolean(open);
  relationshipSidebar.classList.toggle("is-open", visible);
  relationshipSidebar.inert = compact && !visible;
  relationshipSidebar.setAttribute("aria-hidden", String(compact && !visible));
  relationshipSidebarScrim.hidden = false;
  relationshipSidebarScrim.classList.toggle("is-open", visible);
  relationshipFilterButton.setAttribute("aria-expanded", String(visible));
  if (visible && options.focus !== false) {
    requestAnimationFrame(() => document.getElementById("relationshipSidebarClose").focus({ preventScroll: true }));
  } else if (!visible && options.restoreFocus) {
    relationshipFilterButton.focus({ preventScroll: true });
  }
}
function closeRelationshipSidebarAfterFilter() {
  if (relationshipCompactLayout()) setRelationshipSidebar(false, { restoreFocus: true });
}
