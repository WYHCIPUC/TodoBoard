/* - 头脑风暴：与灵感看板同级的多维知识碰撞工作台 - */
let brainstormMode = "fusion";
let brainstormLoadSequence = 0;
let brainstormController = null;
let productView = "inspiration";

function setProductView(view, options) {
  options = options || {};
  productView = ["relationship", "brainstorm"].includes(view) ? view : "inspiration";
  const brainstormActive = productView === "brainstorm";
  const relationshipActive = productView === "relationship";
  document.body.classList.toggle("brainstorm-active", brainstormActive);
  document.body.classList.toggle("relationship-active", relationshipActive);
  document.getElementById("brainstormView").hidden = !brainstormActive;
  document.getElementById("relationshipView").hidden = !relationshipActive;
  document.querySelectorAll("[data-product-view]").forEach(button => {
    const selected = button.dataset.productView === productView;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  setRelationshipSidebar(false, { focus: false });
  if (productView === "inspiration") requestAnimationFrame(syncSlider);
  try { localStorage.setItem("product_view", productView); } catch (_) {}
  if (brainstormActive && options.load !== false) {
    loadBrainstorm();
    loadBrainstormHistory();
  }
  if (relationshipActive) {
    if (options.load !== false) loadRelationship();
    else renderRelationship({ fit: options.fit !== false });
  }
  const surface = relationshipActive ? document.getElementById("relationshipView")
    : brainstormActive ? document.getElementById("brainstormView") : document.getElementById("banner");
  restartSurfaceMotion(surface);
  if (brainstormActive || relationshipActive) {
    window.scrollTo({ top: 0, behavior: options.instant || prefersReduce() ? "auto" : "smooth" });
  }
}

function startRelationshipVerification() {
  const item = selectedRelationshipItem();
  const goal = item
    ? `围绕“${item.name}”形成一套有来源依据、可回滚的最小验证方案`
    : "从当前知识关系中选择高价值连接，形成一套可验证的下一步方案";
  document.getElementById("brainstormGoal").value = goal;
  setProductView("brainstorm", { load: false, instant: true });
  activateBrainstormMode(document.querySelector('[data-brainstorm-mode="fusion"]'));
}

document.getElementById("relationshipNav").addEventListener("click", openRelationship);
document.getElementById("relationshipRefreshBtn").addEventListener("click", loadRelationship);
relationshipFilterButton.addEventListener("click", () => setRelationshipSidebar(true));
document.getElementById("relationshipSidebarClose").addEventListener("click", () => setRelationshipSidebar(false, { restoreFocus: true }));
relationshipSidebarScrim.addEventListener("click", () => setRelationshipSidebar(false, { restoreFocus: true }));
relationshipSidebar.addEventListener("pointerdown", event => {
  if (!relationshipCompactLayout() || !relationshipSidebar.classList.contains("is-open") || event.pointerType !== "touch") return;
  if (!event.target.closest(".relationship-sidebar-grab, .relationship-rail-heading") || event.target.closest("button")) return;
  if (relationshipSidebarGesture) return;
  relationshipSidebarGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    currentX: event.clientX,
    startedAt: performance.now(),
  };
  relationshipSidebar.classList.add("is-dragging");
  relationshipSidebar.setPointerCapture(event.pointerId);
});
relationshipSidebar.addEventListener("pointermove", event => {
  const gesture = relationshipSidebarGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  gesture.currentX = event.clientX;
  const distance = Math.min(0, event.clientX - gesture.startX);
  relationshipSidebar.style.transform = `translate3d(${distance}px, 0, 0)`;
  relationshipSidebarScrim.style.opacity = String(Math.max(0, 1 + distance / Math.max(1, relationshipSidebar.offsetWidth)));
  event.preventDefault();
});
function finishRelationshipSidebarGesture(event, cancelled = false) {
  const gesture = relationshipSidebarGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const distance = Math.min(0, gesture.currentX - gesture.startX);
  const elapsed = Math.max(1, performance.now() - gesture.startedAt);
  const velocity = Math.abs(distance) / elapsed;
  const dismiss = !cancelled && (distance < -72 || velocity > 0.35);
  if (relationshipSidebar.hasPointerCapture(event.pointerId)) relationshipSidebar.releasePointerCapture(event.pointerId);
  relationshipSidebarGesture = null;
  relationshipSidebar.classList.remove("is-dragging");
  relationshipSidebar.style.removeProperty("transform");
  relationshipSidebarScrim.style.removeProperty("opacity");
  setRelationshipSidebar(!dismiss, { focus: false, restoreFocus: dismiss });
}
relationshipSidebar.addEventListener("pointerup", event => finishRelationshipSidebarGesture(event));
relationshipSidebar.addEventListener("pointercancel", event => finishRelationshipSidebarGesture(event, true));
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !relationshipSidebar.classList.contains("is-open")) return;
  event.preventDefault();
  setRelationshipSidebar(false, { restoreFocus: true });
});
document.getElementById("relationshipDataBtn").addEventListener("click", () => document.getElementById("dataBtn").click());
document.getElementById("relationshipAddBtn").addEventListener("click", () => document.getElementById("addBtn").click());
document.getElementById("relationshipNoteBtn").addEventListener("click", () => {
  const item = selectedRelationshipItem();
  if (!item) { toast("请先选择一个节点", "err"); return; }
  openEntry(item.id, { returnView: "relationship" });
});
document.getElementById("relationshipVerifyBtn").addEventListener("click", startRelationshipVerification);
document.getElementById("relationshipArrangeBtn").addEventListener("click", () => {
  relationshipState.positions.clear();
  try { localStorage.removeItem("relationship_positions_v1"); } catch (_) {}
  renderRelationship({ fit: true });
  toast("已恢复自动关系布局", "ok");
});
function resetRelationshipFilters() {
  relationshipState.source = "all";
  relationshipState.archive = "all";
  relationshipState.scope = "all";
  document.querySelectorAll("[data-relationship-scope]").forEach(button => {
    const active = button.dataset.relationshipScope === "all";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-relationship-archive]").forEach(button => {
    const active = button.dataset.relationshipArchive === "all";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderRelationship({ fit: true });
  closeRelationshipSidebarAfterFilter();
}
document.getElementById("relationshipSourceReset").addEventListener("click", resetRelationshipFilters);
document.getElementById("relationshipEmpty").addEventListener("click", event => {
  if (event.target.closest("#relationshipClearFilters")) resetRelationshipFilters();
  if (event.target.closest("#relationshipEmptyAdd")) document.getElementById("addBtn").click();
});
document.querySelector(".relationship-scope").addEventListener("click", event => {
  const button = event.target.closest("[data-relationship-scope]");
  if (!button) return;
  relationshipState.scope = button.dataset.relationshipScope;
  document.querySelectorAll("[data-relationship-scope]").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  renderRelationship({ fit: true });
  closeRelationshipSidebarAfterFilter();
});
document.getElementById("relationshipSourceFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-relationship-source]");
  if (!button) return;
  relationshipState.source = button.dataset.relationshipSource;
  renderRelationship({ fit: true });
  closeRelationshipSidebarAfterFilter();
});
document.getElementById("relationshipArchiveFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-relationship-archive]");
  if (!button) return;
  relationshipState.archive = button.dataset.relationshipArchive;
  document.querySelectorAll("[data-relationship-archive]").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  renderRelationship({ fit: true });
  closeRelationshipSidebarAfterFilter();
});
document.getElementById("relationshipNodes").addEventListener("click", event => {
  const node = event.target.closest("[data-relationship-node]");
  if (!node || relationshipState.suppressClick) return;
  selectRelationshipNode(node.dataset.relationshipNode);
});
document.getElementById("relationshipDetailClose").addEventListener("click", () => {
  relationshipState.detailOpen = false;
  document.getElementById("relationshipDetail").classList.add("is-collapsed");
  document.getElementById("relationshipViewport").focus({ preventScroll: true });
});
document.getElementById("relationshipDetail").addEventListener("click", async event => {
  const related = event.target.closest("[data-relationship-select]");
  if (related) { selectRelationshipNode(related.dataset.relationshipSelect); return; }
  const action = event.target.closest("[data-relationship-action]");
  const item = selectedRelationshipItem();
  if (!action || !item) return;
  if (action.dataset.relationshipAction === "study") openEntry(item.id, { returnView: "relationship" });
  else if (action.dataset.relationshipAction === "verify") startRelationshipVerification();
  else if (action.dataset.relationshipAction === "copy") {
    if (item.url) await copyLink(item.url);
    else {
      try { await navigator.clipboard.writeText(`${item.id} · ${item.name}`); toast("本地线索已复制", "ok"); }
      catch (_) { toast("复制失败，请手动复制", "err"); }
    }
  }
});

