import React from "react";
import { AbsoluteFill, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import layout from "./live-layout.json";
import { PageCam } from "./PageCam";

const PAPER = "#f6f0e7";
const PAPER_2 = "#fffaf3";
const INK = "#292621";
const MUTED = "#786f64";
const ACCENT = "#c2410c";
const PURPLE = "#7657c7";
const GREEN = "#4f7c69";
const SERIF = 'Georgia, "Noto Serif SC", "Songti SC", serif';
const SANS = 'Inter, "Microsoft YaHei", sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

export const SHOTS = {
  trailer: { from: 0, duration: 91 },
  workflow: { from: 91, duration: 89 },
  capture: { from: 180, duration: 147 },
  parser: { from: 327, duration: 89 },
  relationship: { from: 416, duration: 177 },
  brainstorm: { from: 593, duration: 162 },
  outro: { from: 755, duration: 145 },
} as const;

const clamp = (frame: number, points: number[], values: number[], easing?: (t: number) => number) => interpolate(frame, points, values, {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing,
});

const PaperField: React.FC<{ children?: React.ReactNode; dark?: boolean }> = ({ children, dark = false }) => (
  <AbsoluteFill style={{
    background: dark ? "radial-gradient(circle at 50% 42%, #372c25 0%, #211c18 58%, #151311 100%)" : `radial-gradient(circle at 50% 38%, ${PAPER_2} 0%, ${PAPER} 72%, #eee5d9 100%)`,
    color: dark ? PAPER_2 : INK,
    overflow: "hidden",
  }}>
    {children}
    <AbsoluteFill style={{
      opacity: dark ? 0.045 : 0.07,
      mixBlendMode: "multiply",
      backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E\")",
      pointerEvents: "none",
    }} />
  </AbsoluteFill>
);

const Caption: React.FC<{ kicker: string; title: string; color?: string }> = ({ kicker, title, color = INK }) => (
  <div style={{ position: "absolute", left: 96, right: 96, bottom: 64, zIndex: 40, textShadow: "0 2px 22px rgba(255,250,243,.95)" }}>
    <div style={{ font: `700 32px ${MONO}`, letterSpacing: ".16em", color: ACCENT, marginBottom: 14 }}>{kicker}</div>
    <div style={{ font: `600 62px/1.08 ${SERIF}`, letterSpacing: "-.035em", color }}>{title}</div>
  </div>
);

const TrailerScene: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 27) {
    const index = Math.floor(frame / 9);
    const start = index * 9;
    const src = ["library-full.png", "relationship-full.png", "brainstorm-full.png"][index];
    const origin = ["50% 24%", "52% 46%", "50% 34%"][index];
    const push = clamp(frame, [start, start + 9], [1, 1.04]);
    return <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
      <Img src={staticFile(`textures/live/${src}`)} style={{ width: 1920, height: "auto", minHeight: 1080, transform: `scale(${push})`, transformOrigin: origin }} />
      <AbsoluteFill style={{ boxShadow: `inset 0 0 0 18px ${[ACCENT, PURPLE, GREEN][index]}` }} />
    </AbsoluteFill>;
  }
  if (frame < 33) return <AbsoluteFill style={{ background: "#11100f" }} />;
  const titleIn = clamp(frame, [33, 49], [0, 1], Easing.out(Easing.cubic));
  const rule = clamp(frame, [48, 65], [0, 1], Easing.out(Easing.cubic));
  const sub = clamp(frame, [57, 72], [0, 1]);
  return <PaperField>
    <div style={{ position: "absolute", left: 210, top: 290, opacity: titleIn, transform: `translateY(${(1 - titleIn) * 44}px)` }}>
      <div style={{ color: ACCENT, font: `700 31px ${MONO}`, letterSpacing: ".2em", marginBottom: 24 }}>NEW RELEASE · 2026</div>
      <div style={{ font: `600 152px/.98 ${SERIF}`, letterSpacing: "-.06em" }}>灵感工作台 <i style={{ color: ACCENT }}>v2.3</i></div>
      <div style={{ width: 560, height: 7, borderRadius: 4, marginTop: 38, background: ACCENT, transform: `scaleX(${rule})`, transformOrigin: "left" }} />
      <div style={{ marginTop: 35, opacity: sub, color: MUTED, font: `600 44px ${SANS}` }}>从收藏，到关系，再到真正可执行的方案</div>
    </div>
  </PaperField>;
};

