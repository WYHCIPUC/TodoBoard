import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import layout from "./live-layout.json";
import { PageCam } from "./PageCam";

const PAPER = "#f6f0e7";
const PAPER_2 = "#fffaf3";
const INK = "#292621";
const MUTED = "#786f64";
const ACCENT = "#c86f43";
const GREEN = "#52755f";
const SERIF = 'Georgia, "Noto Serif SC", "Songti SC", serif';
const SANS = 'Inter, "Microsoft YaHei", sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

export const SHOTS = {
  brand: { from: 0, duration: 91 },
  risk: { from: 91, duration: 89 },
  capture: { from: 180, duration: 147 },
  search: { from: 327, duration: 89 },
  archive: { from: 416, duration: 118 },
  title: { from: 534, duration: 59 },
  brainstorm: { from: 593, duration: 162 },
  outro: { from: 755, duration: 145 },
} as const;

const clamp = (frame: number, points: number[], values: number[], easing?: (t: number) => number) => interpolate(frame, points, values, {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing,
});

// Scene boundaries are beat-aligned hard cuts. Internal animation provides the
// visual transition, avoiding a flash-through-blank frame between sequences.
const sceneOpacity = (_frame: number, _duration: number, _fade = 7) => 1;

const PaperField: React.FC<{ children?: React.ReactNode; dark?: boolean }> = ({ children, dark = false }) => (
  <AbsoluteFill style={{
    background: dark
      ? "radial-gradient(circle at 50% 42%, #372c25 0%, #211c18 58%, #151311 100%)"
      : `radial-gradient(circle at 50% 38%, ${PAPER_2} 0%, ${PAPER} 72%, #eee5d9 100%)`,
    color: dark ? PAPER_2 : INK,
    overflow: "hidden",
  }}>
    {children}
    <AbsoluteFill style={{
      opacity: dark ? 0.055 : 0.09,
      mixBlendMode: "multiply",
      backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E\")",
      pointerEvents: "none",
    }} />
  </AbsoluteFill>
);

const Caption: React.FC<{ kicker: string; title: string; align?: "left" | "center"; color?: string; textShadow?: string }> = ({ kicker, title, align = "left", color = INK, textShadow = "0 2px 22px rgba(255,250,243,.9)" }) => (
  <div style={{
    position: "absolute",
    left: align === "left" ? 96 : 260,
    right: align === "left" ? 96 : 260,
    bottom: 66,
    textAlign: align,
    zIndex: 50,
    textShadow,
  }}>
    <div style={{ font: `700 32px ${MONO}`, letterSpacing: ".16em", color: ACCENT, marginBottom: 14 }}>{kicker}</div>
    <div style={{ font: `600 62px/1.1 ${SERIF}`, letterSpacing: "-.035em", color }}>{title}</div>
  </div>
);

const BrandScene: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = SHOTS.brand.duration;
  const v = clamp(frame, [0, 10], [1, 0], Easing.out(Easing.cubic));
  const h = clamp(frame, [8, 19], [1, 0], Easing.out(Easing.cubic));
  const crossOut = clamp(frame, [25, 34], [1, 0]);
  const chars = [..."灵感工作台"];
  const kicker = "LOCAL-FIRST IDEA OS";
  const typed = Math.min(kicker.length, Math.floor(Math.max(0, frame - 28) / 0.8));
  return (
    <PaperField>
      <AbsoluteFill style={{ opacity: sceneOpacity(frame, duration) }}>
        <svg width="110" height="110" viewBox="0 0 110 110" style={{ position: "absolute", left: 172, top: 206, opacity: crossOut }}>
          <path d="M55 10 V100" stroke={ACCENT} strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={v} />
          <path d="M10 55 H100" stroke={ACCENT} strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={h} />
        </svg>
        <div style={{ position: "absolute", left: 250, top: 298 }}>
          <div style={{ display: "flex", gap: 10 }}>
            {chars.map((char, index) => {
              const t = clamp(frame, [11 + index * 3, 23 + index * 3], [0, 1], Easing.bezier(0.2, 0.8, 0.3, 1));
              return <span key={char + index} style={{
                font: `600 146px/1 ${SERIF}`,
                letterSpacing: "-.06em",
                display: "inline-block",
                opacity: t,
                filter: `blur(${(1 - t) * 7}px)`,
                transform: `scale(${1.5 - 0.5 * t})`,
                transformOrigin: "center bottom",
              }}>{char}</span>;
            })}
          </div>
          <div style={{ marginTop: 35, display: "flex", alignItems: "center", gap: 10, color: ACCENT, font: `700 22px ${MONO}`, letterSpacing: ".22em" }}>
            <span>{kicker.slice(0, typed)}</span>
            <span style={{ width: 12, height: 26, background: ACCENT, opacity: frame < 44 || Math.floor(frame / 3) % 2 === 0 ? 1 : 0 }} />
          </div>
        </div>
      </AbsoluteFill>
    </PaperField>
  );
};