const relationshipViewport = document.getElementById("relationshipViewport");
relationshipViewport.addEventListener("wheel", event => {
  event.preventDefault();
  setRelationshipZoom(relationshipState.zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
}, { passive: false });
relationshipViewport.addEventListener("dblclick", event => {
  if (!event.target.closest("[data-relationship-node]")) fitRelationshipView();
});
relationshipViewport.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const node = event.target.closest("[data-relationship-node]");
  if (node) {
    const point = relationshipState.positions.get(node.dataset.relationshipNode);
    if (!point) return;
    relationshipState.pointer = {
      type: "node", pointerId: event.pointerId, id: node.dataset.relationshipNode,
      startX: event.clientX, startY: event.clientY, pointX: point.x, pointY: point.y, moved: false,
    };
    node.classList.add("is-dragging");
    relationshipViewport.classList.add("is-dragging-node");
  } else {
    relationshipState.pointer = {
      type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      panX: relationshipState.panX, panY: relationshipState.panY, moved: false,
    };
    relationshipViewport.classList.add("is-panning");
    event.preventDefault();
  }
  relationshipViewport.setPointerCapture(event.pointerId);
});
relationshipViewport.addEventListener("pointermove", event => {
  const pointer = relationshipState.pointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  pointer.moved = pointer.moved || Math.hypot(dx, dy) > 4;
  if (pointer.type === "pan") {
    relationshipState.panX = pointer.panX + dx;
    relationshipState.panY = pointer.panY + dy;
    updateRelationshipTransform();
    return;
  }
  const point = {
    x: Math.max(10, Math.min(RELATIONSHIP_CANVAS.width - RELATIONSHIP_CANVAS.nodeWidth - 10, pointer.pointX + dx / relationshipState.zoom)),
    y: Math.max(10, Math.min(RELATIONSHIP_CANVAS.height - RELATIONSHIP_CANVAS.nodeHeight - 10, pointer.pointY + dy / relationshipState.zoom)),
  };
  relationshipState.positions.set(pointer.id, point);
  const node = document.querySelector(`[data-relationship-node="${CSS.escape(pointer.id)}"]`);
  if (node) {
    node.style.setProperty("--node-x", point.x + "px");
    node.style.setProperty("--node-y", point.y + "px");
  }
  const graph = relationshipFilteredGraph();
  relationshipRenderLinks(graph);
  relationshipRenderMinimap(graph);
});
function finishRelationshipPointer(event) {
  const pointer = relationshipState.pointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  if (relationshipViewport.hasPointerCapture(event.pointerId)) relationshipViewport.releasePointerCapture(event.pointerId);
  relationshipViewport.classList.remove("is-panning", "is-dragging-node");
  document.querySelector(".relationship-node.is-dragging")?.classList.remove("is-dragging");
  if (pointer.type === "node" && pointer.moved) {
    const point = relationshipState.positions.get(pointer.id);
    const graph = relationshipFilteredGraph();
    const semanticZone = relationshipLayout(graph.nodes).zones.find(zone => zone.nodeIds.has(pointer.id));
    const outsideSemanticZone = semanticZone && !relationshipPointInsideZone(point, semanticZone);
    const collides = graph.nodes.some(node => node.id !== pointer.id && relationshipPointsOverlap(point, relationshipState.positions.get(node.id)));
    if (outsideSemanticZone) {
      renderRelationship();
      toast("节点已留在所属主题分区", "ok");
    } else if (collides) {
      relationshipState.positions.set(pointer.id, { x: pointer.pointX, y: pointer.pointY });
      renderRelationship();
      toast("节点之间需要留出一点空间", "err");
    } else {
      const dropped = { x: point.x, y: point.y };
      saveRelationshipPositions();
      renderRelationship();
      const settled = relationshipState.positions.get(pointer.id);
      if (Math.abs(settled.x - dropped.x) > 1 || Math.abs(settled.y - dropped.y) > 1) toast("节点已留在所属主题分区", "ok");
    }
    relationshipState.suppressClick = true;
    setTimeout(() => { relationshipState.suppressClick = false; }, 0);
  }
  relationshipState.pointer = null;
}
relationshipViewport.addEventListener("pointerup", finishRelationshipPointer);
relationshipViewport.addEventListener("pointercancel", finishRelationshipPointer);
relationshipViewport.addEventListener("keydown", event => {
  if (["+", "="].includes(event.key)) { event.preventDefault(); setRelationshipZoom(relationshipState.zoom * 1.12); }
  else if (event.key === "-") { event.preventDefault(); setRelationshipZoom(relationshipState.zoom * 0.88); }
  else if (event.key === "0" || event.key === "Home") { event.preventDefault(); fitRelationshipView(); }
  else if (event.key === "Escape") {
    relationshipState.selectedId = null;
    renderRelationship();
  }
});
document.getElementById("relationshipZoomIn").addEventListener("click", () => setRelationshipZoom(relationshipState.zoom * 1.12));
document.getElementById("relationshipZoomOut").addEventListener("click", () => setRelationshipZoom(relationshipState.zoom * 0.88));
document.getElementById("relationshipResetView").addEventListener("click", fitRelationshipView);
let relationshipResizeTimer = null;
window.addEventListener("resize", () => {
  if (productView !== "relationship") return;
  clearTimeout(relationshipResizeTimer);
  relationshipResizeTimer = setTimeout(() => {
    setRelationshipSidebar(false, { focus: false });
    renderRelationship();
    fitRelationshipView();
  }, 120);
});

