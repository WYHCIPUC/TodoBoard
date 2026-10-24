"use strict";

const fs = require("fs");
const path = require("path");
const schema = require("./schema");
const entries = require("./entries");
const archiveContent = require("./archive-content");

const MAX_ITEMS = 300;
const MAX_ARCHIVE_TEXT = 24 * 1024;
const STOP_WORDS = new Set([
  "一个", "一些", "以及", "这个", "这些", "通过", "进行", "可以", "支持", "相关", "当前", "项目", "研究", "功能",
  "使用", "作者", "来源", "链接", "原文", "视频", "内容", "介绍", "教程", "待补充", "github", "https", "http", "www",
  "补充", "封面", "简介", "难度", "要点", "公众", "文章", "仓库", "文件", "页面", "数据", "信息", "相关链接",
  "为什么", "收藏", "关键", "发现", "行动", "结论", "下载", "安装", "体验", "截图", "采用", "评价", "模板",
  "自己", "属于", "符合", "制作", "打造", "希望", "需要", "想要", "能够",
  "com", "org", "the", "and", "for", "with", "from", "into", "that", "this", "you", "your",
]);
const STATUS_KEYS = { "⏳": "pending", "🔄": "doing", "✅": "done" };
const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "word" })
  : null;

function round(value, places) {
  const p = Math.pow(10, places || 0);
  return Math.round(value * p) / p;
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/<!--[^>]*-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[*_`>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const text = stripMarkdown(value).toLowerCase();
  const result = new Set();
  const add = token => {
    token = String(token || "").trim().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
    if (token.length < 2 || token.length > 28 || /^\d+(?:\.\d+)?$/.test(token) || STOP_WORDS.has(token)) return;
    result.add(token);
  };
  if (segmenter) {
    for (const part of segmenter.segment(text)) {
      if (part.isWordLike) add(part.segment);
    }
  } else {
    for (const token of text.match(/[\p{L}\p{N}]+/gu) || []) add(token);
  }
  for (const token of text.match(/[a-z][a-z0-9.+#-]{1,27}/g) || []) add(token);
  return result;
}

function categoryMap(text) {
  const map = new Map();
  let category = "其他";
  for (const line of String(text || "").split(/\r?\n/)) {
    const section = line.match(/^##\s+(?:\d+\.\s*)?(.+)$/);
    if (section) {
      category = section[1].replace(/^[^\p{L}\p{N}]+/u, "").trim() || "其他";
      continue;
    }
    const head = line.match(schema.ENTRY_HEAD_RE);
    if (head) map.set(head[2], category);
  }
  return map;
}

function readLimited(file) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return "";
    return fs.readFileSync(file).subarray(0, MAX_ARCHIVE_TEXT).toString("utf8");
  } catch (_) { return ""; }
}

function archiveData(entry, rootDir) {
  const root = path.resolve(rootDir || entries.ENTRIES_DIR);
  const key = schema.UID_RE.test(entry.uid || "") ? entry.uid : entry.id;
  const dir = path.resolve(root, key);
  if (dir !== root && !dir.startsWith(root + path.sep)) return { notes: "", content: "" };
  return {
    notes: readLimited(path.join(dir, "notes.md")),
    content: (() => {
      try { return archiveContent.readCanonicalContent(root, key, { limit: MAX_ARCHIVE_TEXT }) || ""; }
      catch (_) { return ""; }
    })(),
  };
}

function tagsOf(fields) {
  const value = Object.entries(fields || {})
    .filter(([key]) => /标签|tag/i.test(key))
    .map(([, field]) => field)
    .join(",");
  return [...new Set(value.split(/[,，、;；]/).map(stripMarkdown).filter(Boolean).map(tag => tag.toLowerCase()))];
}

function difficultyOf(fields) {
  const value = Object.entries(fields || {}).find(([key]) => /难度/.test(key));
  if (!value) return 1;
  const stars = (String(value[1]).match(/[⭐★]/g) || []).length;
  return Math.max(1, Math.min(3, stars || Number(String(value[1]).match(/[1-3]/)?.[0]) || 1));
}

function domainOf(value) {
  try { return new URL(value).hostname.replace(/^www\./, ""); }
  catch (_) { return ""; }
}

function buildNodes(dataText, options) {
  options = options || {};
  const categories = categoryMap(dataText);
  // analyze() 已经解析过条目时复用同一结果，避免对同一份数据重复扫描。
  const scanned = Array.isArray(options.scannedEntries) ? options.scannedEntries : schema.scanEntries(dataText);
  const nodes = scanned.slice(0, MAX_ITEMS).map(entry => {
    const fieldsText = Object.entries(entry.fields || {})
      .filter(([key]) => !/作者|来源|封面|难度|数据|网址|链接/.test(key))
      .map(([, value]) => value)
      .join("\n");
    const archive = archiveData(entry, options && options.entriesDir);
    const tags = tagsOf(entry.fields);
    const tokens = tokenize(entry.title + "\n" + (categories.get(entry.id) || "") + "\n" + fieldsText + "\n" + archive.notes);
    tags.forEach(tag => tokenize(tag).forEach(token => tokens.add(token)));
    return {
      id: entry.id,
      uid: entry.uid,
      title: entry.title,
      category: categories.get(entry.id) || "其他",
      status: STATUS_KEYS[entry.status] || "pending",
      difficulty: difficultyOf(entry.fields),
      url: entry.url || "",
      domain: domainOf(entry.url),
      tags,
      tokens,
      hasArchive: stripMarkdown(archive.notes + "\n" + archive.content).length > 80,
      degree: 0,
      cluster: 0,
    };
  });
  const documentFrequency = new Map();
  nodes.forEach(node => node.tokens.forEach(token => documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)));
  const highFrequencyLimit = Math.max(3, Math.floor(nodes.length * 0.36));
  nodes.forEach(node => {
    node.tokens = new Set([...node.tokens].filter(token => (documentFrequency.get(token) || 0) <= highFrequencyLimit));
  });
  return nodes;
}

function intersection(a, b) {
  const common = [];
  for (const value of a) if (b.has(value)) common.push(value);
  return common.sort((x, y) => y.length - x.length || x.localeCompare(y, "zh-CN"));
}

function buildEdges(nodes) {
  const candidates = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const sharedTags = a.tags.filter(tag => b.tags.includes(tag));
      const common = intersection(a.tokens, b.tokens).slice(0, 5);
      const sameDomain = Boolean(a.domain && a.domain === b.domain);
      const sameCategory = a.category === b.category;
      const difficultyGap = Math.abs(a.difficulty - b.difficulty);
      const semantic = sharedTags.length * 3.2 + common.length * 1.45;
      const raw = semantic + (sameDomain ? 1.5 : 0) + (sameCategory ? 0.65 : 0);
      if (semantic < 1.4 && !sameDomain) continue;
      if (raw < 2.05 && !(sameDomain && (sameCategory || common.length))) continue;
      const signals = [...sharedTags, ...common].filter((value, index, list) => list.indexOf(value) === index).slice(0, 4);
      const types = [];
      if (sharedTags.length || common.length) types.push("theme");
      if (sameDomain) types.push("source");
      if (sameCategory) types.push("portfolio");
      if (!sameCategory && semantic >= 1.4) types.push("cross");
      if (!sameCategory && (sharedTags.length || common.length >= 2)) types.push("complement");
      if (difficultyGap > 0 && (sameCategory || semantic >= 2.8)) types.push("sequence");
      const relation = types.includes("complement") ? "能力互补"
        : types.includes("cross") ? "跨域迁移"
          : types.includes("sequence") ? "研究进阶"
            : types.includes("source") ? "来源生态"
              : types.includes("portfolio") ? "同类对照" : "主题共振";
      candidates.push({
        source: a.id,
        target: b.id,
        weight: round(Math.min(1, raw / 10), 2),
        signals,
        types,
        relation,
        crossCategory: !sameCategory,
        difficultyGap,
      });
    }
  }
  candidates.sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source, "en", { numeric: true }));
  const degree = new Map(nodes.map(node => [node.id, 0]));
  const limit = Math.max(18, Math.min(120, nodes.length * 5));
  const edges = [];
  for (const edge of candidates) {
    if (edges.length >= limit) break;
    if (degree.get(edge.source) >= 7 || degree.get(edge.target) >= 7) continue;
    edges.push(edge);
    degree.set(edge.source, degree.get(edge.source) + 1);
    degree.set(edge.target, degree.get(edge.target) + 1);
  }
  nodes.forEach(node => { node.degree = degree.get(node.id) || 0; });
  return edges;
}

function assignClusters(nodes, edges) {
  const parent = new Map(nodes.map(node => [node.id, node.id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const join = (a, b) => {
    a = find(a); b = find(b);
    if (a !== b) parent.set(b, a);
  };
  edges.forEach(edge => join(edge.source, edge.target));
  const roots = new Map();
  let next = 1;
  nodes.forEach(node => {
    const root = find(node.id);
    if (!roots.has(root)) roots.set(root, next++);
    node.cluster = roots.get(root);
  });
  const groups = new Map();
  nodes.forEach(node => {
    if (!groups.has(node.cluster)) groups.set(node.cluster, []);
    groups.get(node.cluster).push(node);
  });
  return [...groups.entries()].map(([id, members]) => ({ id, members })).sort((a, b) => b.members.length - a.members.length);
}

function shortTitle(title) {
  title = String(title || "").replace(/（[^）]{12,}）/g, "").trim();
  return title.length > 22 ? title.slice(0, 21) + "…" : title;
}

function evidenceOf(nodes) {
  return nodes.map(node => ({ id: node.id, title: node.title, category: node.category, url: node.url }));
}

function edgeEvidence(edge, byId) {
  return evidenceOf([byId.get(edge.source), byId.get(edge.target)].filter(Boolean));
}

function buildDimensions(nodes, edges, clusters) {
  const definitions = [
    ["theme", "主题共振", "共同关键词、标签和研究语义形成的知识主题"],
    ["cross", "跨域碰撞", "不同分类之间可迁移、可组合的连接"],
    ["complement", "能力互补", "输入、能力或输出能够拼接成完整方案的组合"],
    ["source", "来源生态", "来自相同平台、作者生态或项目来源的线索"],
    ["sequence", "研究进阶", "由难度、状态和关联强度形成的先后研究顺序"],
    ["portfolio", "同类对照", "同一赛道内适合比较、选型或形成专题的事项"],
  ];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const dimensions = definitions.map(([id, label, description]) => {
    const matches = edges.filter(edge => edge.types.includes(id));
    const signalCounts = new Map();
    matches.forEach(edge => edge.signals.forEach(signal => signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1)));
    const signals = [...signalCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(item => item[0]);
    const evidence = [];
    matches.slice(0, 3).forEach(edge => edgeEvidence(edge, byId).forEach(item => {
      if (!evidence.some(existing => existing.id === item.id)) evidence.push(item);
    }));
    return { id, label, description, count: matches.length, signals, evidence: evidence.slice(0, 4) };
  });
  dimensions.push({
    id: "cluster",
    label: "主题组合",
    description: "由多个事项共同构成、可持续经营的专题或产品方向",
    count: clusters.filter(cluster => cluster.members.length > 1).length,
    signals: clusters.filter(cluster => cluster.members.length > 1).slice(0, 3).map(cluster => cluster.members[0].category),
    evidence: evidenceOf((clusters.find(cluster => cluster.members.length > 1) || { members: [] }).members.slice(0, 4)),
  });
  return dimensions;
}

function buildCollisionMatrix(nodes, edges) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pairs = new Map();
  edges.filter(edge => edge.crossCategory).forEach(edge => {
    const a = byId.get(edge.source), b = byId.get(edge.target);
    const categories = [a.category, b.category].sort((x, y) => x.localeCompare(y, "zh-CN"));
    const key = categories.join("\u0000");
    if (!pairs.has(key)) pairs.set(key, { source: categories[0], target: categories[1], edges: [], signals: new Map() });
    const pair = pairs.get(key);
    pair.edges.push(edge);
    edge.signals.forEach(signal => pair.signals.set(signal, (pair.signals.get(signal) || 0) + 1));
  });
  return [...pairs.values()].map(pair => ({
    source: pair.source,
    target: pair.target,
    count: pair.edges.length,
    strength: Math.round(pair.edges.reduce((sum, edge) => sum + edge.weight, 0) / pair.edges.length * 100),
    signals: [...pair.signals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(item => item[0]),
    evidence: edgeEvidence(pair.edges[0], byId),
  })).sort((a, b) => b.count - a.count || b.strength - a.strength).slice(0, 12);
}

function pairSuggestion(edge, byId, index) {
  const a = byId.get(edge.source), b = byId.get(edge.target);
  const focus = edge.signals.slice(0, 2).join(" / ") || "能力组合";
  const avgDifficulty = (a.difficulty + b.difficulty) / 2;
  return {
    id: "pair-" + index,
    dimension: "cross",
    type: "组合项目",
    title: `把「${shortTitle(a.title)}」与「${shortTitle(b.title)}」组合成可验证原型`,
    summary: `两项记录在“${focus}”上存在明确交集，同时横跨“${a.category}”与“${b.category}”，适合验证组合价值，而不是继续孤立收藏。`,
    rationale: `关联强度 ${Math.round(edge.weight * 100)}%，依据来自共同关键词、标签或来源域名。`,
    confidence: edge.weight >= 0.7 ? "高" : edge.weight >= 0.45 ? "中" : "探索性",
    score: round(edge.weight * 100 - avgDifficulty * 3 + (edge.crossCategory ? 6 : 0), 0),
    difficulty: round(avgDifficulty, 1),
    signals: edge.signals,
    evidence: evidenceOf([a, b]),
    mvp: [
      `各提取 1 个核心能力，写成“输入—处理—输出”接口。`,
      `用现有条目中的真实场景做一次端到端组合验证。`,
      `记录耗时、失败点和可复用资产，再决定是否继续产品化。`,
    ],
  };
}

function clusterSuggestion(cluster, edges, index) {
  const ids = new Set(cluster.members.map(node => node.id));
  const counts = new Map();
  edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).forEach(edge => {
    edge.signals.forEach(signal => counts.set(signal, (counts.get(signal) || 0) + 1));
  });
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(item => item[0]);
  const focus = topics.join(" / ") || cluster.members[0].category;
  const evidence = cluster.members.slice().sort((a, b) => b.degree - a.degree).slice(0, 4);
  return {
    id: "cluster-" + index,
    dimension: "theme",
    type: "专题产品",
    title: `围绕“${focus}”建立专题研究雷达`,
    summary: `该关联簇包含 ${cluster.members.length} 个事项，可从零散收藏升级为持续更新的专题：统一评测维度、跟踪结论，并自动暴露重复与空白。`,
    rationale: `这是当前知识图谱中规模较大的关联簇，核心条目平均连接数为 ${round(evidence.reduce((sum, node) => sum + node.degree, 0) / evidence.length, 1)}。`,
    confidence: cluster.members.length >= 5 ? "高" : "中",
    score: Math.min(96, 58 + cluster.members.length * 5),
    difficulty: 2,
    signals: topics,
    evidence: evidenceOf(evidence),
    mvp: [
      `为“${focus}”定义 4 个统一评测维度。`,
      `优先研究连接度最高的 2 个条目，形成对比表。`,
      `每周补充一次结论，连续三周后再决定是否独立成项目。`,
    ],
  };
}

function learningSuggestion(nodes) {
  const candidates = nodes.filter(node => node.status !== "done")
    .sort((a, b) => b.degree - a.degree || a.difficulty - b.difficulty)
    .slice(0, 3);
  if (candidates.length < 2) return null;
  const categories = [...new Set(candidates.map(node => node.category))];
  return {
    id: "learning-path",
    dimension: "roadmap",
    type: "研究路线",
    title: `用 ${candidates.length} 个连续实验打通高价值研究路径`,
    summary: `先研究知识图谱中的高连接条目，再沿关联边扩展，比随机逐条处理更容易产出可复用结论。当前路径覆盖 ${categories.join("、")}。`,
    rationale: `候选条目连接数依次为 ${candidates.map(node => node.degree).join("、")}，且尚未全部完成。`,
    confidence: candidates.some(node => node.degree >= 3) ? "高" : "中",
    score: 78 + Math.min(15, candidates.reduce((sum, node) => sum + node.degree, 0)),
    difficulty: round(candidates.reduce((sum, node) => sum + node.difficulty, 0) / candidates.length, 1),
    signals: categories,
    evidence: evidenceOf(candidates),
    mvp: candidates.map((node, index) => `${index + 1}. 研究「${shortTitle(node.title)}」，只记录关键结论与一个可执行动作。`),
  };
}

function comparisonSuggestion(edge, byId, index) {
  const a = byId.get(edge.source), b = byId.get(edge.target);
  return {
    id: "compare-" + index,
    dimension: "compare",
    type: "对比评测",
    title: `把「${shortTitle(a.title)}」和「${shortTitle(b.title)}」放进同一套评测框架`,
    summary: `两项都属于“${a.category}”，并在“${edge.signals.slice(0, 2).join(" / ") || "同类能力"}”上重叠，适合从重复收藏转为有结论的横向选型。`,
    rationale: `同类关系强度 ${Math.round(edge.weight * 100)}%，难度差 ${edge.difficultyGap} 级。`,
    confidence: edge.weight >= 0.55 ? "高" : "中",
    score: Math.round(66 + edge.weight * 24),
    difficulty: round((a.difficulty + b.difficulty) / 2, 1),
    signals: edge.signals,
    evidence: evidenceOf([a, b]),
    mvp: ["统一定义效果、成本、上手速度、可维护性四项指标。", "用同一个真实任务分别测试两项能力。", "输出选型结论，并明确各自最适用的场景。"],
  };
}

function transferSuggestion(edge, byId, index) {
  const a = byId.get(edge.source), b = byId.get(edge.target);
  const from = a.difficulty <= b.difficulty ? a : b;
  const to = from === a ? b : a;
  return {
    id: "transfer-" + index,
    dimension: "transfer",
    type: "跨域迁移",
    title: `把「${shortTitle(from.title)}」中的方法迁移到“${to.category}”场景`,
    summary: `这两项分属“${from.category}”与“${to.category}”，但共享“${edge.signals.slice(0, 3).join(" / ")}”，可验证同一方法在另一领域能否创造新价值。`,
    rationale: `跨分类关联强度 ${Math.round(edge.weight * 100)}%，具备可追溯的共同语义。`,
    confidence: edge.weight >= 0.5 ? "中" : "探索性",
    score: Math.round(62 + edge.weight * 28),
    difficulty: round((a.difficulty + b.difficulty) / 2, 1),
    signals: edge.signals,
    evidence: evidenceOf([a, b]),
    mvp: ["提取来源项目中最小可复用的方法或组件。", `为“${to.category}”选择一个一小时内可完成的测试场景。`, "比较迁移前后的时间、质量和操作步骤，保留有效部分。"],
  };
}

function reuseSuggestion(nodes, edges, byId) {
  const edge = edges.find(item => {
    const a = byId.get(item.source), b = byId.get(item.target);
    return a.status === "done" && b.status !== "done" || b.status === "done" && a.status !== "done";
  });
  if (!edge) return null;
  const a = byId.get(edge.source), b = byId.get(edge.target);
  const done = a.status === "done" ? a : b;
  const pending = done === a ? b : a;
  return {
    id: "reuse-result",
    dimension: "opportunity",
    type: "成果复用",
    title: `复用「${shortTitle(done.title)}」的已完成经验，加速「${shortTitle(pending.title)}」`,
    summary: `一个事项已经完成，另一个仍待推进；两者共享“${edge.signals.slice(0, 3).join(" / ")}”，优先复用结论比从头研究更高效。`,
    rationale: `完成状态与知识关联同时成立，关联强度 ${Math.round(edge.weight * 100)}%。`,
    confidence: "高",
    score: Math.round(80 + edge.weight * 15),
    difficulty: pending.difficulty,
    signals: edge.signals,
    evidence: evidenceOf([done, pending]),
    mvp: ["先打开已完成事项，提取三个可复用结论。", "把结论转写成新事项的检查清单。", "只补做无法复用的部分，并记录差异。"],
  };
}

function quickWinSuggestion(nodes) {
  const candidates = nodes.filter(node => node.status === "pending")
    .sort((a, b) => a.difficulty - b.difficulty || b.degree - a.degree).slice(0, 3);
  if (candidates.length < 2) return null;
  return {
    id: "quick-wins",
    dimension: "opportunity",
    type: "快速验证",
    title: `先完成 ${candidates.length} 个低成本实验，快速提升知识网络密度`,
    summary: "这些事项难度较低且尚未开始，适合用短周期实验换取真实结论，避免头脑风暴长期停留在推测层面。",
    rationale: `候选平均难度 ${round(candidates.reduce((sum, node) => sum + node.difficulty, 0) / candidates.length, 1)} 级，当前连接数为 ${candidates.map(node => node.degree).join("、")}。`,
    confidence: "高",
    score: 84,
    difficulty: round(candidates.reduce((sum, node) => sum + node.difficulty, 0) / candidates.length, 1),
    signals: [...new Set(candidates.map(node => node.category))],
    evidence: evidenceOf(candidates),
    mvp: candidates.map((node, index) => `${index + 1}. 用 30 分钟验证「${shortTitle(node.title)}」的一个核心假设。`),
  };
}

function gapSuggestion(nodes) {
  const isolated = nodes.filter(node => node.degree === 0).slice(0, 4);
  const candidates = isolated.length >= 2 ? isolated : nodes.filter(node => !node.hasArchive).slice(0, 4);
  if (candidates.length < 2) return null;
  return {
    id: "knowledge-gaps",
    dimension: "challenge",
    type: "盲区诊断",
    title: `补齐 ${candidates.length} 个低连接事项的背景与收藏动机`,
    summary: "这些事项暂时难以与现有知识形成可靠碰撞。它们可能是真正的新方向，也可能只是信息不足，需要先补证据再做项目判断。",
    rationale: `其中 ${isolated.length} 项当前没有关系边；缺少研究档案会显著降低建议置信度。`,
    confidence: "诊断",
    score: 76,
    difficulty: 1,
    signals: [...new Set(candidates.map(node => node.category))].slice(0, 4),
    evidence: evidenceOf(candidates),
    mvp: ["为每项补一句“为什么收藏”。", "增加 2—3 个能描述能力、场景或输出的标签。", "重新分析后，检查它们是形成新关系还是仍保持独立。"],
  };
}

const GOAL_EXPANSIONS = {
  "设计": ["网页", "网站", "前端", "交互", "动效", "动画", "审美", "风格", "灵感", "生成"],
  "网站": ["网页", "前端", "交互", "动效", "动画", "设计"],
  "网页": ["网站", "前端", "交互", "动效", "动画", "设计"],
  "skill": ["agent", "自动", "生成", "工具", "流程", "模板"],
  "技能": ["skill", "agent", "自动", "生成", "工具", "流程", "模板"],
  "偏好": ["审美", "风格", "灵感", "案例", "自定义"],
  "自动化": ["自动", "agent", "生成", "流程", "脚本"],
  "搜索": ["检索", "索引", "资料", "发现", "osint"],
  "桌面": ["本地", "windows", "便签", "wpf"],
};

function expandGoalTokens(goal) {
  const result = tokenize(goal);
  const lower = String(goal || "").toLowerCase();
  Object.entries(GOAL_EXPANSIONS).forEach(([key, values]) => {
    if (!lower.includes(key) && !result.has(key)) return;
    values.forEach(value => result.add(value));
  });
  return result;
}

function strengthOf(node) {
  const text = (node.title + " " + node.category + " " + [...node.tokens].join(" ")).toLowerCase();
  if (/miora|网站动效|设计 agent/.test(text)) return "自动生成网站动效、交互结构与落地页面";
  if (/高分网页|网页大赏|交互灵感|获奖/.test(text)) return "提供高质量网页案例、交互风格与审美参考样本";
  if (/drawio|架构图|流程图/.test(text)) return "把需求、页面结构和组件关系转成可编辑的结构图";
  if (/papertodo|便签|wpf/.test(text)) return "提供轻量、本地优先且低干扰的桌面交互范式";
  if (/eyedex|osint|搜索|索引/.test(text)) return "发现分散资料、案例素材与外部数据线索";
  if (/agent|自动|生成/.test(text)) return "提供自动化生成、任务编排与执行能力";
  if (/设计|网页|前端|交互|动画|动效/.test(text)) return "提供视觉设计、交互表达与前端实现能力";
  if (/开源|github|源码/.test(text)) return "提供可复用源码、工程结构与二次开发基础";
  if (/硬件|esp32|嵌入式/.test(text)) return "把数字方案延伸到实体设备与嵌入式场景";
  return `提供“${node.category}”领域的方法、素材或实现经验`;
}

function goalMatch(node, goalTokens, goal) {
  const common = intersection(node.tokens, goalTokens).slice(0, 6);
  let score = common.length * 6 + Math.min(4, node.degree);
  const lower = String(goal || "").toLowerCase();
  const title = node.title.toLowerCase();
  if (/skill|技能/.test(lower) && /skill|agent|自动|生成|工具/.test(title + " " + [...node.tokens].join(" "))) score += 5;
  if (/设计|网站|网页|动效/.test(lower) && /设计|网站|网页|前端|交互|动画|动效/.test(title + " " + node.category)) score += 7;
  if (/偏好|自己|个性/.test(lower) && /灵感|高分|设计|审美|案例|自定义/.test(title + " " + [...node.tokens].join(" "))) score += 5;
  if (node.hasArchive) score += 2;
  return { score, signals: common };
}

function fusionMvp(goal) {
  if (/设计|网站|网页|动效|审美/.test(goal)) {
    return [
      "收集 8—12 个自己真正喜欢的网页样本，标注配色、字体、版式、动效节奏和不喜欢的部分。",
      "分别从候选项目提取“审美参考规则”“动效生成能力”“组件与流程结构”，整理成统一输入—输出规范。",
      "把规则、提示词、示例和必要脚本封装成一个可重复调用的设计 Skill。",
      "用三个不同主题的落地页验证，记录偏好命中率、生成耗时、人工修改量，再迭代规则。",
    ];
  }
  return [
    "把实际需求改写成明确的使用者、场景、输入、输出和验收标准。",
    "从每个候选项目只抽取一项最强能力，并定义它在新方案中的接口。",
    "用最小真实任务完成一次端到端融合验证。",
    "记录效果、成本、失败点和不可替代价值，再决定是否扩展。",
  ];
}

function fusionPlan(goal, candidates, index, angle) {
  const strengths = candidates.map(item => item.strength);
  const average = candidates.reduce((sum, item) => sum + item.relevance, 0) / candidates.length;
  const shortGoal = goal.length > 34 ? goal.slice(0, 33) + "…" : goal;
  const titles = candidates.slice(0, 3).map(item => `「${shortTitle(item.node.title)}」`).join(" × ");
  const labels = { core: "核心融合", lean: "轻量验证", stretch: "差异化扩展" };
  return {
    id: "fusion-" + index,
    dimension: "fusion",
    type: labels[angle] || "需求融合",
    goal,
    title: `${titles}：共同实现“${shortGoal}”`,
    summary: `不是把项目简单并列，而是以真实需求为主线，分别借用 ${strengths.join("、")}，组合成一个新的可执行方案。`,
    rationale: `候选项目与需求匹配分依次为 ${candidates.map(item => item.relevance).join("、")}；同时尽量覆盖不同能力角色，避免只做相似项目堆叠。`,
    confidence: average >= 22 ? "高" : average >= 14 ? "中" : "探索性",
    score: Math.min(98, Math.round(58 + average * 1.4 + candidates.length * 3)),
    difficulty: round(candidates.reduce((sum, item) => sum + item.node.difficulty, 0) / candidates.length, 1),
    signals: [...new Set(candidates.flatMap(item => item.signals))].slice(0, 6),
    evidence: evidenceOf(candidates.map(item => item.node)),
    contributions: candidates.map(item => ({
      id: item.node.id,
      title: item.node.title,
      category: item.node.category,
      strength: item.strength,
      reason: item.signals.length ? `命中需求线索：${item.signals.join(" / ")}` : "作为不同领域的能力补位",
    })),
    mvp: fusionMvp(goal),
  };
}

function generateGoalFusion(nodes, edges, goal) {
  goal = stripMarkdown(goal).slice(0, 400);
  if (!goal) return { goal: "", matches: [], plans: [] };
  const goalTokens = expandGoalTokens(goal);
  const ranked = nodes.map(node => {
    const match = goalMatch(node, goalTokens, goal);
    return { node, relevance: match.score, signals: match.signals, strength: strengthOf(node) };
  }).sort((a, b) => b.relevance - a.relevance || b.node.degree - a.node.degree || a.node.difficulty - b.node.difficulty);
  const relevant = ranked.filter(item => item.relevance > 4);
  const pool = (relevant.length >= 2 ? relevant : ranked).slice(0, 10);
  if (pool.length < 2) return { goal, matches: [], plans: [] };

  const pickDistinct = (source, limit) => {
    const selected = [];
    for (const item of source) {
      const duplicateStrength = selected.some(existing => existing.strength === item.strength);
      const duplicateCategory = selected.some(existing => existing.node.category === item.node.category);
      if (selected.length && duplicateStrength && duplicateCategory) continue;
      selected.push(item);
      if (selected.length >= limit) break;
    }
    for (const item of source) {
      if (selected.length >= limit) break;
      if (!selected.includes(item)) selected.push(item);
    }
    return selected;
  };

  const core = pickDistinct(pool, Math.min(4, pool.length));
  const lean = pickDistinct(pool.slice().sort((a, b) => a.node.difficulty - b.node.difficulty || b.relevance - a.relevance), Math.min(3, pool.length));
  const stretch = pickDistinct(pool.slice().sort((a, b) => {
    const aNovelty = a.node.category !== core[0].node.category ? 1 : 0;
    const bNovelty = b.node.category !== core[0].node.category ? 1 : 0;
    return bNovelty - aNovelty || b.relevance - a.relevance;
  }), Math.min(3, pool.length));
  const groups = [core, lean, stretch].filter((group, index, list) => group.length >= 2 && list.findIndex(other => other.map(item => item.node.id).join("|") === group.map(item => item.node.id).join("|")) === index);
  const angles = ["core", "lean", "stretch"];
  const plans = groups.map((group, index) => fusionPlan(goal, group, index + 1, angles[index]));
  return {
    goal,
    matches: pool.slice(0, 8).map(item => ({ id: item.node.id, title: item.node.title, category: item.node.category, relevance: item.relevance, strength: item.strength, signals: item.signals })),
    plans,
  };
}

function sanitizeFeedback(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === "object" && item.goal)
    .map(item => ({
      id: String(item.id || "").slice(0, 40),
      goal: stripMarkdown(item.goal).slice(0, 400),
      verification: {
        status: ["verified", "rejected"].includes(item.verification && item.verification.status) ? item.verification.status : "pending",
        result: String(item.verification && item.verification.result || "").replace(/\s+/g, " ").trim().slice(0, 1200),
        reviewedAt: item.verification && item.verification.reviewedAt || null,
        evidenceCoverage: Math.max(0, Math.min(100, Math.round(Number(item.verification && item.verification.evidenceCoverage) || 0))),
      },
    }))
    .filter(item => item.verification.status !== "pending")
    .slice(0, 30);
}

function applyVerificationFeedback(fusion, feedback, goal) {
  const summary = { matched: 0, verified: 0, rejected: 0 };
  if (!feedback.length || !fusion || !fusion.plans.length) return summary;
  const goalTokens = expandGoalTokens(goal || fusion.goal || "");
  for (const plan of fusion.plans) {
    let best = null;
    let bestOverlap = 0;
    for (const item of feedback) {
      const overlap = intersection(goalTokens, expandGoalTokens(item.goal)).length;
      if (overlap > bestOverlap) { best = item; bestOverlap = overlap; }
    }
    if (!best || bestOverlap < 2) continue;
    const verification = best.verification;
    plan.priorVerification = {
      reportId: best.id,
      goal: best.goal,
      status: verification.status,
      result: verification.result,
      reviewedAt: verification.reviewedAt,
      evidenceCoverage: verification.evidenceCoverage,
      overlap: bestOverlap,
    };
    const label = verification.status === "verified" ? "已验证" : "被否定";
    if (verification.status === "verified") {
      summary.verified++;
      plan.score = Math.min(99, (Number(plan.score) || 0) + 4);
      plan.confidence = plan.confidence === "探索性" ? "中" : "高";
      plan.rationale = `${plan.rationale} 历史验证：相似目标「${best.goal.slice(0, 60)}」${label}（证据覆盖 ${verification.evidenceCoverage}%${verification.result ? "；" + verification.result.slice(0, 120) : ""}）。`;
    } else {
      summary.rejected++;
      plan.score = Math.max(1, (Number(plan.score) || 0) - 6);
      plan.confidence = plan.confidence === "高" ? "中" : "探索性";
      plan.rationale = `${plan.rationale} 历史警告：相似目标「${best.goal.slice(0, 60)}」${label}（${verification.result.slice(0, 120) || "没有记录通过原因"}），保留为反例证据。`;
    }
    summary.matched++;
  }
  return summary;
}

function generateSuggestions(nodes, edges, clusters, mode) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const suggestions = [];
  const crossEdges = edges.filter(edge => edge.types.includes("complement")).slice(0, 4);
  crossEdges.slice(0, 2).forEach((edge, index) => suggestions.push(pairSuggestion(edge, byId, index + 1)));
  crossEdges.slice(0, 3).forEach((edge, index) => suggestions.push(transferSuggestion(edge, byId, index + 1)));
  edges.filter(edge => edge.types.includes("portfolio")).slice(0, 3)
    .forEach((edge, index) => suggestions.push(comparisonSuggestion(edge, byId, index + 1)));
  clusters.filter(cluster => cluster.members.length >= 3).slice(0, 3)
    .forEach((cluster, index) => suggestions.push(clusterSuggestion(cluster, edges, index + 1)));
  const learning = learningSuggestion(nodes);
  if (learning) suggestions.push(learning);
  const reuse = reuseSuggestion(nodes, edges, byId);
  const quickWin = quickWinSuggestion(nodes);
  const gap = gapSuggestion(nodes);
  if (reuse) suggestions.push(reuse);
  if (quickWin) suggestions.push(quickWin);
  if (gap) suggestions.push(gap);

  const selectors = {
    connections: item => ["cross", "transfer", "compare", "theme"].includes(item.dimension),
    opportunities: item => ["cross", "transfer", "opportunity", "theme"].includes(item.dimension),
    challenges: item => item.dimension === "challenge" || item.dimension === "compare",
    roadmap: item => item.dimension === "roadmap" || item.dimension === "opportunity",
    feasible: item => ["opportunity", "roadmap", "cross"].includes(item.dimension),
    learning: item => item.dimension === "roadmap" || item.dimension === "theme",
    explore: item => ["cross", "transfer", "theme"].includes(item.dimension),
  };
  const sorters = {
    feasible: (a, b) => (a.difficulty - b.difficulty) || (b.score - a.score),
    roadmap: (a, b) => (a.dimension === "roadmap" ? -1 : b.dimension === "roadmap" ? 1 : b.score - a.score),
    learning: (a, b) => (a.dimension === "roadmap" ? -1 : b.dimension === "roadmap" ? 1 : b.score - a.score),
    challenges: (a, b) => (a.dimension === "challenge" ? -1 : b.dimension === "challenge" ? 1 : b.score - a.score),
    explore: (a, b) => (a.dimension === "cross" ? -1 : b.dimension === "cross" ? 1 : b.score - a.score),
  };
  const unique = suggestions.filter((item, index, list) => list.findIndex(other => other.title === item.title) === index);
  if (mode === "panorama") {
    const balanced = [];
    for (const dimension of ["cross", "transfer", "compare", "theme", "opportunity", "challenge", "roadmap"]) {
      const match = unique.filter(item => item.dimension === dimension).sort((a, b) => b.score - a.score)[0];
      if (match) balanced.push(match);
    }
    unique.sort((a, b) => b.score - a.score).forEach(item => {
      if (!balanced.includes(item)) balanced.push(item);
    });
    return balanced.slice(0, 16);
  }
  const selected = selectors[mode] ? unique.filter(selectors[mode]) : unique;
  return selected.sort(sorters[mode] || ((a, b) => b.score - a.score)).slice(0, 16);
}

function analyze(dataText, options) {
  options = options || {};
  const validModes = ["fusion", "panorama", "connections", "opportunities", "challenges", "roadmap", "explore", "feasible", "learning"];
  const mode = validModes.includes(options.mode) ? options.mode : "fusion";
  const scannedEntries = schema.scanEntries(dataText);
  const truncated = scannedEntries.length > MAX_ITEMS;
  const nodes = buildNodes(dataText, Object.assign({}, options, { scannedEntries }));
  const edges = buildEdges(nodes);
  const clusters = assignClusters(nodes, edges);
  const fusion = generateGoalFusion(nodes, edges, options.goal || "");
  const feedbackSummary = applyVerificationFeedback(fusion, sanitizeFeedback(options.feedback), options.goal || fusion.goal);
  const suggestions = generateSuggestions(nodes, edges, clusters, mode === "fusion" ? "panorama" : mode);
  const dimensions = buildDimensions(nodes, edges, clusters);
  const collisionMatrix = buildCollisionMatrix(nodes, edges);
  const isolated = nodes.filter(node => node.degree === 0).length;
  const archived = nodes.filter(node => node.hasArchive).length;
  const strongest = edges[0];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const insights = [];
  if (truncated) insights.push(`项目库共 ${scannedEntries.length} 条，本次只分析数据文件中的前 ${nodes.length} 条；其余条目未参与关系计算。`);
  if (fusion.goal && fusion.plans.length) insights.push(`当前围绕“${fusion.goal}”形成 ${fusion.plans.length} 条多项目融合路径。`);
  if (feedbackSummary.matched) insights.push(`已吸收 ${feedbackSummary.matched} 条历史验证：已验证 ${feedbackSummary.verified} 条、被否定 ${feedbackSummary.rejected} 条；结论已参与方案置信度与排序。`);
  if (strongest) insights.push(`最强关联：${byId.get(strongest.source).title} ↔ ${byId.get(strongest.target).title}（${strongest.signals.join(" / ")}）`);
  const crossCount = edges.filter(edge => edge.crossCategory).length;
  if (crossCount) insights.push(`发现 ${crossCount} 条跨分类连接，可用于能力迁移、组合实验和新产品假设。`);
  if (isolated) insights.push(`${isolated} 个事项暂时没有明显关联，建议补充标签或“为什么收藏”。`);
  insights.push(`研究档案覆盖 ${nodes.length ? Math.round(archived / nodes.length * 100) : 0}%，依据越完整，建议越可靠。`);
  return {
    generatedAt: new Date().toISOString(),
    mode,
    summary: {
      items: nodes.length,
      totalItems: scannedEntries.length,
      truncated,
      relations: edges.length,
      clusters: clusters.filter(cluster => cluster.members.length > 1).length,
      dimensions: dimensions.filter(item => item.count > 0).length,
      crossRelations: crossCount,
      suggestions: suggestions.length + fusion.plans.length,
      isolated,
      archiveCoverage: nodes.length ? Math.round(archived / nodes.length * 100) : 0,
      priorVerifications: feedbackSummary,
    },
    graph: {
      nodes: nodes.map(({ tokens, tags, domain, hasArchive, ...node }) => node),
      edges,
    },
    dimensions,
    collisionMatrix,
    fusion,
    suggestions,
    insights,
  };
}

module.exports = {
  analyze,
  applyVerificationFeedback,
  buildEdges,
  buildNodes,
  buildCollisionMatrix,
  buildDimensions,
  categoryMap,
  expandGoalTokens,
  generateGoalFusion,
  generateSuggestions,
  sanitizeFeedback,
  tokenize,
};