const RiskScene: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = SHOTS.risk.duration;
  const url = "https://example.com/inspiration/long-read-later-link";
  const typed = Math.min(url.length, Math.floor(Math.max(0, frame - 8) / 0.8));
  const fail = clamp(frame, [38, 56], [0, 1], Easing.inOut(Easing.cubic));
  const seal = clamp(frame, [54, 76], [0, 1], Easing.bezier(0.18, 1.15, 0.3, 1));
  const label = clamp(frame, [64, 78], [0, 1]);
  return (
    <PaperField dark>
      <AbsoluteFill style={{ opacity: sceneOpacity(frame, duration) }}>
        <div style={{ position: "absolute", left: 190, right: 190, top: 230, height: 245, borderRadius: 32, background: "rgba(255,250,243,.07)", border: "1px solid rgba(255,250,243,.2)", boxShadow: "0 30px 90px rgba(0,0,0,.34)", padding: "64px 72px" }}>
          <div style={{ font: `700 18px ${MONO}`, color: "#d9b39c", letterSpacing: ".2em", marginBottom: 30 }}>稍后再看 · 可能再也看不到</div>
          <div style={{ position: "relative", font: `500 34px ${MONO}`, color: PAPER_2, opacity: 1 - fail * 0.76, filter: `blur(${fail * 3}px)` }}>
            {url.slice(0, typed)}
            <span style={{ opacity: typed < url.length || Math.floor(frame / 4) % 2 === 0 ? 1 : 0, color: ACCENT }}>▌</span>
            <div style={{ position: "absolute", left: 0, top: "54%", width: `${fail * 100}%`, height: 3, background: ACCENT, boxShadow: `0 0 ${fail * 24}px ${ACCENT}` }} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 830, top: 515, width: 260, height: 260, borderRadius: "50%", background: ACCENT, display: "grid", placeItems: "center", transform: `scale(${seal})`, boxShadow: `0 35px 90px rgba(200,87,44,${0.35 * seal})` }}>
          <svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke={PAPER_2} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 3.5h10a2 2 0 0 1 2 2v15l-7-4-7 4v-15a2 2 0 0 1 2-2Z" />
            <path d="M9 9h6M9 12h4" />
          </svg>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 88, textAlign: "center", opacity: label, transform: `translateY(${(1 - label) * 22}px)` }}>
          <div style={{ font: `600 64px ${SERIF}`, letterSpacing: "-.035em" }}>链接会失效，内容不该一起消失</div>
        </div>
      </AbsoluteFill>
    </PaperField>
  );
};