function brainstormPositions(nodes, width, height) {
  const groups = new Map();
  nodes.forEach(node => {
    if (!groups.has(node.cluster)) groups.set(node.cluster, []);
    groups.get(node.cluster).push(node);
  });
  const clusters = [...groups.values()].sort((a, b) => b.length - a.length);
  const positions = new Map();
  const centerX = width / 2, centerY = height / 2;
  const orbitX = Math.max(80, width * 0.29), orbitY = Math.max(62, height * 0.25);
  clusters.forEach((members, clusterIndex) => {
    const clusterAngle = clusters.length === 1 ? 0 : Math.PI * 2 * clusterIndex / clusters.length - Math.PI / 2;
    const cx = clusters.length === 1 ? centerX : centerX + Math.cos(clusterAngle) * orbitX;
    const cy = clusters.length === 1 ? centerY : centerY + Math.sin(clusterAngle) * orbitY;
    members.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id, "en", { numeric: true }));
    if (members.length === 1) {
      positions.set(members[0].id, { x: cx, y: cy });
      return;
    }
    members.forEach((node, memberIndex) => {
      if (memberIndex === 0) {
        positions.set(node.id, { x: cx, y: cy });
        return;
      }
      const ringIndex = Math.floor((memberIndex - 1) / 10);
      const ringStart = ringIndex * 10 + 1;
      const ringCount = Math.min(10, members.length - ringStart);
      const angle = Math.PI * 2 * (memberIndex - ringStart) / Math.max(1, ringCount) + clusterAngle;
      const radius = 38 + ringIndex * 34 + Math.min(28, members.length * 2);
      positions.set(node.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    });
  });
  return positions;
}