const WorkflowScene: React.FC = () => {
  const frame = useCurrentFrame();
  const stages = [
    { no: "01", title: "灵感来袭", sub: "收集与研究", color: ACCENT },
    { no: "02", title: "关系画布", sub: "整理与溯源", color: PURPLE },
    { no: "03", title: "头脑风暴", sub: "融合与决策", color: GREEN },
  ];
  const line = clamp(frame, [10, 58], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <div style={{ position: "absolute", left: 145, right: 145, top: 130 }}>
      <div style={{ color: ACCENT, font: `700 30px ${MONO}`, letterSpacing: ".18em" }}>ONE WORKBENCH · THREE CLEAR STAGES</div>
      <div style={{ marginTop: 18, font: `600 72px ${SERIF}`, letterSpacing: "-.045em" }}>一个中心，贯穿整个灵感工作流</div>
    </div>
    <div style={{ position: "absolute", left: 230, right: 230, top: 430, height: 6, borderRadius: 3, background: "#ded3c6" }}>
      <div style={{ width: `${line * 100}%`, height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${ACCENT}, ${PURPLE}, ${GREEN})` }} />
    </div>
    <div style={{ position: "absolute", left: 165, right: 165, top: 330, display: "flex", justifyContent: "space-between" }}>
      {stages.map((stage, index) => {
        const raw = spring({ frame: frame - (8 + index * 14), fps: 30, config: { damping: 18, stiffness: 120 } });
        const t = Math.min(1.02, Math.max(0, raw));
        return <div key={stage.no} style={{ width: 490, height: 270, padding: "44px 42px", boxSizing: "border-box", borderRadius: 28, background: PAPER_2, border: `2px solid ${stage.color}55`, boxShadow: "0 24px 64px rgba(45,32,22,.11)", transform: `translateY(${(1 - t) * 70}px) scale(${t})`, transformOrigin: "center" }}>
          <div style={{ color: stage.color, font: `800 30px ${MONO}`, letterSpacing: ".14em" }}>{stage.no}</div>
          <div style={{ marginTop: 22, font: `600 55px ${SERIF}`, letterSpacing: "-.035em" }}>{stage.title}</div>
          <div style={{ marginTop: 12, color: MUTED, font: `600 32px ${SANS}` }}>{stage.sub}</div>
        </div>;
      })}
    </div>
  </PaperField>;
};

const CaptureScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const modal = layout.capture.cutouts[0];
  const click = clamp(frame, [18, 25], [0, 1], Easing.out(Easing.cubic));
  const raw = spring({ frame: frame - 28, fps, config: { damping: 18, stiffness: 105 } });
  const modalIn = Math.min(1.02, Math.max(0, raw));
  const rows = ["链接先保存到本机", "自动解析标题与正文", "主动备份主要内容", "失败可见、可以重试"];
  return <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
    <PageCam src="textures/live/library-full.png" pageH={layout.library.pageH} keys={[{ frame: 0, cx: 960, cy: 500, zoom: .83 }, { frame: 147, cx: 960, cy: 500, zoom: .86 }]} blur={modalIn * 2.5} saturate={1 - modalIn * .18} />
    <div style={{ position: "absolute", right: 70, top: 58, width: 74, height: 74, borderRadius: "50%", border: `4px solid ${ACCENT}`, transform: `scale(${.4 + click * 1.9})`, opacity: 1 - click }} />
    <div style={{ position: "absolute", left: 110, top: 180, width: modal.w * .86, height: modal.h * .86, borderRadius: 26, overflow: "hidden", opacity: modalIn, transform: `translateY(${(1 - modalIn) * 80}px) scale(${.94 + modalIn * .06})`, transformOrigin: "center", boxShadow: "0 32px 85px rgba(45,32,22,.2)" }}>
      <Img src={staticFile("textures/live/capture-modal.png")} style={{ width: "100%", height: "100%" }} />
    </div>
    <div style={{ position: "absolute", right: 95, top: 198, width: 680, padding: "42px 44px", boxSizing: "border-box", borderRadius: 26, background: "rgba(255,250,243,.96)", border: "1px solid #ded1c3", boxShadow: "0 28px 74px rgba(45,32,22,.13)" }}>
      <div style={{ color: ACCENT, font: `700 30px ${MONO}`, letterSpacing: ".14em" }}>CAPTURE · SAVE FIRST</div>
      <div style={{ marginTop: 14, font: `600 48px ${SERIF}` }}>收藏入口更清楚，流程也更可靠</div>
      <div style={{ marginTop: 25 }}>
        {rows.map((row, index) => {
          const t = clamp(frame, [50 + index * 17, 60 + index * 17], [0, 1], Easing.out(Easing.cubic));
          return <div key={row} style={{ height: 62, borderTop: "1px solid #eadfd3", display: "flex", alignItems: "center", gap: 16, opacity: t, transform: `translateX(${(1 - t) * 22}px)`, font: `600 34px ${SANS}` }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", color: "white", background: GREEN, display: "grid", placeItems: "center", fontSize: 18 }}>✓</span>{row}
          </div>;
        })}
      </div>
    </div>
  </AbsoluteFill>;
};

const ParserScene: React.FC = () => {
  const frame = useCurrentFrame();
  const platforms = [
    {
      name: "GitHub",
      color: PURPLE,
      steps: [
        { label: "API 元数据", state: "受限", ok: false },
        { label: "公开 README", state: "降级命中", ok: true },
        { label: "内容归档", state: "已保存", ok: true },
      ],
    },
    {
      name: "X / Twitter",
      color: ACCENT,
      steps: [
        { label: "页面正文", state: "受限", ok: false },
        { label: "Syndication", state: "命中正文", ok: true },
        { label: "oEmbed", state: "补全作者", ok: true },
      ],
    },
  ];
  const merged = clamp(frame, [55, 72], [0, 1], Easing.bezier(.2, .85, .3, 1));
  return <PaperField dark>
    <div style={{ position: "absolute", left: 115, top: 118 }}>
      <div style={{ color: "#d9b39c", font: `700 30px ${MONO}`, letterSpacing: ".18em" }}>FASTER FALLBACK · NEVER LOSE THE LINK</div>
      <div style={{ marginTop: 20, font: `600 70px ${SERIF}`, letterSpacing: "-.045em" }}>GitHub / X 多路降级解析</div>
    </div>
    <div style={{ position: "absolute", left: 120, right: 120, top: 338, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 34 }}>
      {platforms.map((platform, platformIndex) => {
        const cardIn = clamp(frame, [5 + platformIndex * 7, 20 + platformIndex * 7], [0, 1], Easing.out(Easing.cubic));
        return <div key={platform.name} style={{ height: 370, padding: "30px 34px", boxSizing: "border-box", borderRadius: 26, background: "rgba(255,250,243,.08)", border: `2px solid ${platform.color}99`, boxShadow: `0 20px 55px ${platform.color}18`, opacity: cardIn, transform: `translateY(${(1 - cardIn) * 26}px)` }}>
          <div style={{ font: `700 40px ${MONO}`, color: platform.color }}>{platform.name}</div>
          <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
            {platform.steps.map((step, stepIndex) => {
              const cue = 17 + platformIndex * 6 + stepIndex * 8;
              const t = clamp(frame, [cue, cue + 10], [0, 1], Easing.out(Easing.cubic));
              return <div key={step.label} style={{ minHeight: 66, padding: "0 20px", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, background: "rgba(255,255,255,.07)", opacity: t, transform: `translateX(${(1 - t) * 18}px)` }}>
                <span style={{ font: `600 32px ${SANS}`, color: "#fff8ef" }}>{step.label}</span>
                <span style={{ font: `700 32px ${SANS}`, color: step.ok ? "#9dd4b7" : "#d7a98f" }}>{step.ok ? "✓" : "!"} {step.state}</span>
              </div>;
            })}
          </div>
        </div>;
      })}
    </div>
    <div style={{ position: "absolute", left: 340, right: 340, bottom: 80, padding: "25px 34px", borderRadius: 22, background: PAPER_2, color: INK, textAlign: "center", opacity: merged, transform: `translateY(${(1 - merged) * 25}px) scale(${.97 + merged * .03})`, font: `600 56px/1.12 ${SERIF}` }}>任一路径成功即可补全；全部失败仍保留链接</div>
  </PaperField>;
};

const RelationshipScene: React.FC = () => {
  const frame = useCurrentFrame();
  const reveal = clamp(frame, [10, 62], [0, 1], Easing.out(Easing.cubic));
  const tags = ["主题分区", "来源筛选", "节点拖拽", "反向链接"];
  return <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
    <PageCam src="textures/live/relationship-full.png" pageH={layout.relationship.pageH} keys={[{ frame: 0, cx: 960, cy: 535, zoom: .76 }, { frame: 177, cx: 960, cy: 535, zoom: .82 }]} blur={4 * (1 - reveal)} saturate={.72 + reveal * .28} />
    <AbsoluteFill style={{ background: `linear-gradient(90deg, rgba(246,240,231,${.86 * (1 - reveal)}) 0%, rgba(246,240,231,0) ${26 + reveal * 45}%)` }} />
    <div style={{ position: "absolute", left: 88, top: 95, width: 620, padding: "38px 42px", borderRadius: 26, background: "rgba(255,250,243,.94)", border: "1px solid #ddd0c2", boxShadow: "0 24px 74px rgba(45,32,22,.14)" }}>
      <div style={{ color: PURPLE, font: `700 30px ${MONO}`, letterSpacing: ".16em" }}>02 · RELATIONSHIP CANVAS</div>
      <div style={{ marginTop: 18, font: `600 58px/1.08 ${SERIF}`, letterSpacing: "-.04em" }}>把收藏整理成<br />看得见的关系</div>
      <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 12 }}>
        {tags.map((tag, index) => {
          const t = clamp(frame, [60 + index * 12, 70 + index * 12], [0, 1], Easing.out(Easing.cubic));
          return <span key={tag} style={{ padding: "12px 17px", borderRadius: 999, background: index === 3 ? PURPLE : "#eee7df", color: index === 3 ? "white" : INK, opacity: t, transform: `translateY(${(1 - t) * 14}px)`, font: `700 32px ${SANS}` }}>{tag}</span>;
        })}
      </div>
    </div>
    <div style={{ position: "absolute", left: 790, right: 90, bottom: 64, height: 9, borderRadius: 5, background: "rgba(118,87,199,.14)", overflow: "hidden" }}><div style={{ width: `${reveal * 100}%`, height: "100%", background: PURPLE }} /></div>
  </AbsoluteFill>;
};

const BrainstormScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const prompt = "把这些来源融合成一个可验证方案";
  const typed = Math.min(prompt.length, Math.max(0, Math.floor((frame - 4) / 1.4)));
  const nodes = [
    { x: 960, y: 315, cue: 48, title: "融合目标", parent: -1 },
    { x: 620, y: 520, cue: 68, title: "来源证据", parent: 0 },
    { x: 1300, y: 520, cue: 74, title: "组合判断", parent: 0 },
    { x: 500, y: 735, cue: 91, title: "最小步骤", parent: 1 },
    { x: 960, y: 735, cue: 97, title: "失败边界", parent: 1 },
    { x: 1420, y: 735, cue: 103, title: "下一步", parent: 2 },
  ];
  const breathe = clamp(frame, [120, 136, 150], [1, 1.025, 1], Easing.inOut(Easing.sin));
  return <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
    <PageCam src="textures/live/brainstorm-full.png" pageH={layout.brainstorm.pageH} keys={[{ frame: 0, cx: 960, cy: 710, zoom: .78 }, { frame: 162, cx: 960, cy: 900, zoom: .9 }]} blur={2.5} saturate={.84} />
    <AbsoluteFill style={{ background: "rgba(246,240,231,.88)" }} />
    <div style={{ position: "absolute", left: 400, top: 74, width: 1120, height: 90, borderRadius: 45, background: PAPER_2, border: `3px solid ${GREEN}`, display: "flex", alignItems: "center", padding: "0 38px", boxSizing: "border-box", boxShadow: "0 18px 50px rgba(45,32,22,.12)", font: `600 34px ${SANS}` }}>{prompt.slice(0, typed)}<span style={{ color: GREEN, opacity: typed < prompt.length || Math.floor(frame / 5) % 2 === 0 ? 1 : 0 }}>▌</span></div>
    <div style={{ position: "absolute", inset: 0, transform: `scale(${breathe})`, transformOrigin: "960px 570px" }}>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        {nodes.filter((node) => node.parent >= 0).map((node) => {
          const parent = nodes[node.parent];
          const grow = clamp(frame, [node.cue - 8, node.cue + 8], [0, 1], Easing.out(Easing.cubic));
          const path = `M ${parent.x} ${parent.y + 62} L ${parent.x} ${(parent.y + node.y) / 2} L ${node.x} ${(parent.y + node.y) / 2} L ${node.x} ${node.y - 62}`;
          return <path key={node.title} d={path} pathLength="1" stroke={GREEN} strokeWidth="4" fill="none" strokeDasharray="1" strokeDashoffset={1 - grow} strokeLinejoin="round" />;
        })}
      </svg>
      {nodes.map((node, index) => {
        if (frame < node.cue) return null;
        const raw = spring({ frame: frame - node.cue, fps, config: { damping: 17, stiffness: 120 } });
        const t = Math.min(1.03, Math.max(0, raw));
        return <div key={node.title} style={{ position: "absolute", left: node.x - 150, top: node.y - 62, width: 300, height: 124, borderRadius: 20, background: index === 0 ? GREEN : PAPER_2, color: index === 0 ? "white" : INK, border: `2px solid ${GREEN}`, boxShadow: "0 18px 48px rgba(45,32,22,.13)", display: "grid", placeItems: "center", transform: `scale(${t})`, font: `600 34px ${SERIF}` }}>{node.title}</div>;
      })}
    </div>
    <Caption kicker="03 · BRAINSTORM" title="从来源依据，长出方案与验证步骤" />
  </AbsoluteFill>;
};

const SparkMark: React.FC<{ size: number }> = ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" fill={ACCENT}><path d="M12 1.7 15 9l7.3 3-7.3 3-3 7.3L9 15l-7.3-3L9 9l3-7.3Z" /></svg>;

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pages = [
    { src: "library-full.png", x: 105, y: 170, rot: -5, cue: -6, color: ACCENT },
    { src: "relationship-full.png", x: 610, y: 95, rot: 1, cue: 9, color: PURPLE },
    { src: "brainstorm-full.png", x: 1115, y: 185, rot: 5, cue: 14, color: GREEN },
  ];
  const brandIn = clamp(frame, [48, 67], [0, 1], Easing.bezier(.2, .8, .3, 1));
  const recede = clamp(frame, [43, 58], [1, .72], Easing.out(Easing.cubic));
  const meta = clamp(frame, [78, 94], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <div style={{ position: "absolute", inset: 0, transform: `perspective(1400px) rotateX(${clamp(frame, [0, 38], [4, 0])}deg) scale(${1.05 - clamp(frame, [0, 38], [0, .05])})` }}>
      {pages.map((page, index) => {
        const raw = spring({ frame: frame - page.cue, fps, config: { damping: 16, stiffness: 105 } });
        const t = Math.min(1.03, Math.max(0, raw));
        const dx = index === 0 ? -580 : index === 2 ? 580 : 0;
        const dy = index === 1 ? -430 : 300;
        return <div key={page.src} style={{ position: "absolute", left: page.x, top: page.y, width: 700, height: 470, borderRadius: 24, overflow: "hidden", border: `5px solid ${page.color}`, boxShadow: "0 30px 80px rgba(45,32,22,.22)", opacity: t * recede, transform: `translate(${dx * (1 - t)}px, ${dy * (1 - t)}px) rotate(${page.rot * t}deg) scale(${.83 + .17 * t})` }}><Img src={staticFile(`textures/live/${page.src}`)} style={{ width: 700, height: "auto", minHeight: 470 }} /></div>;
      })}
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 405, display: "flex", alignItems: "center", justifyContent: "center", gap: 28, opacity: brandIn, transform: `translateY(${(1 - brandIn) * 28}px) scale(${.94 + brandIn * .06})` }}>
      <SparkMark size={90} /><div style={{ font: `600 106px ${SERIF}`, letterSpacing: "-.055em", textShadow: "0 6px 35px rgba(255,250,243,.96)" }}>灵感工作台</div>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 590, textAlign: "center", opacity: meta, transform: `translateY(${(1 - meta) * 20}px)` }}>
      <div style={{ color: ACCENT, font: `800 34px ${MONO}`, letterSpacing: ".18em" }}>V2.3 · WINDOWS DESKTOP</div>
      <div style={{ marginTop: 24, font: `600 56px ${SANS}` }}>桌面客户端 · 数据保存在本地</div>
      <div style={{ marginTop: 17, font: `600 56px ${SANS}` }}>核心功能无需 API Key · 下载一次，长期使用</div>
    </div>
  </PaperField>;
};

type PromoProps = { bgm: boolean };

const SFX = [
  { from: 0, src: "audio/click-camera.mp3", volume: .38, duration: 10 },
  { from: 9, src: "audio/click-camera.mp3", volume: .34, duration: 10 },
  { from: 18, src: "audio/click-camera.mp3", volume: .3, duration: 10 },
  { from: SHOTS.workflow.from + 8, src: "audio/transition-soft.mp3", volume: .3, duration: 46 },
  { from: SHOTS.capture.from + 18, src: "audio/click-camera.mp3", volume: .5, duration: 12 },
  { from: SHOTS.capture.from + 30, src: "audio/air-woosh-deep.mp3", volume: .3, duration: 56 },
  { from: SHOTS.parser.from + 7, src: "audio/transition-soft.mp3", volume: .2, duration: 40 },
  { from: SHOTS.parser.from + 49, src: "audio/impact-deep-whoosh.mp3", volume: .3, duration: 38 },
  { from: SHOTS.relationship.from + 12, src: "audio/whoosh-fast.mp3", volume: .28, duration: 54 },
  { from: SHOTS.relationship.from + 60, src: "audio/swoosh-quick.mp3", volume: .26, duration: 30 },
  { from: SHOTS.brainstorm.from + 4, src: "audio/typewriter-digital.mp3", volume: .24, duration: 28 },
  { from: SHOTS.outro.from + 4, src: "audio/air-whoosh-powerful.mp3", volume: .34, duration: 74 },
  { from: SHOTS.outro.from + 49, src: "audio/impact-deep-whoosh.mp3", volume: .48, duration: 72 },
  { from: SHOTS.outro.from + 78, src: "audio/sparkle-wand.mp3", volume: .3, duration: 44 },
] as const;

export const LingganV23Update: React.FC<PromoProps> = ({ bgm }) => <AbsoluteFill style={{ background: PAPER, fontFamily: SANS }}>
  <Sequence from={SHOTS.trailer.from} durationInFrames={SHOTS.trailer.duration}><TrailerScene /></Sequence>
  <Sequence from={SHOTS.workflow.from} durationInFrames={SHOTS.workflow.duration}><WorkflowScene /></Sequence>
  <Sequence from={SHOTS.capture.from} durationInFrames={SHOTS.capture.duration}><CaptureScene /></Sequence>
  <Sequence from={SHOTS.parser.from} durationInFrames={SHOTS.parser.duration}><ParserScene /></Sequence>
  <Sequence from={SHOTS.relationship.from} durationInFrames={SHOTS.relationship.duration}><RelationshipScene /></Sequence>
  <Sequence from={SHOTS.brainstorm.from} durationInFrames={SHOTS.brainstorm.duration}><BrainstormScene /></Sequence>
  <Sequence from={SHOTS.outro.from} durationInFrames={SHOTS.outro.duration}><OutroScene /></Sequence>
  {bgm ? <Audio src={staticFile("audio/bgm.mp3")} volume={(frame) => clamp(frame, [0, 24, 840, 900], [0, .25, .25, 0])} /> : null}
  {SFX.map((item) => <Sequence key={`${item.from}-${item.src}`} from={item.from} durationInFrames={item.duration}><Audio src={staticFile(item.src)} volume={item.volume} /></Sequence>)}
</AbsoluteFill>;