const CaptureScene: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = SHOTS.capture.duration;
  const cutouts = layout.library.cutouts.filter((item) => item.file.startsWith("card"));
  const cues = [12, 26, 39, 51, 62, 72, 81, 90];
  const cameraKeys = [
    { frame: 0, cx: 960, cy: 610, zoom: 0.8, rotX: 5, rotY: -5, rotZ: -0.6, persp: 1600 },
    { frame: 96, cx: 960, cy: 960, zoom: 0.9, rotX: 0, rotY: 0, rotZ: 0, persp: 1600 },
    { frame: duration, cx: 960, cy: 960, zoom: 0.9, rotX: 0, rotY: 0, rotZ: 0, persp: 1600 },
  ];
  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, duration), background: PAPER }}>
      <PageCam src="textures/live/library-empty.png" pageH={layout.library.pageH} keys={cameraKeys}>
        {cutouts.map((item, index) => {
          const cue = cues[index];
          const pilePress = clamp(frame, [2, 8, 12], [0, 1, 0], Easing.inOut(Easing.cubic));
          const topPull = index === 0 ? clamp(frame, [6, 11, 12], [0, 1, 0], Easing.inOut(Easing.cubic)) : 0;
          const t = clamp(frame, [cue, cue + 18], [0, 1], Easing.bezier(0.18, 1.15, 0.3, 1));
          const settle = clamp(frame, [cue + 14, cue + 22], [0.992, 1], Easing.out(Easing.cubic));
          const x0 = 1480 + index * 7 + topPull * 34;
          const y0 = 250 + index * 4 + pilePress * 20;
          const x = x0 + (item.x - x0) * t;
          const y = y0 + (item.y - y0) * t - Math.sin(t * Math.PI) * 92;
          const rotate = ((index % 2 === 0 ? -7 : 6) + topPull * 4) * (1 - t);
          const pileScale = frame < cue ? 1 - pilePress * 0.035 : 1;
          return (
            <div key={item.file} style={{ position: "absolute", left: x, top: y, width: item.w, height: item.h, transform: `translateZ(${Math.sin(t * Math.PI) * 85}px) rotate(${rotate}deg) scale(${settle * pileScale})`, transformOrigin: "center", filter: `drop-shadow(0 ${28 * (1 - t)}px ${36 * (1 - t)}px rgba(45,32,22,.25))` }}>
              <Img src={staticFile(`textures/live/${item.file}`)} style={{ width: "100%", height: "100%", borderRadius: 18 }} />
            </div>
          );
        })}
      </PageCam>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 188, background: "linear-gradient(180deg, rgba(246,240,231,0), rgba(246,240,231,.96) 42%, #f6f0e7 100%)" }} />
      <Caption kicker="AUTO CAPTURE · LOCAL ARCHIVE" title="链接入库，即刻主动备份" />
    </AbsoluteFill>
  );
};

const SearchScene: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = SHOTS.search.duration;
  const search = layout.library.boxes.search[0];
  const target = layout.library.cutouts.find((item) => item.file === "card5.png")!;
  const typedText = "readability";
  const chars = Math.min(typedText.length, Math.floor(Math.max(0, frame - 8) / 2));
  const filter = clamp(frame, [40, 52], [0, 1], Easing.out(Easing.cubic));
  const detailIn = clamp(frame, [72, 80], [0, 1], Easing.inOut(Easing.cubic));
  const keys = [
    { frame: 0, cx: 960, cy: 360, zoom: 0.9 },
    { frame: 12, cx: search.x + search.w / 2, cy: search.y + search.h / 2, zoom: 3.15 },
    { frame: 39, cx: search.x + search.w / 2, cy: search.y + search.h / 2, zoom: 3.15 },
    { frame: 62, cx: target.x + target.w / 2, cy: target.y + target.h / 2, zoom: 1.9 },
    { frame: duration, cx: target.x + target.w / 2, cy: target.y + target.h / 2, zoom: 1.9 },
  ];
  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, duration), background: PAPER }}>
      <PageCam src="textures/live/library-full.png" pageH={layout.library.pageH} keys={keys}>
        <div style={{ position: "absolute", left: search.x + 30, top: search.y + 4, width: search.w - 50, height: search.h - 8, background: "#fffdf9", display: "flex", alignItems: "center", paddingLeft: 15, font: `500 15px ${SANS}`, color: INK }}>
          {typedText.slice(0, chars)}<span style={{ width: 1.5, height: 20, marginLeft: 2, background: ACCENT, opacity: frame < 44 || Math.floor(frame / 5) % 2 === 0 ? 1 : 0 }} />
        </div>
        {layout.library.boxes.cards.map((card, index) => index === 4 ? null : (
          <div key={index} style={{ position: "absolute", left: card.x - 4, top: card.y - 4, width: card.w + 8, height: card.h + 8, borderRadius: 22, background: "#f7f2eb", opacity: filter }} />
        ))}
        <Img src={staticFile("textures/live/card5.png")} style={{ position: "absolute", left: target.x, top: target.y, width: target.w, height: target.h, opacity: filter }} />
      </PageCam>
      {[64, 68].map((cue) => frame >= cue ? <div key={cue} style={{ position: "absolute", left: 946, top: 531, width: 46, height: 46, borderRadius: "50%", border: `3px solid ${ACCENT}`, transform: `scale(${clamp(frame, [cue, cue + 10], [0.28, 2.7])})`, opacity: clamp(frame, [cue, cue + 10], [1, 0]) }} /> : null)}
      <div style={{ position: "absolute", inset: 0, opacity: detailIn, transform: `scale(${1.018 - detailIn * 0.018})`, transformOrigin: "center" }}>
        <PageCam src="textures/live/entry-full.png" pageH={layout.entry.pageH} keys={[{ frame: 0, cx: 960, cy: 560, zoom: 0.9 }, { frame: duration, cx: 960, cy: 560, zoom: 0.9 }]} />
      </div>
      <div style={{ position: "absolute", left: 96, bottom: 68, padding: "18px 26px", borderRadius: 16, background: "rgba(41,38,33,.92)", color: PAPER_2, font: `600 58px ${SERIF}`, letterSpacing: "-.03em" }}>随时找回，继续研究</div>
    </AbsoluteFill>
  );
};