function graphTextColor(color) {
  const match = String(color || "").match(/^#([0-9a-f]{6})$/i);
  if (!match) return "#ffffff";
  const value = parseInt(match[1], 16);
  const red = value >> 16, green = value >> 8 & 255, blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 155 ? "#0b0b10" : "#ffffff";
}

function renderBrainstormGraph(graph) {
  const container = document.getElementById("brainstormGraph");
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
  if (!nodes.length) {
    container.innerHTML = '<div class="brainstorm-empty">还没有可分析的事项。先新增至少两个待研究条目。</div>';
    return;
  }
  const width = 760, height = 480;
  const positions = brainstormPositions(nodes, width, height);
  const links = edges.map(edge => {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b) return "";
    const relationClass = (edge.types || []).includes("cross") ? " relation-cross" : (edge.types || []).includes("source") ? " relation-source" : "";
    return `<line class="brainstorm-link${relationClass}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-width="${(0.8 + edge.weight * 2.4).toFixed(1)}" opacity="${(0.2 + edge.weight * 0.55).toFixed(2)}"><title>${escapeHtml((edge.relation || "关联") + " · " + (edge.signals || []).join(" / "))}</title></line>`;
  }).join("");
  const showAllLabels = nodes.length <= 18;
  const nodeHtml = nodes.map(node => {
    const point = positions.get(node.id);
    const radius = Math.min(15, 7 + (node.degree || 0) * 1.6);
    const nodeColor = catColor(node.category);
    const textColor = graphTextColor(nodeColor);
    const label = node.title.length > 12 ? node.title.slice(0, 11) + "…" : node.title;
    const showLabel = showAllLabels || node.degree >= 3;
    return `<g class="brainstorm-node" data-brainstorm-entry="${escapeAttr(node.id)}" role="button" tabindex="0" aria-label="打开 ${escapeAttr(node.title)}">
      <title>${escapeHtml(node.id + " · " + node.title + " · " + node.category)}</title>
      <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${escapeAttr(nodeColor)}" opacity="${node.status === "done" ? "0.58" : "0.95"}"></circle>
      <text class="node-id" x="${point.x.toFixed(1)}" y="${(point.y + 2.8).toFixed(1)}" fill="${textColor}">${escapeHtml(node.id)}</text>
      ${showLabel ? `<text class="node-label" x="${point.x.toFixed(1)}" y="${(point.y + radius + 14).toFixed(1)}">${escapeHtml(label)}</text>` : ""}
    </g>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${nodes.length} 个事项、${edges.length} 条关联组成的知识图谱">${links}${nodeHtml}</svg>`;
}

function renderBrainstormDimensions(dimensions) {
  const container = document.getElementById("brainstormDimensions");
  const items = (dimensions || []).filter(item => item.count > 0);
  if (!items.length) {
    container.innerHTML = '<div class="brainstorm-empty">当前数据还不足以形成多维关系。</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <article class="brainstorm-dimension-card" data-dimension="${escapeAttr(item.id)}">
      <div class="dimension-top"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.count)}</b></div>
      <p>${escapeHtml(item.description)}</p>
      <div class="brainstorm-signals">${(item.signals || []).map(signal => `<span>${escapeHtml(signal)}</span>`).join("")}</div>
      <div class="brainstorm-evidence">${(item.evidence || []).slice(0, 3).map(entry => `<button type="button" data-brainstorm-entry="${escapeAttr(entry.id)}" title="${escapeAttr(entry.title)}">${escapeHtml(entry.id)}</button>`).join("")}</div>
    </article>`).join("");
}

function renderBrainstormMatrix(matrix) {
  const container = document.getElementById("brainstormMatrix");
  if (!matrix || !matrix.length) {
    container.innerHTML = '<div class="brainstorm-empty">暂未发现跨分类碰撞；补充场景和能力标签后会自动更新。</div>';
    return;
  }
  container.innerHTML = matrix.map(item => `
    <article class="brainstorm-matrix-row">
      <div class="matrix-pair"><strong>${escapeHtml(item.source)}</strong><span>×</span><strong>${escapeHtml(item.target)}</strong></div>
      <div class="matrix-score"><span style="width:${Math.max(8, item.strength)}%"></span></div>
      <div class="matrix-meta"><span>${escapeHtml(item.count)} 条连接</span><b>${escapeHtml(item.strength)}%</b></div>
      <div class="brainstorm-signals">${(item.signals || []).map(signal => `<span>${escapeHtml(signal)}</span>`).join("")}</div>
      <div class="brainstorm-evidence">${(item.evidence || []).map(entry => `<button type="button" data-brainstorm-entry="${escapeAttr(entry.id)}" title="${escapeAttr(entry.title)}">${escapeHtml(entry.id + " · " + entry.title)}</button>`).join("")}</div>
    </article>`).join("");
}

function renderBrainstormFusion(fusion) {
  const container = document.getElementById("brainstormFusion");
  const meta = document.getElementById("brainstormFusionMeta");
  if (!fusion || !fusion.goal) {
    meta.textContent = "先输入一个实际需求，再开始能力融合";
    container.innerHTML = '<div class="brainstorm-empty">请先描述你真正想解决的问题、使用场景或偏好结果。</div>';
    return;
  }
  const plans = fusion.plans || [];
  meta.textContent = `找到 ${fusion.matches.length} 个候选项目，形成 ${plans.length} 条路径 · 点击项目查看研究档案`;
  if (!plans.length) {
    container.innerHTML = '<div class="brainstorm-empty">当前记录还不足以组成融合方案，请补充相关项目或更具体地描述需求。</div>';
    return;
  }
  const featured = plans[0];
  const contributionHtml = (item, compact = false) => (item.contributions || []).map((contribution, contributionIndex) => `
    <div class="fusion-contribution${compact ? " compact" : ""}">
      <span class="fusion-index">${String(contributionIndex + 1).padStart(2, "0")}</span>
      <div><button type="button" data-brainstorm-entry="${escapeAttr(contribution.id)}">${escapeHtml(contribution.title)}</button><strong>${escapeHtml(contribution.strength)}</strong>${compact ? "" : `<small>${escapeHtml(contribution.reason)}</small>`}</div>
    </div>`).join("");
  container.innerHTML = `
    <article class="brainstorm-fusion-card featured">
      <div class="fusion-card-top"><span>推荐方案</span><b>${escapeHtml(featured.score)} 分 · ${escapeHtml(featured.confidence)}置信度</b></div>
      <div class="fusion-featured-head">
        <div><span>融合目标</span><h3>${escapeHtml(featured.goal)}</h3></div>
        <p>${escapeHtml(featured.summary)}</p>
      </div>
      <div class="fusion-featured-grid">
        <div class="fusion-source-column"><h4>这些项目分别贡献什么</h4><div class="fusion-recipe">${contributionHtml(featured)}</div><p class="fusion-rationale">${escapeHtml(featured.rationale)}</p></div>
        <aside class="fusion-mvp"><span>最小验证路径</span><ol>${(featured.mvp || []).map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol></aside>
      </div>
      ${featured.priorVerification ? `<p class="fusion-prior is-${escapeAttr(featured.priorVerification.status)}"><strong>历史${featured.priorVerification.status === "verified" ? "已验证" : "被否定"}</strong>：相似目标「${escapeHtml(featured.priorVerification.goal)}」${featured.priorVerification.result ? " · " + escapeHtml(featured.priorVerification.result) : ""} · 证据覆盖 ${Number(featured.priorVerification.evidenceCoverage) || 0}%${featured.priorVerification.reviewedAt ? " · 复盘 " + escapeHtml(lifecycleDayLabel(featured.priorVerification.reviewedAt)) : ""}</p>` : ""}
    </article>
    ${plans.length > 1 ? `<div class="fusion-alternatives"><div class="fusion-alternatives-title"><strong>备选组合</strong><span>需要更多方向时再展开</span></div>${plans.slice(1).map(item => `
      <details class="brainstorm-fusion-alt">
        <summary><span><b>${escapeHtml(item.type)}</b><small>${escapeHtml((item.evidence || []).map(entry => entry.title).join(" + "))}</small></span><em>${escapeHtml(item.score)} 分</em></summary>
        <div class="fusion-alt-body"><p>${escapeHtml(item.summary)}</p><div class="fusion-recipe">${contributionHtml(item, true)}</div><strong>验证步骤</strong><ol>${(item.mvp || []).map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol></div>
      </details>`).join("")}</div>` : ""}`;
}

function updateBrainstormPanels(mode = brainstormMode) {
  const fusionMode = mode === "fusion";
  const panoramaMode = mode === "panorama";
  const suggestionMode = ["opportunities", "challenges", "roadmap"].includes(mode);
  document.getElementById("brainstormFusionPanel").hidden = !fusionMode;
  document.getElementById("brainstormDimensionsPanel").hidden = !panoramaMode;
  document.getElementById("brainstormNetworkPanel").hidden = !panoramaMode;
  const suggestionPanel = document.getElementById("brainstormSuggestionsPanel");
  suggestionPanel.hidden = !suggestionMode;
  if (suggestionMode) {
    const activeTab = document.querySelector(`[data-brainstorm-mode="${mode}"]`);
    suggestionPanel.setAttribute("aria-labelledby", `${activeTab.id} brainstormSuggestionsTitle`);
  }
  const labels = {
    opportunities: ["可验证的机会", "从组合、迁移与成果复用中选择下一步"],
    challenges: ["盲区与证据缺口", "先补齐依据，再决定是否投入"],
    roadmap: ["建议行动路线", "按价值、关联度和验证成本安排顺序"],
  };
  if (labels[mode]) {
    document.getElementById("brainstormSuggestionsTitle").textContent = labels[mode][0];
    document.querySelector("#brainstormSuggestionsPanel .brainstorm-section-head span").textContent = labels[mode][1];
  }
}

function renderBrainstormSuggestions(suggestions) {
  const container = document.getElementById("brainstormSuggestions");
  if (!suggestions || !suggestions.length) {
    container.innerHTML = '<div class="brainstorm-empty">暂时没有形成可靠建议。为条目补充标签和收藏原因后再分析。</div>';
    return;
  }
  const dimensionLabels = {
    cross: "组合碰撞", transfer: "跨域迁移", compare: "同类对照", theme: "主题经营",
    opportunity: "机会验证", challenge: "盲区挑战", roadmap: "行动路线",
    fusion: "需求融合",
  };
  container.innerHTML = suggestions.map(item => `
    <article class="brainstorm-suggestion">
      <div class="idea-top"><span class="idea-type">${escapeHtml(item.type)}</span><span class="idea-dimension">${escapeHtml(dimensionLabels[item.dimension] || "综合分析")}</span><span class="idea-confidence">置信度 ${escapeHtml(item.confidence)}</span><span class="idea-score">${escapeHtml(item.score)} 分</span></div>
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.summary)}</p>
      <div class="brainstorm-signals">${(item.signals || []).map(signal => `<span>${escapeHtml(signal)}</span>`).join("")}</div>
      <p>${escapeHtml(item.rationale)}</p>
      <div class="brainstorm-evidence">${(item.evidence || []).map(entry => `<button type="button" data-brainstorm-entry="${escapeAttr(entry.id)}" title="${escapeAttr(entry.title)}">${escapeHtml(entry.id + " · " + entry.title)}</button>`).join("")}</div>
      <details><summary>查看最小验证步骤</summary><ol>${(item.mvp || []).map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol></details>
    </article>`).join("");
}

function renderBrainstorm(data) {
  const summary = data.summary || {};
  document.getElementById("brainstormSummary").innerHTML = [
    [summary.items || 0, "项目"], [summary.relations || 0, "关系"], [(summary.archiveCoverage || 0) + "%", "档案覆盖"],
  ].map(([value, label]) => `<span class="bs-stat"><b>${escapeHtml(value)}</b>${escapeHtml(label)}</span>`).join("");
  document.getElementById("brainstormInsights").innerHTML = (data.insights || []).map(item => `<span>${escapeHtml(item)}</span>`).join("");
  renderBrainstormFusion(data.fusion);
  renderBrainstormDimensions(data.dimensions);
  renderBrainstormGraph(data.graph);
  renderBrainstormMatrix(data.collisionMatrix);
  renderBrainstormSuggestions(data.suggestions);
  updateBrainstormPanels();
}

async function loadBrainstorm() {
  const sequence = ++brainstormLoadSequence;
  if (brainstormController) brainstormController.abort();
  brainstormController = new AbortController();
  const graph = document.getElementById("brainstormGraph");
  const fusion = document.getElementById("brainstormFusion");
  const dimensions = document.getElementById("brainstormDimensions");
  const matrix = document.getElementById("brainstormMatrix");
  const suggestions = document.getElementById("brainstormSuggestions");
  const button = document.getElementById("brainstormRefreshBtn");
  const saveButton = document.getElementById("brainstormSaveBtn");
  const goalButton = document.getElementById("brainstormGoalBtn");
  const goal = document.getElementById("brainstormGoal").value.trim().slice(0, 400);
  if (!goal && !state.demoMode) {
    brainstormController = null;
    brainstormLastAnalysis = null;
    document.getElementById("brainstormSummary").textContent = "先写下一个真实问题，再从收藏中寻找组合方案";
    document.getElementById("brainstormInsights").innerHTML = "";
    graph.innerHTML = '<div class="brainstorm-empty">输入需求后，这里会展示可追溯的项目关系。</div>';
    fusion.innerHTML = '<div class="brainstorm-empty brainstorm-goal-empty"><strong>先明确这次要解决的问题</strong><span>可以直接输入，也可以选择上方示例。分析只读取本机项目，不会上传 DATA.md。</span></div>';
    dimensions.innerHTML = '<div class="brainstorm-empty">完成第一次融合后可查看分析维度。</div>';
    matrix.innerHTML = '<div class="brainstorm-empty">完成第一次融合后可查看跨域碰撞。</div>';
    suggestions.innerHTML = '<div class="brainstorm-empty">机会、盲区和路线会在形成分析后出现。</div>';
    updateBrainstormPanels();
    setButtonBusy(button, false);
    setButtonBusy(goalButton, false);
    saveButton.disabled = true;
    return;
  }
  graph.innerHTML = '<div class="brainstorm-loading">正在计算事项关联…</div>';
  fusion.innerHTML = '<div class="brainstorm-loading">正在围绕实际需求抽取项目长处…</div>';
  dimensions.innerHTML = '<div class="brainstorm-loading">正在展开分析维度…</div>';
  matrix.innerHTML = '<div class="brainstorm-loading">正在计算跨域碰撞…</div>';
  suggestions.innerHTML = '<div class="brainstorm-loading">正在生成多维建议…</div>';
  brainstormLastAnalysis = null;
  setButtonBusy(button, true, "分析中…");
  setButtonBusy(goalButton, true, "融合中…");
  saveButton.disabled = true;
  try {
    try { localStorage.setItem("brainstorm_goal", goal); } catch (_) {}
    const endpoint = state.demoMode
      ? "demo-brainstorm.json"
      : "/api/brainstorm?mode=" + encodeURIComponent(brainstormMode) + "&goal=" + encodeURIComponent(goal);
    const response = state.demoMode ? await fetch(endpoint, {
      cache: "no-store",
      signal: brainstormController.signal,
    }) : await localApiFetch(endpoint, {
      cache: "no-store",
      signal: brainstormController.signal,
    });
    const data = await readJsonResponse(response);
    if (sequence !== brainstormLoadSequence) return;
    if (!data.ok) throw new Error(data.error || "分析失败");
    brainstormLastAnalysis = data;
    renderBrainstorm(data);
  } catch (error) {
    if (error.name === "AbortError" || sequence !== brainstormLoadSequence) return;
    const message = escapeHtml(error.message);
    graph.innerHTML = `<div class="brainstorm-empty brainstorm-error">知识图谱生成失败：${message}</div>`;
    fusion.innerHTML = `<div class="brainstorm-empty brainstorm-error">需求融合失败：${message}</div>`;
    dimensions.innerHTML = `<div class="brainstorm-empty brainstorm-error">分析维度生成失败：${message}</div>`;
    matrix.innerHTML = `<div class="brainstorm-empty brainstorm-error">碰撞矩阵生成失败：${message}</div>`;
    suggestions.innerHTML = `<div class="brainstorm-empty brainstorm-error">建议生成失败：${message}<br>如果刚升级，请关闭旧服务后重新运行 start.bat。</div>`;
  } finally {
    if (sequence !== brainstormLoadSequence) return;
    brainstormController = null;
    setButtonBusy(button, false);
    setButtonBusy(goalButton, false);
    goalButton.disabled = state.demoMode;
    saveButton.disabled = !state.httpMode || !brainstormLastAnalysis;
  }
}

const BRAINSTORM_VERIFY_META = Object.freeze({
  pending: { label: "待验证", tone: "pending" },
  verified: { label: "已验证", tone: "verified" },
  rejected: { label: "被否定", tone: "rejected" },
});
let brainstormHistoryItems = [];
let brainstormVerifyTarget = null;

function renderBrainstormHistory(items) {
  const container = document.getElementById("brainstormHistory");
  brainstormHistoryItems = Array.isArray(items) ? items : [];
  if (!brainstormHistoryItems.length) {
    container.innerHTML = '<div class="brainstorm-history-empty">保存本轮方案后，会在这里形成决策记录。</div>';
    return;
  }
  container.innerHTML = brainstormHistoryItems.map(item => {
    const created = item.createdAt && !Number.isNaN(new Date(item.createdAt).getTime())
      ? new Date(item.createdAt).toLocaleString() : "未知时间";
    const verification = item.verification || { status: "pending", result: "", reviewedAt: null, evidenceCoverage: 0 };
    const meta = BRAINSTORM_VERIFY_META[verification.status] || BRAINSTORM_VERIFY_META.pending;
    const reviewed = verification.reviewedAt ? ` · 复盘 ${lifecycleDayLabel(verification.reviewedAt)}` : "";
    const url = "/api/brainstorm/report?id=" + encodeURIComponent(item.id);
    return `<div class="brainstorm-history-row">
      <a class="brainstorm-history-item" href="${escapeAttr(url)}" title="下载 Markdown 方案">
        <span><strong>${escapeHtml(item.goal)}</strong><small>${escapeHtml(created)} · ${escapeHtml(item.topPlan || "综合方案")} · ${escapeHtml(item.sourceCount || 0)} 个来源 · 证据覆盖 ${Number(verification.evidenceCoverage) || 0}%${escapeHtml(reviewed)}</small></span>
        <b>下载 Markdown</b>
      </a>
      <div class="brainstorm-history-verify">
        <span class="bh-status is-${escapeAttr(meta.tone)}">${escapeHtml(meta.label)}</span>
        ${verification.result ? `<small title="${escapeAttr(verification.result)}">${escapeHtml(verification.result)}</small>` : ""}
        <button type="button" class="btn" data-brainstorm-verify="${escapeAttr(item.id)}">记录验证</button>
      </div>
    </div>`;
  }).join("");
}

async function loadBrainstormHistory() {
  const container = document.getElementById("brainstormHistory");
  if (state.demoMode) {
    container.innerHTML = '<div class="brainstorm-history-empty">在线 Demo 不保存方案；本地版会把每轮结果沉淀为 Markdown 决策记录。</div>';
    return;
  }
  try {
    const response = await localApiFetch("/api/brainstorm/history", { cache: "no-store" });
    const data = await readJsonResponse(response);
    renderBrainstormHistory(data.items || []);
  } catch (error) {
    container.innerHTML = `<div class="brainstorm-history-empty">保存记录读取失败：${escapeHtml(error.message)}</div>`;
  }
}

function openBrainstormVerify(id) {
  const item = brainstormHistoryItems.find(entry => entry.id === String(id));
  if (!item) { toast("方案记录已变化，请重新读取", "err"); return; }
  brainstormVerifyTarget = item;
  const verification = item.verification || { status: "pending", result: "", reviewedAt: null, evidenceCoverage: 0 };
  document.getElementById("brainstormVerifyGoal").textContent = `${item.goal} · ${item.topPlan || "综合方案"}`;
  document.getElementById("brainstormVerifyStatus").value = verification.status;
  document.getElementById("brainstormVerifyDate").value = reviewDateValue(verification.reviewedAt) || reviewDateValue(new Date().toISOString());
  document.getElementById("brainstormVerifyResult").value = verification.result || "";
  document.getElementById("brainstormVerifyCoverage").textContent = `来源证据覆盖率：${Number(verification.evidenceCoverage) || 0}%（保存方案时的研究档案覆盖率）`;
  document.getElementById("brainstormVerifyModal").classList.add("open");
}

async function saveBrainstormVerification() {
  if (!brainstormVerifyTarget) return;
  const button = document.getElementById("brainstormVerifySave");
  const status = document.getElementById("brainstormVerifyStatus").value;
  const reviewedAt = status === "pending" ? null : dateValueToIso(document.getElementById("brainstormVerifyDate").value);
  if (status !== "pending" && !reviewedAt) { toast("请选择有效的复盘日期", "err"); return; }
  setButtonBusy(button, true, "保存中…");
  try {
    const response = await localApiFetch("/api/brainstorm/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: brainstormVerifyTarget.id,
        status,
        result: document.getElementById("brainstormVerifyResult").value,
        reviewedAt,
      }),
    });
    await readJsonResponse(response);
    document.getElementById("brainstormVerifyModal").classList.remove("open");
    await loadBrainstormHistory();
    toast("方案验证已保存", "ok");
  } catch (error) {
    toast("验证保存失败：" + error.message, "err");
  } finally {
    setButtonBusy(button, false);
  }
}

document.getElementById("brainstormHistory").addEventListener("click", event => {
  const button = event.target.closest("[data-brainstorm-verify]");
  if (!button) return;
  event.preventDefault();
  openBrainstormVerify(button.dataset.brainstormVerify);
});
document.getElementById("brainstormVerifySave").addEventListener("click", saveBrainstormVerification);

async function saveBrainstormReport() {
  if (!requireService("保存头脑风暴方案")) return;
  if (!brainstormLastAnalysis) { toast("请先完成本轮分析", "err"); return; }
  const button = document.getElementById("brainstormSaveBtn");
  setButtonBusy(button, true, "保存中…");
  try {
    const goal = String(brainstormLastAnalysis.fusion && brainstormLastAnalysis.fusion.goal || "").trim().slice(0, 400);
    const mode = brainstormLastAnalysis.mode || brainstormMode;
    const response = await localApiFetch("/api/brainstorm/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, mode }),
    });
    const data = await readJsonResponse(response);
    toast("本轮方案已保存为本地 Markdown", "ok");
    await loadBrainstormHistory();
  } catch (error) {
    toast("方案保存失败：" + error.message, "err");
  } finally {
    setButtonBusy(button, false);
    button.disabled = !state.httpMode || !brainstormLastAnalysis;
  }
}

function openBrainstorm() {
  if (!state.httpMode && !state.demoMode) { toast("请先启动本地服务", "err"); return; }
  if (!state.items.length) { toast("请先新增至少一个待研究事项", "err"); return; }
  setProductView("brainstorm");
}

document.getElementById("brainstormBtn").addEventListener("click", openBrainstorm);
document.getElementById("brainstormBridgeBtn").addEventListener("click", openBrainstorm);
document.getElementById("inspirationNav").addEventListener("click", () => setProductView("inspiration"));
document.getElementById("brainstormRefreshBtn").addEventListener("click", () => {
  if (!document.getElementById("brainstormGoal").value.trim() && !state.demoMode) {
    toast("请先写下一个实际需求", "err");
    document.getElementById("brainstormGoal").focus({ preventScroll: true });
    return;
  }
  loadBrainstorm();
});
document.getElementById("brainstormSaveBtn").addEventListener("click", saveBrainstormReport);
function activateBrainstormMode(button, options = {}) {
  if (!button) return;
  brainstormMode = button.dataset.brainstormMode;
  document.querySelectorAll("[data-brainstorm-mode]").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  updateBrainstormPanels(brainstormMode);
  if (options.focus) button.focus({ preventScroll: true });
  if (options.load !== false) loadBrainstorm();
}
try {
  const savedBrainstormGoal = localStorage.getItem("brainstorm_goal");
  if (savedBrainstormGoal) document.getElementById("brainstormGoal").value = savedBrainstormGoal;
} catch (_) {}
document.getElementById("brainstormGoalForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!document.getElementById("brainstormGoal").value.trim()) { toast("请先输入一个实际需求", "err"); return; }
  activateBrainstormMode(document.querySelector('[data-brainstorm-mode="fusion"]'));
});
document.querySelectorAll("[data-brainstorm-goal]").forEach(button => button.addEventListener("click", () => {
  document.getElementById("brainstormGoal").value = button.dataset.brainstormGoal;
  document.getElementById("brainstormGoalForm").requestSubmit();
}));
document.querySelectorAll("[data-brainstorm-mode]").forEach(button => button.addEventListener("click", () => {
  activateBrainstormMode(button);
}));
document.querySelector(".brainstorm-modes").addEventListener("keydown", e => {
  if (!e.target.matches("[data-brainstorm-mode]")) return;
  const tabs = [...e.currentTarget.querySelectorAll("[data-brainstorm-mode]")];
  const current = tabs.indexOf(e.target);
  let next = current;
  if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
  else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = tabs.length - 1;
  else return;
  e.preventDefault();
  activateBrainstormMode(tabs[next], { focus: true });
});
document.getElementById("brainstormView").addEventListener("click", e => {
  const target = e.target.closest("[data-brainstorm-entry]");
  if (!target) return;
  setProductView("inspiration", { load: false, instant: true });
  openEntry(target.dataset.brainstormEntry, { returnView: "brainstorm" });
});
document.getElementById("brainstormView").addEventListener("keydown", e => {
  if (!e.target.matches(".brainstorm-node") || !["Enter", " "].includes(e.key)) return;
  e.preventDefault();
  e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