const ArchiveScene: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = SHOTS.archive.duration;
  const rows = ["页面元数据", "主要正文", "本地 Markdown", "内容摘要", "完整性校验"];
  const cues = [28, 42, 55, 67, 78];
  const modalIn = clamp(frame, [0, 18], [0, 1], Easing.bezier(0.2, 0.9, 0.3, 1));
  const done = clamp(frame, [88, 101], [0, 1], Easing.bezier(0.18, 1.15, 0.3, 1));
  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, duration), background: PAPER }}>
      <PageCam src="textures/live/library-full.png" pageH={layout.library.pageH} keys={[{ frame: 0, cx: 960, cy: 680, zoom: 0.84 }, { frame: duration, cx: 960, cy: 680, zoom: 0.84 }]} blur={5} saturate={0.7} />
      <AbsoluteFill style={{ background: "rgba(246,240,231,.62)" }} />
      <div style={{ position: "absolute", left: 70, top: 235, width: 980, transform: `translateY(${(1 - modalIn) * 30}px) scale(${0.97 + modalIn * 0.03})`, opacity: modalIn }}>
        <Img src={staticFile("textures/live/recovery-modal.png")} style={{ width: 980, height: "auto", filter: "drop-shadow(0 30px 55px rgba(45,32,22,.18))" }} />
      </div>
      <div style={{ position: "absolute", left: 1135, top: 205, width: 690, padding: "42px 48px 38px", borderRadius: 28, background: "rgba(255,253,249,.94)", border: "1px solid #dfd4c6", boxShadow: "0 24px 70px rgba(45,32,22,.12)" }}>
        <div style={{ color: ACCENT, font: `700 32px ${MONO}`, letterSpacing: ".13em", marginBottom: 14 }}>ACTIVE BACKUP</div>
        <div style={{ font: `600 46px ${SERIF}`, letterSpacing: "-.035em", marginBottom: 30 }}>主动归档完成</div>
        {rows.map((row, index) => {
          const t = clamp(frame, [cues[index], cues[index] + 12], [0, 1], Easing.bezier(0.2, 0.8, 0.3, 1));
          const icon = clamp(frame, [cues[index] + 3, cues[index] + 10], [0, 1], Easing.bezier(0.18, 1.15, 0.3, 1));
          return <div key={row} style={{ height: 63, display: "flex", alignItems: "center", gap: 18, borderTop: index === 0 ? "1px solid #e8ddd0" : undefined, borderBottom: "1px solid #e8ddd0", opacity: t, transform: `translateY(${(1 - t) * 18}px)`, font: `500 32px ${SANS}` }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: GREEN, color: "white", display: "grid", placeItems: "center", transform: `scale(${icon})`, fontSize: 18 }}>✓</span>
            <span>{row}</span>
          </div>;
        })}
        <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 16, color: GREEN, font: `700 32px ${SANS}`, opacity: done, transform: `scale(${done})`, transformOrigin: "left center" }}><span style={{ fontSize: 34 }}>●</span> 数据保存在本机，可验证、可恢复</div>
      </div>
    </AbsoluteFill>
  );
};

const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = SHOTS.title.duration;
  const words = [{ text: "收藏" }, { text: "不是" }, { text: "终点，" }, { text: "思考", accent: true }, { text: "才是" }];
  const underline = clamp(frame, [18, 36], [0, 1], Easing.out(Easing.cubic));
  return (
    <PaperField>
      <AbsoluteFill style={{ opacity: sceneOpacity(frame, duration), justifyContent: "center", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 28, alignItems: "baseline" }}>
          {words.map((word, index) => {
            const cue = index * 4 - 6;
            const t = clamp(frame, [cue, cue + 10], [0, 1], Easing.bezier(0.2, 0.75, 0.3, 1));
            return <span key={word.text} style={{ font: `600 112px ${SERIF}`, color: word.accent ? ACCENT : INK, fontStyle: word.accent ? "italic" : "normal", opacity: t, filter: `blur(${(1 - t) * 7}px)`, transform: `scale(${1.28 - t * 0.28})`, display: "inline-block" }}>{word.text}</span>;
          })}
        </div>
        <div style={{ width: 230, height: 6, borderRadius: 3, background: ACCENT, marginTop: 42, transform: `scaleX(${underline})` }} />
      </AbsoluteFill>
    </PaperField>
  );
};

const BrainstormScene: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = SHOTS.brainstorm.duration;
  const { fps } = useVideoConfig();
  const overlayOut = clamp(frame, [146, 158], [1, 0], Easing.inOut(Easing.cubic));
  const prompt = "从收藏中生成一条可执行的产品路线";
  const typed = Math.min(prompt.length, Math.max(0, Math.floor((frame - 5) * 1.1)));
  const nodes = [
    { id: 0, x: 960, y: 330, level: 0, parent: -1, title: "推荐融合方案", sub: "证据驱动" },
    { id: 1, x: 620, y: 525, level: 1, parent: 0, title: "可靠采集", sub: "链接与正文" },
    { id: 2, x: 1300, y: 525, level: 1, parent: 0, title: "持续决策", sub: "关系与路线" },
    { id: 3, x: 350, y: 720, level: 2, parent: 1, title: "主动备份", sub: "网页快照" },
    { id: 4, x: 760, y: 720, level: 2, parent: 1, title: "本地研究", sub: "档案与恢复" },
    { id: 5, x: 1160, y: 720, level: 2, parent: 2, title: "关联观点", sub: "跨项目思考" },
    { id: 6, x: 1570, y: 720, level: 2, parent: 2, title: "行动路线", sub: "下一步计划" },
  ];
  const nodeCues = [50, 68, 74, 88, 94, 100, 106];
  const nodeW = 280;
  const nodeH = 132;
  const lastCue = nodeCues[nodeCues.length - 1];
  const breathe = clamp(frame, [lastCue + 14, lastCue + 24, lastCue + 36], [1, 1.025, 1], Easing.inOut(Easing.sin));
  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, duration), background: PAPER }}>
      <PageCam
        src="textures/live/brainstorm-full.png"
        pageH={layout.brainstorm.pageH}
        keys={[
          { frame: 0, cx: 960, cy: 500, zoom: 0.82 },
          { frame: 146, cx: 960, cy: 940, zoom: 0.94 },
          { frame: duration, cx: 960, cy: 1100, zoom: 0.96 },
        ]}
        blur={overlayOut * 2}
        saturate={0.92 + (1 - overlayOut) * 0.08}
      />
      <AbsoluteFill style={{ opacity: overlayOut, background: "rgba(246,240,231,.94)" }}>
        <div style={{ position: "absolute", top: 92, left: 420, width: 1080, height: 88, borderRadius: 44, border: `2px solid ${ACCENT}`, background: "rgba(255,250,243,.96)", display: "flex", alignItems: "center", padding: "0 42px", color: INK, font: `600 34px ${SANS}`, boxShadow: "0 16px 42px rgba(45,32,22,.1)" }}>
          {prompt.slice(0, typed)}<span style={{ marginLeft: 5, color: ACCENT, opacity: typed < prompt.length || Math.floor(frame / 5) % 2 === 0 ? 1 : 0 }}>▌</span>
        </div>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${breathe})`, transformOrigin: "960px 575px" }}>
          <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
            {nodes.filter((node) => node.parent >= 0).map((node, index) => {
              const parent = nodes[node.parent];
              const cue = nodeCues[node.id];
              const grow = clamp(frame, [cue - 8, cue + 8], [0, 1], Easing.out(Easing.cubic));
              const midY = (parent.y + node.y) / 2;
              const path = `M ${parent.x} ${parent.y + nodeH / 2} L ${parent.x} ${midY} L ${node.x} ${midY} L ${node.x} ${node.y - nodeH / 2}`;
              return <path key={node.id} d={path} pathLength="1" stroke="#b88062" strokeWidth="4" fill="none" strokeDasharray="1" strokeDashoffset={1 - grow} strokeLinejoin="round" />;
            })}
          </svg>
          {nodes.map((node) => {
            if (frame < nodeCues[node.id]) return null;
            const raw = spring({ frame: frame - nodeCues[node.id], fps, config: { damping: 16, stiffness: 120, mass: 0.9 } });
            const pop = Math.min(1.04, Math.max(0, raw));
            const root = node.level === 0;
            return <div key={node.id} style={{ position: "absolute", left: node.x - nodeW / 2, top: node.y - nodeH / 2, width: nodeW, height: nodeH, borderRadius: 20, background: root ? ACCENT : PAPER_2, color: INK, padding: "18px 24px", border: `2px solid ${root ? ACCENT : "#dccdbd"}`, boxShadow: "0 18px 50px rgba(45,32,22,.13)", transform: `scale(${pop})`, boxSizing: "border-box" }}>
              <strong style={{ font: `600 30px ${SERIF}` }}>{node.title}</strong><small style={{ display: "block", marginTop: 4, color: root ? INK : MUTED, font: `600 32px/1.05 ${SANS}` }}>{node.sub}</small>
            </div>;
          })}
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 188, background: "linear-gradient(180deg, rgba(246,240,231,0), rgba(246,240,231,.96) 42%, #f6f0e7 100%)" }} />
      <Caption
        kicker="BRAINSTORM · LOCAL DECISION"
        title="收藏之间，开始发生连接"
        color={INK}
      />
    </AbsoluteFill>
  );
};

const SparkMark: React.FC<{ size: number; color?: string }> = ({ size, color = PAPER_2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M12 1.7 15 9l7.3 3-7.3 3-3 7.3L9 15l-7.3-3L9 9l3-7.3Z" />
  </svg>
);

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = SHOTS.outro.duration;
  const click = 12;
  const fly = clamp(frame, [16, 28], [0, 1], Easing.in(Easing.cubic));
  const rawMorph = spring({ frame: frame - 24, fps, config: { damping: 16, stiffness: 95, mass: 0.9 } });
  const morph = Math.min(1.03, Math.max(0, rawMorph));
  const bar = { x: 430, y: 430, w: 1060, h: 128, r: 28 };
  const finalPill = { x: 810, y: 500, w: 300, h: 108, r: 54 };
  const bx = bar.x + (finalPill.x - bar.x) * morph;
  const by = bar.y + (finalPill.y - bar.y) * morph;
  const bw = bar.w + (finalPill.w - bar.w) * morph;
  const bh = bar.h + (finalPill.h - bar.h) * morph;
  const br = bar.r + (finalPill.r - bar.r) * morph;
  const drop = (cue: number) => Math.min(1.04, Math.max(0, spring({ frame: frame - cue, fps, config: { damping: 16, stiffness: 105, mass: 0.85 } })));
  const drops = [drop(42), drop(54), drop(66)];
  const brandIn = clamp(frame, [94, 106], [0, 1], Easing.inOut(Easing.cubic));
  const assemblyOpacity = 1 - brandIn;
  const breathe = clamp(frame, [80, 88, 96], [1, 1.025, 1], Easing.inOut(Easing.sin));
  const metaIn = clamp(frame, [102, 114], [0, 1], Easing.out(Easing.cubic));
  const cursorX = clamp(frame, [0, click], [1510, 1418], Easing.out(Easing.cubic));
  const cursorY = clamp(frame, [0, click], [850, 488], Easing.out(Easing.cubic));
  return (
    <PaperField>
      <AbsoluteFill style={{ opacity: sceneOpacity(frame, duration, 6) }}>
        <div style={{ position: "absolute", inset: 0, opacity: assemblyOpacity, transform: `scale(${breathe})`, transformOrigin: "960px 520px" }}>
          <div style={{ position: "absolute", left: bx, top: by, width: bw, height: bh, borderRadius: br, border: `3px solid ${ACCENT}`, background: morph > 0.72 ? ACCENT : "rgba(255,250,243,.9)", display: "flex", alignItems: "center", padding: morph < 0.72 ? "0 36px" : 0, overflow: "hidden", boxSizing: "border-box", boxShadow: "0 24px 70px rgba(45,32,22,.13)" }}>
            <div style={{ color: INK, font: `600 42px ${SANS}`, whiteSpace: "nowrap", opacity: (1 - fly) * (1 - morph), transform: `translate(${fly * 720}px, ${-fly * 360}px) rotate(${-fly * 8}deg)` }}>把今天的灵感，变成明天的行动</div>
            <div style={{ marginLeft: "auto", width: 72, height: 72, borderRadius: 18, background: ACCENT, color: PAPER_2, display: "grid", placeItems: "center", fontSize: 35, opacity: 1 - morph, transform: `scale(${frame >= click && frame <= click + 4 ? 0.82 : 1})` }}>→</div>
          </div>
          {frame >= 42 ? <div style={{ position: "absolute", left: 756 - 54, top: -180 + (500 + 54 + 180) * drops[0], width: 108, height: 108, borderRadius: "50%", background: ACCENT, boxShadow: "0 18px 45px rgba(200,111,67,.22)" }} /> : null}
          {frame >= 54 ? <div style={{ position: "absolute", left: 1044, top: -260 + (350 + 260) * drops[1], width: 108, height: 260, borderRadius: 54, background: ACCENT, boxShadow: "0 18px 45px rgba(200,111,67,.22)" }} /> : null}
          {frame >= 66 ? <div style={{ position: "absolute", left: 1060, top: -160 + (286 + 160) * drops[2], width: 76, height: 76, borderRadius: "50%", background: GREEN, boxShadow: "0 18px 42px rgba(82,117,95,.22)" }} /> : null}
          <div style={{ position: "absolute", left: cursorX, top: cursorY, opacity: clamp(frame, [18, 28], [1, 0]), transform: `scale(${frame >= click && frame <= click + 4 ? 0.82 : 1})` }}>
            <svg width="44" height="48" viewBox="0 0 40 44"><path d="M4 2 L4 34 L13 26 L19 40 L26 37 L20 23 L32 22 Z" fill={INK} stroke={PAPER_2} strokeWidth="2" /></svg>
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 418, display: "flex", justifyContent: "center", alignItems: "center", gap: 34, opacity: brandIn, transform: `translateY(${(1 - brandIn) * 18}px)` }}>
          <SparkMark size={86} color={ACCENT} />
          <div style={{ color: INK, font: `600 96px ${SERIF}`, letterSpacing: "-.055em" }}>灵感工作台</div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 625, textAlign: "center", opacity: metaIn, transform: `translateY(${(1 - metaIn) * 18}px)` }}>
          <div style={{ color: ACCENT, font: `700 32px ${MONO}`, letterSpacing: ".18em" }}>V2.2 · WINDOWS DESKTOP</div>
          <div style={{ marginTop: 24, color: INK, font: `600 40px ${SANS}` }}>桌面客户端 · 数据保存在本地 · 一次下载，长期使用</div>
        </div>
      </AbsoluteFill>
    </PaperField>
  );
};

type PromoProps = { bgm: boolean };

const SFX = [
  { from: SHOTS.brand.from + 13, src: "audio/transition-soft.mp3", volume: 0.34, duration: 42 },
  { from: SHOTS.risk.from + 54, src: "audio/air-woosh-deep.mp3", volume: 0.34, duration: 52 },
  { from: SHOTS.capture.from + 14, src: "audio/whoosh-fast.mp3", volume: 0.28, duration: 60 },
  { from: SHOTS.search.from + 10, src: "audio/typewriter-digital.mp3", volume: 0.27, duration: 34 },
  { from: SHOTS.search.from + 66, src: "audio/click-camera.mp3", volume: 0.5, duration: 12 },
  { from: SHOTS.archive.from + 20, src: "audio/transition-soft.mp3", volume: 0.28, duration: 42 },
  { from: SHOTS.archive.from + 55, src: "audio/click-camera.mp3", volume: 0.34, duration: 10 },
  { from: SHOTS.archive.from + 78, src: "audio/click-camera.mp3", volume: 0.34, duration: 10 },
  { from: SHOTS.title.from + 4, src: "audio/swoosh-quick.mp3", volume: 0.3, duration: 28 },
  { from: SHOTS.brainstorm.from + 30, src: "audio/whoosh-fast.mp3", volume: 0.26, duration: 52 },
  { from: SHOTS.outro.from + 18, src: "audio/air-whoosh-powerful.mp3", volume: 0.34, duration: 70 },
  { from: SHOTS.outro.from + 78, src: "audio/impact-deep-whoosh.mp3", volume: 0.48, duration: 72 },
  { from: SHOTS.outro.from + 104, src: "audio/sparkle-wand.mp3", volume: 0.3, duration: 44 },
];

export const LingganV22: React.FC<PromoProps> = ({ bgm }) => {
  return (
    <AbsoluteFill style={{ background: PAPER, fontFamily: SANS }}>
      <Sequence from={SHOTS.brand.from} durationInFrames={SHOTS.brand.duration}><BrandScene /></Sequence>
      <Sequence from={SHOTS.risk.from} durationInFrames={SHOTS.risk.duration}><RiskScene /></Sequence>
      <Sequence from={SHOTS.capture.from} durationInFrames={SHOTS.capture.duration}><CaptureScene /></Sequence>
      <Sequence from={SHOTS.search.from} durationInFrames={SHOTS.search.duration}><SearchScene /></Sequence>
      <Sequence from={SHOTS.archive.from} durationInFrames={SHOTS.archive.duration}><ArchiveScene /></Sequence>
      <Sequence from={SHOTS.title.from} durationInFrames={SHOTS.title.duration}><TitleScene /></Sequence>
      <Sequence from={SHOTS.brainstorm.from} durationInFrames={SHOTS.brainstorm.duration}><BrainstormScene /></Sequence>
      <Sequence from={SHOTS.outro.from} durationInFrames={SHOTS.outro.duration}><OutroScene /></Sequence>
      {bgm ? <Audio src={staticFile("audio/bgm.mp3")} volume={(f) => clamp(f, [0, 30, 840, 900], [0, 0.25, 0.25, 0])} /> : null}
      {SFX.map((item) => (
        <Sequence key={`${item.from}-${item.src}`} from={item.from} durationInFrames={item.duration}>
          <Audio src={staticFile(item.src)} volume={item.volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
