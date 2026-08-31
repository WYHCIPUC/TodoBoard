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

const PAPER = "#f6f0e7";
const PAPER_2 = "#fffaf3";
const INK = "#292621";
const MUTED = "#786f64";
const ACCENT = "#c2410c";
const PURPLE = "#7657c7";
const GREEN = "#4f7c69";
const LINE = "#ded3c4";
const SERIF = 'Georgia, "Noto Serif SC", "Songti SC", serif';
const SANS = 'Inter, "Microsoft YaHei", sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

export const FPS = 30;
export const BEAT_ZERO = 0.059507;
export const BEAT_INTERVAL = 0.69244085;
export const beatF = (beat: number) => Math.round((BEAT_ZERO + beat * BEAT_INTERVAL) * FPS);

const V2_FLIP_FRAME = beatF(50) - beatF(46);
const V21_ROW_CUES = [72, 74, 76, 78].map((beat) => beatF(beat) - beatF(70));
const V22_STEP_CUES = [40, 88, 136, 184] as const;
const V23_RELATIONSHIP_FRAME = 88;
const V23_BRAINSTORM_FRAME = 176;
const CAPABILITY_SWITCHES = [12, 72, 132, 192] as const;
const BGM_SECOND_FROM = beatF(134);

const makeShot = (startBeat: number, endBeat: number, tail = 0) => {
  const from = startBeat === 0 ? 0 : beatF(startBeat);
  const to = beatF(endBeat) + tail;
  return { from, duration: to - from };
};

export const SHOTS = {
  open: makeShot(0, 10),
  decay: makeShot(10, 22),
  timeline: makeShot(22, 34),
  v1: makeShot(34, 46),
  v2: makeShot(46, 58),
  capture: makeShot(58, 70),
  v21: makeShot(70, 82),
  parser: makeShot(82, 94),
  v22: makeShot(94, 106),
  collect: makeShot(106, 118),
  relationship: makeShot(118, 132),
  brainstorm: makeShot(132, 148),
  capabilities: makeShot(148, 162),
  outro: makeShot(162, 174, 2),
} as const;

export const TOTAL_FRAMES = SHOTS.outro.from + SHOTS.outro.duration;

const clamp = (
  frame: number,
  points: number[],
  values: number[],
  easing?: (value: number) => number,
) => interpolate(frame, points, values, {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing,
});

const safeSpring = (frame: number, fps: number, config = { damping: 17, stiffness: 115 }) =>
  Math.max(0, Math.min(1.04, spring({ frame, fps, config })));

const PaperField: React.FC<{ children?: React.ReactNode; dark?: boolean }> = ({ children, dark = false }) => (
  <AbsoluteFill style={{
    background: dark
      ? "radial-gradient(circle at 50% 38%, #382e27 0%, #211d19 62%, #151311 100%)"
      : `radial-gradient(circle at 50% 35%, ${PAPER_2} 0%, ${PAPER} 70%, #eee5d9 100%)`,
    color: dark ? PAPER_2 : INK,
    overflow: "hidden",
  }}>
    {children}
    <AbsoluteFill style={{
      opacity: dark ? 0.04 : 0.065,
      mixBlendMode: "multiply",
      pointerEvents: "none",
      backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E\")",
    }} />
  </AbsoluteFill>
);

const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = ACCENT }) => (
  <div style={{ color, font: `700 27px ${MONO}`, letterSpacing: ".2em", textTransform: "uppercase" }}>{children}</div>
);

const VisibleEvidence: React.FC<{ children: React.ReactNode; color?: string; dark?: boolean }> = ({ children, color = ACCENT, dark = false }) => (
  <div style={{
    position: "absolute",
    right: 76,
    top: 58,
    maxWidth: 820,
    padding: "14px 20px",
    borderRadius: 999,
    border: `1px solid ${dark ? "rgba(255,250,243,.2)" : `${color}55`}`,
    background: dark ? "rgba(255,250,243,.1)" : "rgba(255,250,243,.94)",
    color: dark ? PAPER_2 : INK,
    boxShadow: dark ? "none" : "0 12px 34px rgba(45,32,22,.08)",
    font: `700 32px ${SANS}`,
    letterSpacing: "-.01em",
    zIndex: 8,
  }}><span style={{ color, marginRight: 12, font: `800 18px ${MONO}`, letterSpacing: ".12em" }}>画面对应</span>{children}</div>
);

const WindowFrame: React.FC<{
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  borderColor?: string;
  objectPosition?: string;
  opacity?: number;
  transform?: string;
}> = ({ src, x, y, width, height, borderColor = LINE, objectPosition = "50% 0%", opacity = 1, transform }) => (
  <div style={{
    position: "absolute",
    left: x,
    top: y,
    width,
    height,
    borderRadius: 26,
    overflow: "hidden",
    border: `2px solid ${borderColor}`,
    boxShadow: "0 28px 80px rgba(45,32,22,.16)",
    background: PAPER_2,
    opacity,
    transform,
  }}>
    <Img src={staticFile(`textures/live/${src}`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition }} />
  </div>
);

const AppSpark: React.FC<{ size: number; color?: string }> = ({ size, color = ACCENT }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <path d="M50 4 61 38 96 50 61 62 50 96 39 62 4 50 39 38 50 4Z" fill={color} />
    <circle cx="50" cy="50" r="7" fill={PAPER_2} />
  </svg>
);

const BrandOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const word = "灵感工作台";
  const kicker = "LOCAL-FIRST IDEA WORKBENCH · 1.0 → 2.3";
  const vDraw = clamp(frame, [0, 12], [100, 0], Easing.out(Easing.cubic));
  const hDraw = clamp(frame, [9, 22], [100, 0], Easing.linear);
  const crossFade = clamp(frame, [30, 42], [1, 0]);
  const out = clamp(frame, [106, SHOTS.open.duration], [0, 1], Easing.in(Easing.cubic));
  const kickerChars = Math.min(kicker.length, Math.floor(Math.max(0, frame - 52) / 0.8));
  const subIn = clamp(frame, [58, 76], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <div style={{ position: "absolute", left: 104, top: 190, opacity: 1 - out, transform: `translateY(${-out * 38}px) scale(${1 - out * .08})`, transformOrigin: "left center" }}>
      <svg width="76" height="76" viewBox="0 0 76 76" style={{ display: "block", opacity: crossFade }}>
        <line x1="38" y1="3" x2="38" y2="73" stroke={ACCENT} strokeWidth="5" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={vDraw} />
        <line x1="3" y1="38" x2="73" y2="38" stroke={ACCENT} strokeWidth="5" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={hDraw} />
      </svg>
      <div style={{ marginTop: 18, minHeight: 34, color: ACCENT, font: `700 27px ${MONO}`, letterSpacing: ".2em" }}>
        {kicker.slice(0, kickerChars)}
        <span style={{ display: "inline-block", width: 12, height: 25, marginLeft: 5, background: ACCENT, opacity: frame < 94 && Math.floor(frame / 4) % 2 === 0 ? 1 : 0 }} />
      </div>
      <div style={{ marginTop: 26, display: "flex", alignItems: "flex-end", minHeight: 170 }}>
        {word.split("").map((char, index) => {
          const t = clamp(frame, [18 + index * 7, 36 + index * 7], [0, 1], Easing.bezier(.2, .72, .25, 1));
          const glint = clamp(frame, [30 + index * 7, 34 + index * 7, 39 + index * 7], [0, 1, 0]);
          return <span key={char} style={{
            position: "relative",
            display: "inline-block",
            color: INK,
            font: `600 150px/.95 ${SERIF}`,
            letterSpacing: "-.06em",
            opacity: t,
            transform: `scale(${1.55 - .55 * t})`,
            transformOrigin: "center bottom",
            filter: `blur(${(1 - t) * 6}px)`,
          }}>
            {char}
            <i style={{ position: "absolute", left: "50%", bottom: -10, width: `${glint * 92}%`, height: 4, borderRadius: 2, background: ACCENT, transform: "translateX(-50%)" }} />
          </span>;
        })}
      </div>
      <div style={{ marginTop: 44, color: MUTED, font: `600 39px/1.45 ${SANS}`, opacity: subIn, transform: `translateY(${(1 - subIn) * 18}px)` }}>
        把易失效的外部线索，变成真正属于你的本地知识资产。
      </div>
    </div>
    <div style={{ position: "absolute", right: 110, bottom: 96, color: MUTED, font: `700 23px ${MONO}`, letterSpacing: ".16em", opacity: subIn * (1 - out) }}>DISCOVER · SAVE · RESEARCH · DECIDE</div>
  </PaperField>;
};

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const title = "灵感工作台";
  const rule = clamp(frame, [8, 26], [0, 1], Easing.out(Easing.cubic));
  const sub = clamp(frame, [52, 76], [0, 1], Easing.out(Easing.cubic));
  const aside = clamp(frame, [68, 92], [0, 1], Easing.out(Easing.cubic));
  const out = clamp(frame, [SHOTS.open.duration - 24, SHOTS.open.duration], [0, 1], Easing.in(Easing.cubic));
  return <PaperField>
    <div style={{ position: "absolute", left: 100, top: 116, width: 1180, opacity: 1 - out, transform: `translateY(${-out * 30}px)` }}>
      <Kicker>LOCAL-FIRST IDEA WORKBENCH · 1.0—2.3</Kicker>
      <div style={{ marginTop: 30, width: 172 * rule, height: 5, borderRadius: 3, background: ACCENT }} />
      <div style={{ marginTop: 52, minHeight: 150, display: "flex", alignItems: "flex-end" }}>
        {title.split("").map((char, index) => {
          const t = clamp(frame, [18 + index * 7, 40 + index * 7], [0, 1], Easing.bezier(.2, .72, .25, 1));
          return <span key={char} style={{ display: "inline-block", color: INK, font: `600 146px/.95 ${SERIF}`, letterSpacing: "-.065em", opacity: t, transform: `scale(${1.42 - .42 * t})`, transformOrigin: "center bottom", filter: `blur(${(1 - t) * 7}px)` }}>{char}</span>;
        })}
      </div>
      <div style={{ marginTop: 46, width: 930, color: MUTED, font: `600 42px/1.55 ${SANS}`, opacity: sub, transform: `translateY(${(1 - sub) * 18}px)` }}>把可能消失的链接，变成可以继续研究、追溯和行动的本地资产。</div>
    </div>
    <div style={{ position: "absolute", right: 88, top: 88, bottom: 88, width: 430, borderLeft: `1px solid ${LINE}`, padding: "28px 0 0 48px", boxSizing: "border-box", opacity: aside * (1 - out) }}>
      <div style={{ color: ACCENT, font: `600 88px/1 ${SERIF}` }}>01—05</div>
      <div style={{ marginTop: 420, font: `600 58px/1.12 ${SERIF}` }}>先保全，<br />再理解。</div>
      <div style={{ marginTop: 24, color: MUTED, whiteSpace: "pre-line", font: `700 23px/1.42 ${MONO}`, letterSpacing: ".12em" }}>DISCOVER · SAVE · ARCHIVE{`\n`}RESEARCH · CONNECT · VERIFY</div>
    </div>
  </PaperField>;
};

const DecayScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const links = [
    { label: "一篇稍后再读的文章", state: "页面已删除", cue: 16 },
    { label: "一次临时发布的项目", state: "仓库已转移", cue: 48 },
    { label: "一条重要的讨论线索", state: "内容不可用", cue: 80 },
  ];
  const saved = safeSpring(frame - 94, fps, { damping: 17, stiffness: 105 });
  const proof = clamp(frame, [132, 158], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <VisibleEvidence color={GREEN}>来源失效后，本地副本仍能打开</VisibleEvidence>
    <div style={{ position: "absolute", left: 92, top: 76 }}><Kicker>WHY IT EXISTS · LINKS ARE TEMPORARY</Kicker></div>
    <div style={{ position: "absolute", left: 92, top: 144, width: 720, font: `600 70px/1.08 ${SERIF}`, letterSpacing: "-.045em" }}>收藏之后，<br />来源可能先消失。</div>
    <div style={{ position: "absolute", left: 92, top: 410, width: 710 }}>
      {links.map((item, index) => {
        const arrive = clamp(frame, [item.cue, item.cue + 16], [0, 1], Easing.out(Easing.cubic));
        const fail = clamp(frame, [item.cue + 26, item.cue + 42], [0, 1], Easing.inOut(Easing.cubic));
        return <div key={item.label} style={{ position: "relative", height: 116, marginBottom: 18, padding: "0 24px", borderRadius: 18, background: PAPER_2, border: `1px solid ${LINE}`, display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", opacity: arrive, transform: `translateX(${(1 - arrive) * -32}px)`, overflow: "hidden" }}>
          <div><div style={{ font: `700 31px ${SANS}` }}>{item.label}</div><div style={{ marginTop: 9, color: MUTED, font: `600 22px ${MONO}` }}>https://source.example/item-{index + 1}</div></div>
          <div style={{ color: fail > .55 ? ACCENT : GREEN, font: `800 24px ${SANS}` }}>{fail > .55 ? item.state : "已收藏"}</div>
          <div style={{ position: "absolute", left: 20, right: 20, top: 56, height: 3, background: ACCENT, transform: `scaleX(${fail})`, transformOrigin: "left center", opacity: .78 }} />
        </div>;
      })}
    </div>
    <div style={{ position: "absolute", left: 840, top: 463, width: 170, textAlign: "center", color: MUTED, opacity: saved, font: `700 26px ${MONO}`, letterSpacing: ".12em" }}>保存时<br />→</div>
    <div style={{ position: "absolute", right: 86, top: 142, width: 820, height: 690, borderRadius: 30, background: INK, color: PAPER_2, overflow: "hidden", boxShadow: "0 32px 92px rgba(45,32,22,.22)", opacity: saved, transform: `translateY(${(1 - saved) * 70}px) scale(${.94 + saved * .06})` }}>
      <Img src={staticFile("textures/live/entry-full.png")} style={{ width: "100%", height: 470, objectFit: "cover", objectPosition: "50% 0%", opacity: .54, filter: "saturate(.5) contrast(1.08)" }} />
      <div style={{ position: "absolute", left: 30, top: 30, padding: "10px 16px", borderRadius: 999, background: GREEN, color: "white", font: `800 20px ${MONO}`, letterSpacing: ".12em" }}>LOCAL COPY</div>
      <div style={{ padding: "30px 36px" }}><div style={{ color: "#d9a27d", font: `700 23px ${MONO}`, letterSpacing: ".14em" }}>CONTENT · METADATA · EVIDENCE</div><div style={{ marginTop: 16, font: `600 43px/1.25 ${SERIF}` }}>来源失效后，已取得的主要内容仍在本机。</div></div>
    </div>
    <div style={{ position: "absolute", left: 92, right: 86, bottom: 68, paddingTop: 24, borderTop: `2px solid ${INK}`, display: "flex", justifyContent: "space-between", opacity: proof, font: `600 31px ${SANS}` }}><span>这不是“链接永不失效”的承诺</span><b style={{ color: GREEN }}>而是把今天取得的证据先保留下来</b></div>
  </PaperField>;
};

const TIMELINE_ITEMS = [
  { version: "v1.0", title: "本地收藏", body: "解析 · 分类 · Markdown\n研究笔记", color: ACCENT },
  { version: "v2.0", title: "桌面工作台", body: "Windows 成品 · 研究工具\n头脑风暴", color: "#d18a3d" },
  { version: "v2.1", title: "主动归档", body: "先保存再增强\n正文与页面证据", color: "#bf6b52" },
  { version: "v2.2", title: "可信恢复", body: "预检 · 确认 · 事务\n可验证收据", color: PURPLE },
  { version: "v2.3", title: "三阶段闭环", body: "收集 · 关系整理\n融合决策", color: GREEN },
];

const TimelineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const axisY = 715;
  const gap = 1160;
  const ticks = TIMELINE_ITEMS.map((item, index) => ({ ...item, x: 960 + index * gap }));
  const travelStart = 14;
  const travelEnd = 178;
  const zoomEnd = 195;
  const total = ticks[ticks.length - 1].x - 960;
  const camXAt = (value: number) => {
    const t = clamp(value, [travelStart, travelEnd], [0, 1]);
    const eased = clamp(t, [0, .16, .88, 1], [0, .055, .9, 1], Easing.inOut(Easing.quad));
    return eased * total;
  };
  const popFrameOf = (x: number) => {
    for (let f = travelStart; f <= travelEnd; f += 1) if (camXAt(f) >= x - 960) return f;
    return travelEnd;
  };
  const camX = camXAt(frame);
  const zoom = clamp(frame, [travelEnd, zoomEnd], [1, 1.24], Easing.out(Easing.cubic));
  const latestGlow = clamp(frame, [184, 204], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <VisibleEvidence color={GREEN}>版本节点从 v1.0 走到 v2.3</VisibleEvidence>
    <div style={{ position: "absolute", left: 98, top: 84 }}><Kicker>FIVE RELEASES · ONE CLEAR DIRECTION</Kicker></div>
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transform: `scale(${zoom})`, transformOrigin: "50% 64%" }}>
      <div style={{ position: "absolute", width: ticks[ticks.length - 1].x + 980, height: 1080, transform: `translateX(${-camX}px)` }}>
        <div style={{ position: "absolute", left: 160, top: axisY - 3, right: 160, height: 6, borderRadius: 3, background: "#d8cec1" }} />
        {Array.from({ length: 33 }).map((_, index) => <div key={index} style={{ position: "absolute", left: 960 + index * (gap / 8), top: axisY - 12, width: 4, height: 24, borderRadius: 2, background: "#c8baaa" }} />)}
        {ticks.map((item, index) => {
          const popAt = popFrameOf(item.x) - 7;
          const pop = frame < popAt ? 0 : safeSpring(frame - popAt, fps, { damping: 12, stiffness: 155 });
          return <div key={item.version} style={{ position: "absolute", left: item.x, top: 0 }}>
            <div style={{ position: "absolute", left: -3, top: axisY - 32, width: 6, height: 64, borderRadius: 3, background: item.color }} />
            <div style={{ position: "absolute", left: -90, top: axisY + 47, width: 180, textAlign: "center", color: item.color, font: `800 42px ${SERIF}` }}>{item.version}</div>
            <div style={{
              position: "absolute",
              left: -230,
              top: axisY - 355,
              width: 460,
              height: 310,
              padding: "34px 36px",
              boxSizing: "border-box",
              borderRadius: 26,
              background: PAPER_2,
              border: `2px solid ${item.color}${index === 4 ? "" : "77"}`,
              boxShadow: index === 4 ? `0 28px 86px rgba(79,124,105,${.12 + latestGlow * .18})` : "0 22px 64px rgba(45,32,22,.12)",
              transform: `scaleY(${pop}) scaleX(${.68 + .32 * pop})`,
              transformOrigin: "50% 100%",
              opacity: Math.min(1, pop * 2),
            }}>
              <div style={{ color: item.color, font: `800 32px ${MONO}`, letterSpacing: ".1em" }}>{item.version}</div>
              <div style={{ marginTop: 21, font: `600 47px ${SERIF}`, letterSpacing: "-.035em" }}>{item.title}</div>
              <div style={{ marginTop: 22, color: MUTED, whiteSpace: "pre-line", font: `600 32px/1.45 ${SANS}` }}>{item.body}</div>
            </div>
          </div>;
        })}
      </div>
    </div>
    <div style={{ position: "absolute", right: 80, bottom: 70, padding: "16px 24px", borderRadius: 999, background: GREEN, color: "white", opacity: latestGlow, transform: `translateY(${(1 - latestGlow) * 15}px)`, font: `800 24px ${MONO}`, letterSpacing: ".12em" }}>TODAY · v2.3</div>
  </PaperField>;
};

const V1Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const pageIn = clamp(frame, [4, 28], [0, 1], Easing.out(Easing.cubic));
  const features = ["链接元数据解析", "自动分类", "本地 Markdown", "独立研究笔记"];
  const proofIn = clamp(frame, [142, 164], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <VisibleEvidence>收藏看板、分类与研究入口</VisibleEvidence>
    <div style={{ position: "absolute", left: 92, top: 112, width: 500 }}>
      <Kicker>V1.0 · THE FOUNDATION</Kicker>
      <div style={{ marginTop: 20, font: `600 75px/1.08 ${SERIF}`, letterSpacing: "-.045em" }}>从一条链接，<br />开始本地研究</div>
      <div style={{ marginTop: 30, color: MUTED, font: `600 36px/1.55 ${SANS}` }}>把收藏、分类和研究笔记放进一个可以直接阅读、复制与备份的本地文件。</div>
      <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {features.map((feature, index) => {
          const t = clamp(frame, [36 + index * 16, 50 + index * 16], [0, 1], Easing.out(Easing.cubic));
          return <div key={feature} style={{ minHeight: 72, padding: "0 10px", borderRadius: 14, background: PAPER_2, border: `1px solid ${LINE}`, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", opacity: t, transform: `translateY(${(1 - t) * 14}px)`, font: `700 32px/1.1 ${SANS}` }}><span style={{ color: ACCENT, font: `800 18px ${MONO}` }}>{`0${index + 1}`}</span>{feature}</div>;
        })}
      </div>
    </div>
    <WindowFrame src="v1-board.png" x={626} y={106} width={1205} height={678} borderColor={`${ACCENT}88`} objectPosition="50% 0%" opacity={pageIn} transform={`translateY(${(1 - pageIn) * 44}px) scale(${.95 + pageIn * .05})`} />
    <div style={{ position: "absolute", left: 626, right: 89, bottom: 96, height: 132, borderRadius: 23, background: INK, color: PAPER_2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 36px", boxSizing: "border-box", opacity: proofIn, transform: `translateY(${(1 - proofIn) * 24}px)` }}>
      <div><div style={{ color: "#d9a27d", font: `700 23px ${MONO}`, letterSpacing: ".15em" }}>ON SCREEN</div><div style={{ marginTop: 11, font: `600 34px ${SERIF}` }}>链接、分类与研究入口来自同一份本地数据</div></div>
      <div style={{ color: "#a9cbb8", font: `800 32px ${SANS}` }}>收藏 → 分类 → 研究</div>
    </div>
  </PaperField>;
};

const V2Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flip = V2_FLIP_FRAME;
  const frameGrow = clamp(frame, [0, 18], [0, 44], Easing.out(Easing.cubic));
  const frameColor = frame < flip ? ACCENT : GREEN;
  const flash = frame >= flip && frame < flip + 3 ? .5 - (frame - flip) * .16 : 0;
  const leftIn = safeSpring(frame - 8, fps, { damping: 17, stiffness: 105 });
  const rightIn = safeSpring(frame - flip, fps, { damping: 17, stiffness: 105 });
  const facts = ["Windows 单文件 EXE", "无需账号或激活", "研究模板与全文搜索", "头脑风暴可保存为 Markdown"];
  return <PaperField>
    <VisibleEvidence color={GREEN}>收藏工作台与头脑风暴并列呈现</VisibleEvidence>
    <div style={{ position: "absolute", inset: frameGrow, borderRadius: 10, overflow: "hidden" }}>
      <WindowFrame src="library-full.png" x={88} y={132} width={970} height={546} borderColor={`${ACCENT}88`} opacity={leftIn} transform={`translateX(${(1 - leftIn) * -90}px) rotate(-2deg)`} />
      <WindowFrame src="ui-polish-brainstorm.png" x={868} y={236} width={952} height={536} borderColor={`${GREEN}88`} objectPosition="50% 0%" opacity={rightIn} transform={`translateX(${(1 - rightIn) * 100}px) rotate(2deg)`} />
      <div style={{ position: "absolute", left: 93, top: 66 }}><Kicker color={frameColor}>V2.0 · FROM TOOL TO WORKBENCH</Kicker></div>
      <div style={{ position: "absolute", left: 120, right: 120, bottom: 70, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {facts.map((fact, index) => {
          const t = clamp(frame, [75 + index * 17, 89 + index * 17], [0, 1], Easing.out(Easing.cubic));
          return <div key={fact} style={{ minHeight: 98, padding: "0 19px", borderRadius: 18, background: PAPER_2, border: `1px solid ${LINE}`, display: "flex", alignItems: "center", gap: 13, opacity: t, transform: `translateY(${(1 - t) * 20}px)`, boxShadow: "0 14px 36px rgba(45,32,22,.08)", font: `700 32px/1.25 ${SANS}` }}><span style={{ color: frameColor, font: `800 19px ${MONO}` }}>{`0${index + 1}`}</span>{fact}</div>;
        })}
      </div>
    </div>
    {[{ left: 0, top: 0, right: 0, height: frameGrow }, { left: 0, bottom: 0, right: 0, height: frameGrow }, { left: 0, top: 0, bottom: 0, width: frameGrow }, { right: 0, top: 0, bottom: 0, width: frameGrow }].map((style, index) => <div key={index} style={{ position: "absolute", background: frameColor, ...style }} />)}
    {flash > 0 ? <AbsoluteFill style={{ background: "white", opacity: flash }} /> : null}
  </PaperField>;
};

const CaptureFlowScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stages = [
    { no: "01", title: "手机发现", body: "复制正在阅读的链接", cue: 18, color: ACCENT },
    { no: "02", title: "受限消息入口", body: "可选企业微信 / 钉钉", cue: 70, color: PURPLE },
    { no: "03", title: "本机收件箱", body: "先保存，再后台归档", cue: 122, color: GREEN },
  ];
  const line = clamp(frame, [36, 150], [0, 1], Easing.inOut(Easing.cubic));
  const proof = clamp(frame, [166, 192], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <VisibleEvidence color={PURPLE}>手机提交链接，桌面负责保存与归档</VisibleEvidence>
    <div style={{ position: "absolute", left: 92, top: 70 }}><Kicker>CAPTURE FROM WHERE IDEAS HAPPEN</Kicker></div>
    <div style={{ position: "absolute", left: 92, top: 132, font: `600 72px/1.06 ${SERIF}`, letterSpacing: "-.045em" }}>手机刷到，<br />桌面接住。</div>
    <div style={{ position: "absolute", left: 612, right: 92, top: 150, height: 410 }}>
      <div style={{ position: "absolute", left: 140, right: 140, top: 178, height: 5, borderRadius: 3, background: LINE }} />
      <div style={{ position: "absolute", left: 140, width: `calc((100% - 280px) * ${line})`, top: 178, height: 5, borderRadius: 3, background: `linear-gradient(90deg, ${ACCENT}, ${PURPLE}, ${GREEN})` }} />
      <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28 }}>
        {stages.map((stage) => {
          const pop = safeSpring(frame - stage.cue, fps, { damping: 15, stiffness: 120 });
          return <div key={stage.no} style={{ alignSelf: "center", height: 280, padding: "30px 28px", borderRadius: 24, background: PAPER_2, border: `2px solid ${stage.color}88`, boxShadow: "0 22px 64px rgba(45,32,22,.12)", opacity: pop, transform: `translateY(${(1 - pop) * 54}px) scale(${.94 + pop * .06})`, boxSizing: "border-box" }}>
            <div style={{ color: stage.color, font: `800 25px ${MONO}`, letterSpacing: ".12em" }}>{stage.no}</div>
            <div style={{ marginTop: 52, font: `600 42px ${SERIF}` }}>{stage.title}</div>
            <div style={{ marginTop: 20, color: MUTED, font: `600 32px/1.4 ${SANS}` }}>{stage.body}</div>
          </div>;
        })}
      </div>
    </div>
    <div style={{ position: "absolute", left: 92, top: 565, width: 520, padding: "28px 31px", borderRadius: 24, background: INK, color: PAPER_2, opacity: proof, transform: `translateY(${(1 - proof) * 24}px)` }}>
      <div style={{ color: "#d9a27d", font: `700 22px ${MONO}`, letterSpacing: ".14em" }}>SIMPLE OUTSIDE · SAFE INSIDE</div>
      <div style={{ marginTop: 15, font: `600 35px/1.42 ${SERIF}` }}>外部入口只负责新增链接，不暴露完整数据 API。</div>
    </div>
    <WindowFrame src="capture-modal.png" x={650} y={610} width={510} height={258} borderColor={`${ACCENT}88`} opacity={proof} transform={`translateY(${(1 - proof) * 34}px) rotate(-2deg)`} />
    <WindowFrame src="v1-board.png" x={1095} y={594} width={690} height={388} borderColor={`${GREEN}88`} objectPosition="50% 0%" opacity={proof} transform={`translateY(${(1 - proof) * 48}px) rotate(2deg)`} />
    <div style={{ position: "absolute", right: 92, bottom: 54, color: MUTED, font: `600 30px ${SANS}`, opacity: proof }}>核心流程无需账号，也不依赖外部 AI 或 API Key。</div>
  </PaperField>;
};

const V21Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const modal = safeSpring(frame - 16, fps, { damping: 17, stiffness: 105 });
  const rows = [
    ["01", "URL 先写入本机", "网络失败也不撤销收藏"],
    ["02", "主动提取正文与元数据", "标题、作者、摘要与主要内容"],
    ["03", "关键图片与原始页面留存", "为来源失效准备本地证据"],
    ["04", "可恢复队列与分级重试", "重启继续，失败原因清楚可见"],
  ];
  const verdict = clamp(frame, [176, 199], [0, 1], Easing.out(Easing.cubic));
  return <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
    <VisibleEvidence color={GREEN}>链接先落盘，内容随后主动归档</VisibleEvidence>
    <Img src={staticFile("textures/live/library-full.png")} style={{ width: 1920, height: 1080, objectFit: "cover", objectPosition: "50% 0", filter: "saturate(.72) blur(1.5px)", transform: `scale(${1.015 + frame * .00008})` }} />
    <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(246,240,231,.98) 0%, rgba(246,240,231,.92) 46%, rgba(246,240,231,.55) 100%)" }} />
    <div style={{ position: "absolute", left: 86, top: 70, width: 700 }}>
      <Kicker>V2.1 · PROACTIVE LOCAL ARCHIVE</Kicker>
      <div style={{ marginTop: 19, font: `600 68px/1.08 ${SERIF}`, letterSpacing: "-.045em" }}>先保存，再主动备份</div>
    </div>
    <div style={{ position: "absolute", left: 88, top: 300, width: 690, height: 350, borderRadius: 28, overflow: "hidden", background: PAPER_2, boxShadow: "0 30px 86px rgba(45,32,22,.18)", opacity: modal, transform: `translateY(${(1 - modal) * 80}px) scale(${.93 + modal * .07})` }}>
      <Img src={staticFile("textures/live/capture-modal.png")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0%" }} />
    </div>
    <div style={{ position: "absolute", right: 88, top: 194, width: 900, padding: "28px 34px", borderRadius: 28, background: "rgba(255,250,243,.97)", border: `1px solid ${LINE}`, boxShadow: "0 28px 74px rgba(45,32,22,.14)" }}>
      {rows.map(([no, title, body], index) => {
        const cue = V21_ROW_CUES[index];
        const t = clamp(frame, [cue, cue + 15], [0, 1], Easing.out(Easing.cubic));
        return <div key={no} style={{ minHeight: 112, borderBottom: index === rows.length - 1 ? "none" : `1px solid ${LINE}`, display: "grid", gridTemplateColumns: "72px 1fr 54px", alignItems: "center", gap: 16, opacity: t, transform: `translateX(${(1 - t) * 28}px)` }}>
          <span style={{ color: ACCENT, font: `800 27px ${MONO}` }}>{no}</span>
          <span><b style={{ font: `700 36px ${SERIF}` }}>{title}</b><small style={{ display: "block", marginTop: 8, color: MUTED, font: `600 32px ${SANS}` }}>{body}</small></span>
          <span style={{ width: 38, height: 38, borderRadius: "50%", background: GREEN, color: "white", display: "grid", placeItems: "center", font: `800 22px ${SANS}` }}>✓</span>
        </div>;
      })}
    </div>
    <div style={{ position: "absolute", right: 90, bottom: 74, width: 896, padding: "22px 28px", borderRadius: 19, background: INK, color: PAPER_2, textAlign: "center", opacity: verdict, transform: `translateY(${(1 - verdict) * 20}px)`, font: `600 37px ${SERIF}` }}>来源明天失效，今天成功取得的内容仍在本机</div>
  </AbsoluteFill>;
};

const ParserReliabilityScene: React.FC = () => {
  const frame = useCurrentFrame();
  const page = clamp(frame, [4, 28], [0, 1], Easing.out(Easing.cubic));
  const githubCues = [36, 68, 100];
  const xCue = 124;
  const verdict = clamp(frame, [176, 204], [0, 1], Easing.out(Easing.cubic));
  const githubRoutes = ["默认分支", "公开 README", "网页降级"];
  const xRoutes = ["静态页面", "Syndication", "oEmbed"];
  return <PaperField>
    <VisibleEvidence color={GREEN}>GitHub 顺序降级，X 多路径并行</VisibleEvidence>
    <div style={{ position: "absolute", left: 84, top: 70 }}><Kicker>RELIABLE EXTRACTION · HONEST FALLBACKS</Kicker></div>
    <WindowFrame src="entry-full.png" x={74} y={138} width={880} height={696} borderColor={`${ACCENT}77`} objectPosition="50% 0%" opacity={page} transform={`translateX(${(1 - page) * -46}px)`} />
    <div style={{ position: "absolute", right: 76, top: 124, width: 825 }}>
      <div style={{ font: `600 66px/1.08 ${SERIF}`, letterSpacing: "-.045em" }}>抓取不是一条路，<br />失败也不装作成功。</div>
      <div style={{ marginTop: 40, padding: "24px 28px", borderRadius: 22, background: PAPER_2, border: `1px solid ${LINE}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><b style={{ font: `700 34px ${SERIF}` }}>GitHub</b><span style={{ color: MUTED, font: `700 22px ${MONO}` }}>SEQUENTIAL FALLBACK</span></div>
        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {githubRoutes.map((route, index) => { const t = clamp(frame, [githubCues[index], githubCues[index] + 14], [0, 1], Easing.out(Easing.cubic)); return <div key={route} style={{ minHeight: 94, borderRadius: 15, background: index === 2 ? "#f1e5dc" : "#eee9e1", display: "grid", placeItems: "center", textAlign: "center", opacity: t, transform: `translateX(${(1 - t) * 20}px)`, font: `700 36px ${SANS}` }}>{route}</div>; })}
        </div>
      </div>
      <div style={{ marginTop: 20, padding: "24px 28px", borderRadius: 22, background: INK, color: PAPER_2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><b style={{ font: `700 34px ${SERIF}` }}>X / Twitter</b><span style={{ color: "#b9a99a", font: `700 22px ${MONO}` }}>PARALLEL PATHS</span></div>
        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {xRoutes.map((route, index) => { const t = clamp(frame, [xCue, xCue + 16], [0, 1], Easing.out(Easing.cubic)); return <div key={route} style={{ minHeight: 94, borderRadius: 15, border: `1px solid ${index === 1 ? PURPLE : GREEN}`, display: "grid", placeItems: "center", textAlign: "center", opacity: t, transform: `scaleY(${.78 + .22 * t})`, font: `700 36px ${SANS}` }}>{route}</div>; })}
        </div>
      </div>
    </div>
    <div style={{ position: "absolute", left: 75, right: 76, bottom: 74, padding: "24px 30px", borderRadius: 20, background: GREEN, color: "white", display: "flex", justifyContent: "space-between", opacity: verdict, transform: `translateY(${(1 - verdict) * 20}px)`, font: `700 34px ${SANS}` }}><span>任一路径成功，就继续补全内容</span><span>全部失败，链接和可操作原因仍会保留</span></div>
  </PaperField>;
};

const V22Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const page = safeSpring(frame - 4, fps, { damping: 18, stiffness: 100 });
  const modal = safeSpring(frame - 28, fps, { damping: 18, stiffness: 100 });
  const steps = [
    { no: "01", title: "只读预检", color: ACCENT },
    { no: "02", title: "明确确认", color: "#d18a3d" },
    { no: "03", title: "事务写入", color: PURPLE },
    { no: "04", title: "收据复验", color: GREEN },
  ];
  const line = clamp(frame, [48, 198], [0, 1], Easing.out(Easing.cubic));
  const stop = clamp(frame, [205, 228], [0, 1], Easing.out(Easing.cubic));
  return <PaperField dark>
    <VisibleEvidence color="#d7a184" dark>预检 → 确认 → 写入 → 复验</VisibleEvidence>
    <div style={{ position: "absolute", left: 88, top: 70 }}><Kicker color="#d7a184">V2.2 · TRUSTED RECOVERY</Kicker></div>
    <WindowFrame src="recovery-full.png" x={82} y={152} width={1155} height={650} borderColor={`${PURPLE}99`} objectPosition="50% 0%" opacity={page} transform={`translateX(${(1 - page) * -80}px)`} />
    <div style={{ position: "absolute", left: 310, top: 292, width: 690, height: 388, borderRadius: 24, overflow: "hidden", opacity: modal, transform: `translateY(${(1 - modal) * 60}px) scale(${.94 + modal * .06})`, boxShadow: "0 28px 82px rgba(0,0,0,.32)" }}>
      <Img src={staticFile("textures/live/recovery-modal.png")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0%" }} />
    </div>
    <div style={{ position: "absolute", right: 80, top: 142, width: 570 }}>
      <div style={{ font: `600 62px/1.08 ${SERIF}`, letterSpacing: "-.04em" }}>恢复不是“猜一个”，<br />而是可验证地回来</div>
      <div style={{ position: "relative", marginTop: 55 }}>
        <div style={{ position: "absolute", left: 25, top: 24, bottom: 24, width: 4, borderRadius: 2, background: "rgba(255,255,255,.16)" }}><div style={{ width: "100%", height: `${line * 100}%`, background: `linear-gradient(${ACCENT}, ${PURPLE}, ${GREEN})` }} /></div>
        {steps.map((step, index) => {
          const t = clamp(frame, [V22_STEP_CUES[index], V22_STEP_CUES[index] + 13], [0, 1], Easing.out(Easing.cubic));
          return <div key={step.no} style={{ height: 86, display: "flex", alignItems: "center", gap: 22, opacity: t, transform: `translateX(${(1 - t) * 18}px)` }}>
            <span style={{ zIndex: 1, width: 52, height: 52, borderRadius: "50%", background: step.color, color: "white", display: "grid", placeItems: "center", font: `800 20px ${MONO}` }}>{step.no}</span>
            <span style={{ font: `600 34px ${SERIF}` }}>{step.title}</span>
          </div>;
        })}
      </div>
    </div>
    <div style={{ position: "absolute", left: 82, right: 80, bottom: 66, padding: "23px 34px", borderRadius: 20, background: "rgba(255,250,243,.1)", border: "1px solid rgba(255,250,243,.16)", color: "#eed9ca", opacity: stop, transform: `translateY(${(1 - stop) * 18}px)`, textAlign: "center", font: `600 37px ${SERIF}` }}>证据不完整或不明确时停止，不猜测、不覆盖最近有效数据</div>
  </PaperField>;
};

const V23Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = frame < V23_RELATIONSHIP_FRAME ? 0 : frame < V23_BRAINSTORM_FRAME ? 1 : 2;
  const stageData = [
    { no: "01", name: "灵感来袭", role: "收集与研究", color: ACCENT, src: "library-full.png" },
    { no: "02", name: "关系画布", role: "整理与溯源", color: PURPLE, src: "relationship-full.png" },
    { no: "03", name: "头脑风暴", role: "融合与决策", color: GREEN, src: "brainstorm-full.png" },
  ];
  const current = stageData[stage];
  const frameGrow = clamp(frame, [0, 18], [0, 38], Easing.out(Easing.cubic));
  const switchFlash = [V23_RELATIONSHIP_FRAME, V23_BRAINSTORM_FRAME].reduce((value, point) => Math.max(value, frame >= point && frame < point + 3 ? .46 - (frame - point) * .15 : 0), 0);
  const relationshipIn = clamp(frame, [82, 112], [0, 1], Easing.out(Easing.cubic));
  const tags = ["主题分区", "来源筛选", "节点拖拽", "反向链接"];
  const treeFrame = frame - V23_BRAINSTORM_FRAME;
  const prompt = "从真实来源形成可验证方案";
  const typed = Math.min(prompt.length, Math.max(0, Math.floor((treeFrame - 4) * 1.05)));
  const nodes = [
    { x: 1410, y: 405, cue: 44, title: "融合目标", parent: -1 },
    { x: 1190, y: 625, cue: 64, title: "来源依据", parent: 0 },
    { x: 1630, y: 625, cue: 70, title: "组合判断", parent: 0 },
    { x: 1130, y: 825, cue: 88, title: "最小验证", parent: 1 },
    { x: 1450, y: 825, cue: 94, title: "失败边界", parent: 1 },
    { x: 1740, y: 825, cue: 100, title: "下一步", parent: 2 },
  ];
  const breathe = clamp(treeFrame, [106, 115, 124], [1, 1.025, 1], Easing.inOut(Easing.sin));
  return <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
    <Img src={staticFile(`textures/live/${current.src}`)} style={{ position: "absolute", left: frameGrow, top: frameGrow, width: 1920 - frameGrow * 2, height: 1080 - frameGrow * 2, objectFit: "cover", objectPosition: stage === 2 ? "50% 0%" : "50% 0%", borderRadius: 10, filter: stage === 2 ? "saturate(.82) blur(1.4px)" : "none" }} />
    {[{ left: 0, top: 0, right: 0, height: frameGrow }, { left: 0, bottom: 0, right: 0, height: frameGrow }, { left: 0, top: 0, bottom: 0, width: frameGrow }, { right: 0, top: 0, bottom: 0, width: frameGrow }].map((style, index) => <div key={index} style={{ position: "absolute", background: current.color, ...style }} />)}
    <div style={{ position: "absolute", left: 68, top: 61, padding: "14px 20px", borderRadius: 999, background: current.color, color: "white", font: `800 23px ${MONO}`, letterSpacing: ".1em" }}>{current.no} · {current.name} · {current.role}</div>
    {stage === 0 ? <div style={{ position: "absolute", left: 92, bottom: 72, padding: "26px 31px", borderRadius: 22, background: "rgba(255,250,243,.95)", border: `1px solid ${LINE}`, boxShadow: "0 24px 68px rgba(45,32,22,.15)" }}><Kicker>V2.3 · ONE WORKBENCH</Kicker><div style={{ marginTop: 13, font: `600 55px ${SERIF}` }}>三个阶段，围绕同一条灵感主线</div></div> : null}
    {stage === 1 ? <>
      <div style={{ position: "absolute", left: 88, top: 176, width: 610, padding: "34px 38px", borderRadius: 25, background: "rgba(255,250,243,.96)", border: `2px solid ${PURPLE}66`, boxShadow: "0 24px 74px rgba(45,32,22,.14)", opacity: relationshipIn, transform: `translateX(${(1 - relationshipIn) * -50}px)` }}>
        <Kicker color={PURPLE}>LOCAL EVIDENCE MAP</Kicker>
        <div style={{ marginTop: 18, font: `600 58px/1.08 ${SERIF}` }}>把收藏整理成<br />看得见的关系</div>
        <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 11 }}>
          {tags.map((tag, index) => {
            const t = clamp(frame, [118 + index * 15, 130 + index * 15], [0, 1], Easing.out(Easing.cubic));
            return <span key={tag} style={{ padding: "11px 17px", borderRadius: 999, background: index === 3 ? PURPLE : "#eee7df", color: index === 3 ? "white" : INK, opacity: t, transform: `translateY(${(1 - t) * 12}px)`, font: `700 32px ${SANS}` }}>{tag}</span>;
          })}
        </div>
      </div>
    </> : null}
    {stage === 2 ? <>
      <AbsoluteFill style={{ background: "rgba(246,240,231,.9)" }} />
      <div style={{ position: "absolute", left: 88, top: 178, width: 720 }}>
        <Kicker color={GREEN}>03 · BRAINSTORM WITH SOURCES</Kicker>
        <div style={{ marginTop: 18, font: `600 62px/1.08 ${SERIF}`, letterSpacing: "-.04em" }}>从已有来源，<br />长出方案与验证步骤</div>
        <div style={{ marginTop: 31, color: MUTED, font: `600 38px/1.5 ${SANS}` }}>结论保留出处；证据不足时明确缺口，最终判断始终交给用户。</div>
      </div>
      <div style={{ position: "absolute", left: 980, top: 125, width: 840, height: 82, borderRadius: 41, border: `3px solid ${GREEN}`, background: PAPER_2, padding: "0 30px", display: "flex", alignItems: "center", boxSizing: "border-box", font: `700 36px ${SANS}`, boxShadow: "0 14px 42px rgba(45,32,22,.1)" }}>{prompt.slice(0, typed)}<span style={{ color: GREEN, opacity: Math.floor(treeFrame / 5) % 2 === 0 ? 1 : 0 }}>▌</span></div>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${breathe})`, transformOrigin: "1440px 650px" }}>
        <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
          {nodes.filter((node) => node.parent >= 0).map((node) => {
            const parent = nodes[node.parent];
            const start = node.cue - 8;
            const grow = clamp(treeFrame, [start, start + 16], [0, 1], Easing.out(Easing.cubic));
            const middle = (parent.y + node.y) / 2;
            const path = `M ${parent.x} ${parent.y + 54} L ${parent.x} ${middle} L ${node.x} ${middle} L ${node.x} ${node.y - 54}`;
            return <path key={node.title} d={path} pathLength="1" stroke={GREEN} strokeWidth="4" fill="none" strokeDasharray="1" strokeDashoffset={1 - grow} strokeLinejoin="round" />;
          })}
        </svg>
        {nodes.map((node, index) => {
          if (treeFrame < node.cue) return null;
          const pop = safeSpring(treeFrame - node.cue, fps, { damping: 12, stiffness: 165 });
          return <div key={node.title} style={{ position: "absolute", left: node.x - 132, top: node.y - 54, width: 264, height: 108, borderRadius: 18, background: index === 0 ? GREEN : PAPER_2, color: index === 0 ? "white" : INK, border: `2px solid ${GREEN}`, boxShadow: "0 16px 42px rgba(45,32,22,.13)", display: "grid", placeItems: "center", transform: `scale(${pop})`, font: `600 36px ${SERIF}` }}>{node.title}</div>;
        })}
      </div>
    </> : null}
    {switchFlash > 0 ? <AbsoluteFill style={{ background: "white", opacity: switchFlash }} /> : null}
  </AbsoluteFill>;
};

const V23CollectScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const page = safeSpring(frame - 18, fps, { damping: 18, stiffness: 96 });
  const details = [
    ["01", "统一入口", "链接、文字和文件先进入同一工作台"],
    ["02", "来源可见", "域名、标签与归档状态随条目保留"],
    ["03", "进入研究", "从收藏直接打开详情与研究笔记"],
  ];
  return <PaperField>
    <VisibleEvidence>灵感来袭：负责收集与进入研究</VisibleEvidence>
    <div style={{ position: "absolute", left: 86, top: 132, width: 500 }}>
      <Kicker>V2.3 · 01 COLLECT</Kicker>
      <div style={{ marginTop: 22, font: `600 76px/1.06 ${SERIF}`, letterSpacing: "-.045em" }}>先把灵感<br />稳稳接住</div>
      <div style={{ marginTop: 30, color: MUTED, font: `600 36px/1.5 ${SANS}` }}>当前画面只讲收集：新增内容进入看板，并保留来源与后续研究入口。</div>
    </div>
    <WindowFrame src="library-full.png" x={620} y={150} width={1210} height={680} borderColor={`${ACCENT}88`} objectPosition="50% 0%" opacity={page} transform={`translateY(${(1 - page) * 54}px) scale(${.95 + page * .05})`} />
    <div style={{ position: "absolute", left: 84, right: 84, bottom: 62, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
      {details.map(([no, title, body], index) => {
        const cue = 82 + index * 44;
        const t = clamp(frame, [cue, cue + 24], [0, 1], Easing.out(Easing.cubic));
        return <div key={no} style={{ minHeight: 150, padding: "24px 28px", borderRadius: 22, background: PAPER_2, border: `1px solid ${LINE}`, boxShadow: "0 18px 52px rgba(45,32,22,.1)", opacity: t, transform: `translateY(${(1 - t) * 24}px)` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}><b style={{ color: ACCENT, font: `800 22px ${MONO}` }}>{no}</b><span style={{ font: `600 39px ${SERIF}` }}>{title}</span></div>
          <div style={{ marginTop: 14, color: MUTED, font: `600 30px/1.42 ${SANS}` }}>{body}</div>
        </div>;
      })}
    </div>
  </PaperField>;
};

const V23RelationshipScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const page = safeSpring(frame - 18, fps, { damping: 18, stiffness: 96 });
  const tags = ["主题分区", "来源筛选", "节点拖拽", "反向链接"];
  const flow = ["收藏", "主题", "关系", "回到来源"];
  return <PaperField>
    <VisibleEvidence color={PURPLE}>关系画布：负责整理来源与关联</VisibleEvidence>
    <div style={{ position: "absolute", left: 86, top: 132, width: 510 }}>
      <Kicker color={PURPLE}>V2.3 · 02 CONNECT</Kicker>
      <div style={{ marginTop: 22, font: `600 72px/1.07 ${SERIF}`, letterSpacing: "-.045em" }}>把收藏整理成<br />看得见的关系</div>
      <div style={{ marginTop: 30, color: MUTED, font: `600 36px/1.5 ${SANS}` }}>当前画面只讲整理：节点可以按主题组织，也能沿关系回到原始来源。</div>
      <div style={{ marginTop: 34, display: "flex", flexWrap: "wrap", gap: 12 }}>
        {tags.map((tag, index) => {
          const t = clamp(frame, [72 + index * 22, 92 + index * 22], [0, 1], Easing.out(Easing.cubic));
          return <span key={tag} style={{ padding: "11px 17px", borderRadius: 999, background: index === 3 ? PURPLE : "#eee7df", color: index === 3 ? "white" : INK, opacity: t, transform: `translateY(${(1 - t) * 12}px)`, font: `700 32px ${SANS}` }}>{tag}</span>;
        })}
      </div>
    </div>
    <WindowFrame src="relationship-full.png" x={630} y={150} width={1200} height={675} borderColor={`${PURPLE}88`} objectPosition="50% 0%" opacity={page} transform={`translateY(${(1 - page) * 50}px) scale(${.95 + page * .05})`} />
    <div style={{ position: "absolute", left: 260, right: 260, bottom: 70, height: 112, borderRadius: 24, background: PAPER_2, border: `1px solid ${PURPLE}55`, display: "grid", gridTemplateColumns: "repeat(7, auto)", alignItems: "center", justifyContent: "center", gap: 22, boxShadow: "0 20px 58px rgba(45,32,22,.11)" }}>
      {flow.flatMap((item, index) => {
        const t = clamp(frame, [150 + index * 30, 170 + index * 30], [0, 1], Easing.out(Easing.cubic));
        const parts: React.ReactNode[] = [<span key={item} style={{ color: index === 3 ? PURPLE : INK, opacity: t, font: `600 36px ${SERIF}` }}>{item}</span>];
        if (index < flow.length - 1) parts.push(<span key={`${item}-arrow`} style={{ color: PURPLE, opacity: t, font: `700 32px ${MONO}` }}>→</span>);
        return parts;
      })}
    </div>
  </PaperField>;
};

const V23BrainstormScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const prompt = "从真实来源形成可验证方案";
  const typed = Math.min(prompt.length, Math.max(0, Math.floor((frame - 34) * .34)));
  const nodes = [
    { x: 1405, y: 380, cue: 82, title: "融合目标", parent: -1 },
    { x: 1185, y: 610, cue: 116, title: "来源依据", parent: 0 },
    { x: 1625, y: 610, cue: 128, title: "组合判断", parent: 0 },
    { x: 1125, y: 825, cue: 168, title: "最小验证", parent: 1 },
    { x: 1450, y: 825, cue: 184, title: "失败边界", parent: 1 },
    { x: 1740, y: 825, cue: 200, title: "下一步", parent: 2 },
  ];
  const breathe = clamp(frame, [226, 246, 270], [1, 1.018, 1], Easing.inOut(Easing.sin));
  return <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
    <Img src={staticFile("textures/live/brainstorm-full.png")} style={{ width: 1920, height: 1080, objectFit: "cover", objectPosition: "50% 0%", filter: "saturate(.72) blur(1.5px)", transform: "scale(1.012)" }} />
    <AbsoluteFill style={{ background: "rgba(246,240,231,.91)" }} />
    <VisibleEvidence color={GREEN}>头脑风暴：基于来源形成下一步</VisibleEvidence>
    <div style={{ position: "absolute", left: 86, top: 164, width: 720 }}>
      <Kicker color={GREEN}>V2.3 · 03 DECIDE WITH SOURCES</Kicker>
      <div style={{ marginTop: 22, font: `600 68px/1.07 ${SERIF}`, letterSpacing: "-.045em" }}>从已有来源，<br />长出方案与验证步骤</div>
      <div style={{ marginTop: 32, color: MUTED, font: `600 37px/1.5 ${SANS}` }}>当前画面只讲融合决策：结论保留出处，证据不足时明确缺口。</div>
      <div style={{ marginTop: 42, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {["来源仍可追溯", "最终判断交给用户"].map((item, index) => <div key={item} style={{ padding: "18px 20px", borderRadius: 17, background: PAPER_2, border: `1px solid ${GREEN}55`, opacity: clamp(frame, [62 + index * 22, 82 + index * 22], [0, 1]), font: `700 31px ${SANS}` }}>{item}</div>)}
      </div>
    </div>
    <div style={{ position: "absolute", left: 968, top: 128, width: 850, height: 84, borderRadius: 42, border: `3px solid ${GREEN}`, background: PAPER_2, padding: "0 30px", display: "flex", alignItems: "center", boxSizing: "border-box", font: `700 36px ${SANS}`, boxShadow: "0 14px 42px rgba(45,32,22,.1)" }}>{prompt.slice(0, typed)}<span style={{ color: GREEN, opacity: Math.floor(frame / 6) % 2 === 0 ? 1 : 0 }}>▌</span></div>
    <div style={{ position: "absolute", inset: 0, transform: `scale(${breathe})`, transformOrigin: "1440px 650px" }}>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        {nodes.filter((node) => node.parent >= 0).map((node) => {
          const parent = nodes[node.parent];
          const start = node.cue - 14;
          const grow = clamp(frame, [start, start + 24], [0, 1], Easing.out(Easing.cubic));
          const middle = (parent.y + node.y) / 2;
          const path = `M ${parent.x} ${parent.y + 54} L ${parent.x} ${middle} L ${node.x} ${middle} L ${node.x} ${node.y - 54}`;
          return <path key={node.title} d={path} pathLength="1" stroke={GREEN} strokeWidth="4" fill="none" strokeDasharray="1" strokeDashoffset={1 - grow} strokeLinejoin="round" />;
        })}
      </svg>
      {nodes.map((node, index) => {
        if (frame < node.cue) return null;
        const pop = safeSpring(frame - node.cue, fps, { damping: 15, stiffness: 125 });
        return <div key={node.title} style={{ position: "absolute", left: node.x - 132, top: node.y - 54, width: 264, height: 108, borderRadius: 18, background: index === 0 ? GREEN : PAPER_2, color: index === 0 ? "white" : INK, border: `2px solid ${GREEN}`, boxShadow: "0 16px 42px rgba(45,32,22,.13)", display: "grid", placeItems: "center", transform: `scale(${pop})`, font: `600 36px ${SERIF}` }}>{node.title}</div>;
      })}
    </div>
  </AbsoluteFill>;
};

const CAPABILITY_ITEMS = [
  { word: "被收下", sub: "链接先落盘", src: "v1-board.png", color: ACCENT, position: "50% 0%" },
  { word: "留得住", sub: "正文与页面主动归档", src: "entry-full.png", color: "#d18a3d", position: "50% 0%" },
  { word: "连起来", sub: "关系可视、来源可追溯", src: "relationship-desktop-final.png", color: PURPLE, position: "50% 0%" },
  { word: "变成行动", sub: "方案有依据，步骤可验证", src: "ui-polish-brainstorm.png", color: GREEN, position: "50% 0%" },
];

const CapabilitiesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const cardW = 880;
  const cardH = 510;
  const gap = 90;
  const step = cardH + gap;
  const switches = CAPABILITY_SWITCHES;
  const switchDuration = 16;
  let stepProgress = 0;
  switches.slice(1).forEach((start) => {
    const p = clamp(frame, [start, start + switchDuration], [0, 1]);
    stepProgress += p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  });
  const scroll = stepProgress * step;
  const smooth = (value: number) => value * value * (3 - 2 * value);
  const wordStyle: React.CSSProperties = { fontFamily: SERIF, fontWeight: 600, fontSize: 104, lineHeight: 1.05, letterSpacing: "-.04em", textAlign: "right", whiteSpace: "nowrap" };
  return <PaperField>
    <VisibleEvidence color={GREEN}>四张真实页面，对应四个长期结果</VisibleEvidence>
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 1040, background: "#ece3d7", overflow: "hidden", borderRight: `1px solid ${LINE}` }}>
      {[-1, 0, 1].flatMap((repeat) => CAPABILITY_ITEMS.map((item, index) => {
        const y = 285 + index * step + repeat * CAPABILITY_ITEMS.length * step - scroll;
        if (y > 1130 || y < -cardH - 60) return null;
        const darkCard = index % 2 === 1;
        return <div key={`${repeat}-${item.word}`} style={{ position: "absolute", left: 80, top: y, width: cardW, height: cardH, borderRadius: 28, overflow: "hidden", border: `8px solid ${darkCard ? INK : PAPER_2}`, boxShadow: "0 28px 82px rgba(45,32,22,.22)", background: darkCard ? INK : PAPER_2 }}>
          <Img src={staticFile(`textures/live/${item.src}`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: item.position, filter: darkCard ? "saturate(.62) brightness(.52) contrast(1.18)" : "saturate(.92)" }} />
          <div style={{ position: "absolute", left: 20, bottom: 20, padding: "10px 15px", borderRadius: 999, background: item.color, color: "white", font: `800 19px ${MONO}`, letterSpacing: ".12em" }}>{`0${index + 1}`}</div>
        </div>;
      }))}
    </div>
    <div style={{ position: "absolute", right: 94, top: 315, width: 730, height: 450 }}>
      <Kicker>ONE WORKBENCH · FOUR LASTING OUTCOMES</Kicker>
      <div style={{ ...wordStyle, marginTop: 48, color: INK, fontSize: 75 }}>让每一条灵感</div>
      <div style={{ position: "relative", height: 135, marginTop: 6 }}>
        {CAPABILITY_ITEMS.map((item, index) => {
          const start = switches[index];
          const end = index + 1 < switches.length ? switches[index + 1] : null;
          const inProgress = index === 0
            ? clamp(frame, [start, start + 12], [0, 1])
            : clamp(frame, [start + 7, start + switchDuration], [0, 1]);
          const grey = end ? clamp(frame, [end - 14, end - 2], [0, 1]) : 0;
          const outProgress = end ? clamp(frame, [end, end + 8], [1, 0]) : 1;
          const opacity = smooth(inProgress) * smooth(outProgress);
          if (opacity <= 0) return null;
          const color = grey > 0 ? MUTED : item.color;
          return <div key={item.word} style={{ ...wordStyle, position: "absolute", right: 0, top: 0, color, opacity }}>
            {item.word}
            <div style={{ marginTop: 21, color: MUTED, font: `600 34px ${SANS}`, letterSpacing: 0 }}>{item.sub}</div>
          </div>;
        })}
      </div>
      <div style={{ marginTop: 92, color: MUTED, font: `600 38px/1.52 ${SANS}` }}>数据默认保存在本机；没有账号、订阅或外部 AI，核心流程仍然完整可用。</div>
    </div>
  </PaperField>;
};

const BrandBloom: React.FC<{ size: number; bloom: number }> = ({ size, bloom }) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100">
    {Array.from({ length: 4 }).map((_, index) => {
      const finalAngle = index * 90;
      const angle = interpolate(bloom, [0, 1], [-90, finalAngle]);
      const length = interpolate(bloom, [0, 1], [18, 42]);
      const width = interpolate(bloom, [0, 1], [3, 14]);
      return <ellipse key={index} cx="0" cy={-length / 2} rx={width / 2} ry={length / 2} fill={ACCENT} opacity=".95" transform={`rotate(${angle + 90})`} />;
    })}
    <circle r={interpolate(bloom, [0, 1], [2, 8])} fill={INK} />
  </svg>
);

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pages = [
    { src: "library-full.png", x: 95, y: 112, rotate: -5, color: ACCENT },
    { src: "relationship-full.png", x: 650, y: 70, rotate: 1, color: PURPLE },
    { src: "brainstorm-full.png", x: 1205, y: 122, rotate: 5, color: GREEN },
  ];
  const recede = clamp(frame, [0, 46], [1, .5], Easing.out(Easing.cubic));
  const pagesOut = clamp(frame, [22, 62], [1, 0], Easing.out(Easing.cubic));
  const wobble = clamp(frame, [14, 20, 27, 34, 40], [0, -12, 14, -18, 0], Easing.inOut(Easing.sin));
  const flip = clamp(frame, [40, 54], [0, 1], Easing.in(Easing.cubic));
  const iconScaleX = clamp(flip, [0, 1], [1, .04]);
  const bloom = frame < 54 ? 0 : safeSpring(frame - 54, fps, { damping: 11, stiffness: 130 });
  const markScaleX = clamp(bloom, [0, 1], [.04, 1]);
  const shift = clamp(frame, [68, 93], [0, 1], Easing.out(Easing.cubic));
  const markX = clamp(shift, [0, 1], [0, -330]);
  const word = "灵感工作台";
  const meta = clamp(frame, [118, 140], [0, 1], Easing.out(Easing.cubic));
  const journey = clamp(frame, [143, 162], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <div style={{ position: "absolute", inset: 0, transform: `scale(${recede})`, transformOrigin: "50% 40%", opacity: pagesOut }}>
      {pages.map((page) => <WindowFrame key={page.src} src={page.src} x={page.x} y={page.y} width={720} height={470} borderColor={page.color} transform={`rotate(${page.rotate}deg)`} />)}
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 310, height: 360 }}>
      <div style={{ position: "absolute", left: 960 + markX, top: 180, transform: "translate(-50%, -50%)" }}>
        {frame < 54 ? <div style={{ transform: `rotate(${wobble}deg) scaleX(${iconScaleX})`, transformOrigin: "center 78%", filter: flip > .3 ? `blur(${flip * 5}px)` : "none" }}><AppSpark size={270} /></div> : <div style={{ transform: `scaleX(${markScaleX})` }}><BrandBloom size={270} bloom={bloom} /></div>}
      </div>
      <div style={{ position: "absolute", left: 960 + markX + 165, top: 180, transform: "translateY(-50%)", display: "flex", alignItems: "center", color: INK, font: `600 104px ${SERIF}`, letterSpacing: "-.055em" }}>
        {word.split("").map((char, index) => {
          const t = clamp(frame, [74 + index * 5, 88 + index * 5], [0, 1], Easing.out(Easing.cubic));
          return <span key={char} style={{ display: "inline-block", opacity: t, transform: `scale(${1.35 - .35 * t})`, filter: `blur(${(1 - t) * 10}px)`, transformOrigin: "center bottom" }}>{char}</span>;
        })}
      </div>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 650, textAlign: "center", opacity: meta, transform: `translateY(${(1 - meta) * 18}px)` }}>
      <div style={{ color: ACCENT, font: `800 32px ${MONO}`, letterSpacing: ".16em" }}>V2.3 · WINDOWS DESKTOP · LOCAL DATA</div>
      <div style={{ marginTop: 22, font: `600 48px ${SANS}` }}>无需账号 · 核心功能无需 API Key · 数据默认留在本机</div>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 78, textAlign: "center", opacity: journey }}>
      <div style={{ color: MUTED, font: `700 32px ${MONO}`, letterSpacing: ".12em" }}>发现 → 保存 → 主动留存 → 研究 → 关联 → 验证</div>
      <div style={{ marginTop: 23, font: `600 56px ${SERIF}` }}>收藏不失效，思考有下文。</div>
    </div>
  </PaperField>;
};

const FinaleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const pages = [
    { src: "library-full.png", x: 100, y: 126, rotate: -4, color: ACCENT },
    { src: "relationship-full.png", x: 650, y: 82, rotate: 0, color: PURPLE },
    { src: "brainstorm-full.png", x: 1200, y: 126, rotate: 4, color: GREEN },
  ];
  const recede = clamp(frame, [0, 44], [1, .54], Easing.out(Easing.cubic));
  const pagesOut = clamp(frame, [30, 62], [1, 0], Easing.out(Easing.cubic));
  const titleIn = clamp(frame, [58, 84], [0, 1], Easing.out(Easing.cubic));
  const rule = clamp(frame, [76, 98], [0, 1], Easing.out(Easing.cubic));
  const meta = clamp(frame, [98, 120], [0, 1], Easing.out(Easing.cubic));
  const journey = clamp(frame, [120, 144], [0, 1], Easing.out(Easing.cubic));
  return <PaperField>
    <div style={{ position: "absolute", inset: 0, transform: `scale(${recede})`, transformOrigin: "50% 40%", opacity: pagesOut }}>
      {pages.map((page) => <WindowFrame key={page.src} src={page.src} x={page.x} y={page.y} width={720} height={470} borderColor={page.color} transform={`rotate(${page.rotate}deg)`} />)}
    </div>
    <div style={{ position: "absolute", left: 140, right: 140, top: 218, textAlign: "center", opacity: titleIn, transform: `translateY(${(1 - titleIn) * 36}px)` }}>
      <Kicker>VERSION 2.3 · WINDOWS DESKTOP · LOCAL DATA</Kicker>
      <div style={{ marginTop: 40, color: INK, font: `600 126px/.98 ${SERIF}`, letterSpacing: "-.06em" }}>灵感工作台</div>
      <div style={{ margin: "46px auto 0", width: 520 * rule, height: 5, borderRadius: 3, background: ACCENT }} />
    </div>
    <div style={{ position: "absolute", left: 150, right: 150, top: 585, textAlign: "center", opacity: meta, transform: `translateY(${(1 - meta) * 18}px)` }}>
      <div style={{ font: `600 46px ${SANS}` }}>无需账号 · 核心功能无需 API Key · 数据默认留在本机</div>
      <div style={{ marginTop: 34, color: MUTED, font: `700 30px ${MONO}`, letterSpacing: ".1em" }}>发现 → 保存 → 主动留存 → 研究 → 关联 → 验证 → 回顾</div>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 88, textAlign: "center", opacity: journey, transform: `translateY(${(1 - journey) * 20}px)` }}>
      <div style={{ font: `600 58px ${SERIF}` }}>让收藏不只留下地址，让思考真正有下文。</div>
    </div>
  </PaperField>;
};

type TransitionMode = "accent" | "paper" | "dark" | "purple" | "green" | "film";

const CutTransition: React.FC<{ mode: TransitionMode }> = ({ mode }) => {
  const frame = useCurrentFrame();
  const progress = clamp(frame, [0, 10, 22], [0, 1, 0], Easing.inOut(Easing.cubic));
  if (mode === "film") return <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
    {Array.from({ length: 8 }).map((_, index) => <div key={index} style={{ position: "absolute", left: `${index * 12.5}%`, top: 0, bottom: 0, width: "12.7%", background: index % 2 ? INK : PAPER_2, transform: `scaleX(${progress})`, transformOrigin: index % 2 ? "right" : "left", opacity: .86 }} />)}
  </AbsoluteFill>;
  const color = mode === "accent" ? ACCENT : mode === "dark" ? INK : mode === "purple" ? PURPLE : mode === "green" ? GREEN : PAPER_2;
  return <AbsoluteFill style={{ pointerEvents: "none", background: color, opacity: progress * (mode === "paper" ? .82 : .9), transform: mode === "accent" || mode === "purple" || mode === "green" ? `scaleX(${progress})` : undefined, transformOrigin: "left center" }} />;
};

const TRANSITIONS: { frame: number; mode: TransitionMode }[] = [
  { frame: SHOTS.decay.from, mode: "accent" },
  { frame: SHOTS.timeline.from, mode: "paper" },
  { frame: SHOTS.v1.from, mode: "accent" },
  { frame: SHOTS.v2.from, mode: "green" },
  { frame: SHOTS.capture.from, mode: "paper" },
  { frame: SHOTS.v21.from, mode: "accent" },
  { frame: SHOTS.parser.from, mode: "paper" },
  { frame: SHOTS.v22.from, mode: "dark" },
  { frame: SHOTS.collect.from, mode: "paper" },
  { frame: SHOTS.relationship.from, mode: "purple" },
  { frame: SHOTS.brainstorm.from, mode: "green" },
  { frame: SHOTS.capabilities.from, mode: "paper" },
  { frame: SHOTS.outro.from, mode: "paper" },
];

const SFX = [
  { from: beatF(0), src: "audio/transition-soft.mp3", volume: .24, duration: 40 },
  { from: beatF(8), src: "audio/whoosh-fast.mp3", volume: .28, duration: 52 },
  { from: beatF(11), src: "audio/click-camera.mp3", volume: .22, duration: 10 },
  { from: beatF(14), src: "audio/click-camera.mp3", volume: .24, duration: 10 },
  { from: beatF(17), src: "audio/click-camera.mp3", volume: .26, duration: 10 },
  { from: beatF(20), src: "audio/click-camera.mp3", volume: .28, duration: 10 },
  { from: beatF(22), src: "audio/impact-deep-whoosh.mp3", volume: .38, duration: 70 },
  { from: beatF(24), src: "audio/transition-soft.mp3", volume: .24, duration: 42 },
  { from: beatF(40), src: "audio/air-woosh-deep.mp3", volume: .27, duration: 58 },
  { from: SHOTS.v2.from + V2_FLIP_FRAME, src: "audio/impact-deep-whoosh.mp3", volume: .4, duration: 72 },
  { from: beatF(58), src: "audio/click-camera.mp3", volume: .44, duration: 12 },
  { from: beatF(60), src: "audio/air-woosh-deep.mp3", volume: .26, duration: 56 },
  { from: SHOTS.v22.from + V22_STEP_CUES[0], src: "audio/click-camera.mp3", volume: .22, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[1], src: "audio/click-camera.mp3", volume: .24, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[2], src: "audio/click-camera.mp3", volume: .26, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[3], src: "audio/click-camera.mp3", volume: .28, duration: 10 },
  { from: beatF(88), src: "audio/transition-soft.mp3", volume: .28, duration: 45 },
  { from: beatF(93), src: "audio/swoosh-quick.mp3", volume: .24, duration: 26 },
  { from: SHOTS.brainstorm.from + V23_BRAINSTORM_FRAME, src: "audio/whoosh-fast.mp3", volume: .27, duration: 50 },
  { from: SHOTS.brainstorm.from + V23_BRAINSTORM_FRAME + 4, src: "audio/typewriter-digital.mp3", volume: .18, duration: 24 },
  { from: beatF(112), src: "audio/air-whoosh-powerful.mp3", volume: .27, duration: 66 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[0], src: "audio/click-camera.mp3", volume: .23, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[1], src: "audio/click-camera.mp3", volume: .25, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[2], src: "audio/click-camera.mp3", volume: .27, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[3], src: "audio/click-camera.mp3", volume: .29, duration: 10 },
  { from: beatF(132), src: "audio/air-whoosh-powerful.mp3", volume: .34, duration: 88 },
  { from: beatF(139), src: "audio/impact-deep-whoosh.mp3", volume: .48, duration: 82 },
  { from: beatF(141), src: "audio/sparkle-wand.mp3", volume: .3, duration: 84 },
] as const;

const SFX_EXPANDED = [
  { from: beatF(0), src: "audio/transition-soft.mp3", volume: .24, duration: 40 },
  { from: beatF(8), src: "audio/glitch-static-electric.mp3", volume: .22, duration: 36 },
  { from: SHOTS.decay.from + 58, src: "audio/paper-staple.mp3", volume: .2, duration: 24 },
  { from: SHOTS.decay.from + 90, src: "audio/paper-staple.mp3", volume: .18, duration: 24 },
  { from: SHOTS.decay.from + 122, src: "audio/paper-staple.mp3", volume: .16, duration: 24 },
  { from: beatF(16), src: "audio/impact-deep-whoosh.mp3", volume: .34, duration: 66 },
  { from: beatF(18), src: "audio/whoosh-fast.mp3", volume: .28, duration: 52 },
  { from: beatF(20), src: "audio/click-camera.mp3", volume: .18, duration: 10 },
  { from: beatF(22), src: "audio/click-camera.mp3", volume: .2, duration: 10 },
  { from: beatF(24), src: "audio/click-camera.mp3", volume: .22, duration: 10 },
  { from: beatF(26), src: "audio/click-camera.mp3", volume: .3, duration: 10 },
  { from: beatF(28), src: "audio/click-camera.mp3", volume: .24, duration: 10 },
  { from: beatF(30), src: "audio/transition-soft.mp3", volume: .24, duration: 42 },
  { from: beatF(42), src: "audio/air-woosh-deep.mp3", volume: .25, duration: 58 },
  { from: beatF(46), src: "audio/impact-deep-whoosh.mp3", volume: .42, duration: 72 },
  { from: beatF(54), src: "audio/paper-slide.mp3", volume: .24, duration: 58 },
  { from: beatF(56), src: "audio/click-camera.mp3", volume: .18, duration: 10 },
  { from: beatF(59), src: "audio/click-camera.mp3", volume: .2, duration: 10 },
  { from: beatF(62), src: "audio/click-camera.mp3", volume: .24, duration: 10 },
  { from: beatF(64), src: "audio/impact-deep-whoosh.mp3", volume: .32, duration: 62 },
  { from: beatF(66), src: "audio/transition-soft.mp3", volume: .24, duration: 42 },
  { from: SHOTS.v21.from + V21_ROW_CUES[0], src: "audio/click-camera.mp3", volume: .18, duration: 10 },
  { from: SHOTS.v21.from + V21_ROW_CUES[1], src: "audio/click-camera.mp3", volume: .2, duration: 10 },
  { from: SHOTS.v21.from + V21_ROW_CUES[2], src: "audio/click-camera.mp3", volume: .22, duration: 10 },
  { from: SHOTS.v21.from + V21_ROW_CUES[3], src: "audio/click-camera.mp3", volume: .24, duration: 10 },
  { from: beatF(78), src: "audio/data-scan.mp3", volume: .22, duration: 72 },
  { from: SHOTS.parser.from + 36, src: "audio/click-camera.mp3", volume: .17, duration: 10 },
  { from: SHOTS.parser.from + 68, src: "audio/click-camera.mp3", volume: .19, duration: 10 },
  { from: SHOTS.parser.from + 100, src: "audio/click-camera.mp3", volume: .21, duration: 10 },
  { from: SHOTS.parser.from + 124, src: "audio/whoosh-fast.mp3", volume: .22, duration: 44 },
  { from: beatF(90), src: "audio/air-woosh-deep.mp3", volume: .26, duration: 58 },
  { from: SHOTS.v22.from + V22_STEP_CUES[0], src: "audio/click-camera.mp3", volume: .2, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[1], src: "audio/click-camera.mp3", volume: .22, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[2], src: "audio/click-camera.mp3", volume: .24, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[3], src: "audio/click-camera.mp3", volume: .26, duration: 10 },
  { from: beatF(102), src: "audio/transition-soft.mp3", volume: .28, duration: 45 },
  { from: beatF(106), src: "audio/swoosh-quick.mp3", volume: .26, duration: 28 },
  { from: beatF(110), src: "audio/whoosh-fast.mp3", volume: .3, duration: 52 },
  { from: beatF(110) + 4, src: "audio/typewriter-digital.mp3", volume: .18, duration: 24 },
  { from: beatF(116), src: "audio/air-whoosh-powerful.mp3", volume: .28, duration: 66 },
  { from: beatF(118), src: "audio/air-woosh-deep.mp3", volume: .24, duration: 54 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[0], src: "audio/click-camera.mp3", volume: .2, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[1], src: "audio/click-camera.mp3", volume: .22, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[2], src: "audio/click-camera.mp3", volume: .24, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[3], src: "audio/click-camera.mp3", volume: .26, duration: 10 },
  { from: beatF(128), src: "audio/air-whoosh-powerful.mp3", volume: .34, duration: 88 },
  { from: beatF(132), src: "audio/impact-deep-whoosh.mp3", volume: .46, duration: 82 },
  { from: beatF(134), src: "audio/sparkle-wand.mp3", volume: .28, duration: 64 },
] as const;

const SFX_CALM = [
  { from: beatF(0), src: "audio/transition-soft.mp3", volume: .2, duration: 44 },
  { from: beatF(10), src: "audio/glitch-static-electric.mp3", volume: .16, duration: 34 },
  { from: SHOTS.decay.from + 58, src: "audio/paper-staple.mp3", volume: .17, duration: 24 },
  { from: SHOTS.decay.from + 104, src: "audio/paper-staple.mp3", volume: .15, duration: 24 },
  { from: SHOTS.decay.from + 150, src: "audio/paper-staple.mp3", volume: .14, duration: 24 },
  { from: beatF(20), src: "audio/impact-deep-whoosh.mp3", volume: .3, duration: 66 },
  { from: beatF(22), src: "audio/whoosh-fast.mp3", volume: .22, duration: 52 },
  { from: beatF(24), src: "audio/click-camera.mp3", volume: .15, duration: 10 },
  { from: beatF(26), src: "audio/click-camera.mp3", volume: .17, duration: 10 },
  { from: beatF(28), src: "audio/click-camera.mp3", volume: .19, duration: 10 },
  { from: beatF(30), src: "audio/click-camera.mp3", volume: .21, duration: 10 },
  { from: beatF(32), src: "audio/click-camera.mp3", volume: .23, duration: 10 },
  { from: beatF(34), src: "audio/transition-soft.mp3", volume: .2, duration: 44 },
  { from: beatF(46), src: "audio/air-woosh-deep.mp3", volume: .22, duration: 58 },
  { from: beatF(50), src: "audio/impact-deep-whoosh.mp3", volume: .36, duration: 72 },
  { from: beatF(58), src: "audio/paper-slide.mp3", volume: .2, duration: 58 },
  { from: beatF(60), src: "audio/click-camera.mp3", volume: .15, duration: 10 },
  { from: beatF(63), src: "audio/click-camera.mp3", volume: .17, duration: 10 },
  { from: beatF(66), src: "audio/click-camera.mp3", volume: .19, duration: 10 },
  { from: beatF(68), src: "audio/impact-deep-whoosh.mp3", volume: .26, duration: 62 },
  { from: beatF(70), src: "audio/transition-soft.mp3", volume: .2, duration: 44 },
  { from: SHOTS.v21.from + V21_ROW_CUES[0], src: "audio/click-camera.mp3", volume: .15, duration: 10 },
  { from: SHOTS.v21.from + V21_ROW_CUES[1], src: "audio/click-camera.mp3", volume: .17, duration: 10 },
  { from: SHOTS.v21.from + V21_ROW_CUES[2], src: "audio/click-camera.mp3", volume: .19, duration: 10 },
  { from: SHOTS.v21.from + V21_ROW_CUES[3], src: "audio/click-camera.mp3", volume: .21, duration: 10 },
  { from: beatF(82), src: "audio/data-scan.mp3", volume: .18, duration: 72 },
  { from: SHOTS.parser.from + 36, src: "audio/click-camera.mp3", volume: .14, duration: 10 },
  { from: SHOTS.parser.from + 68, src: "audio/click-camera.mp3", volume: .16, duration: 10 },
  { from: SHOTS.parser.from + 100, src: "audio/click-camera.mp3", volume: .18, duration: 10 },
  { from: SHOTS.parser.from + 124, src: "audio/whoosh-fast.mp3", volume: .19, duration: 44 },
  { from: beatF(94), src: "audio/air-woosh-deep.mp3", volume: .22, duration: 58 },
  { from: SHOTS.v22.from + V22_STEP_CUES[0], src: "audio/click-camera.mp3", volume: .16, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[1], src: "audio/click-camera.mp3", volume: .18, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[2], src: "audio/click-camera.mp3", volume: .2, duration: 10 },
  { from: SHOTS.v22.from + V22_STEP_CUES[3], src: "audio/click-camera.mp3", volume: .22, duration: 10 },
  { from: beatF(106), src: "audio/paper-slide.mp3", volume: .18, duration: 56 },
  { from: SHOTS.collect.from + 82, src: "audio/click-camera.mp3", volume: .14, duration: 10 },
  { from: SHOTS.collect.from + 126, src: "audio/click-camera.mp3", volume: .16, duration: 10 },
  { from: SHOTS.collect.from + 170, src: "audio/click-camera.mp3", volume: .18, duration: 10 },
  { from: beatF(118), src: "audio/air-woosh-deep.mp3", volume: .21, duration: 58 },
  { from: SHOTS.relationship.from + 150, src: "audio/click-camera.mp3", volume: .15, duration: 10 },
  { from: SHOTS.relationship.from + 180, src: "audio/click-camera.mp3", volume: .17, duration: 10 },
  { from: SHOTS.relationship.from + 210, src: "audio/click-camera.mp3", volume: .19, duration: 10 },
  { from: beatF(132), src: "audio/whoosh-fast.mp3", volume: .24, duration: 52 },
  { from: SHOTS.brainstorm.from + 34, src: "audio/typewriter-digital.mp3", volume: .15, duration: 58 },
  { from: SHOTS.brainstorm.from + 82, src: "audio/click-camera.mp3", volume: .15, duration: 10 },
  { from: SHOTS.brainstorm.from + 116, src: "audio/click-camera.mp3", volume: .17, duration: 10 },
  { from: SHOTS.brainstorm.from + 168, src: "audio/click-camera.mp3", volume: .19, duration: 10 },
  { from: beatF(148), src: "audio/air-whoosh-powerful.mp3", volume: .24, duration: 66 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[0], src: "audio/click-camera.mp3", volume: .16, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[1], src: "audio/click-camera.mp3", volume: .18, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[2], src: "audio/click-camera.mp3", volume: .2, duration: 10 },
  { from: SHOTS.capabilities.from + CAPABILITY_SWITCHES[3], src: "audio/click-camera.mp3", volume: .22, duration: 10 },
  { from: beatF(162), src: "audio/air-whoosh-powerful.mp3", volume: .28, duration: 88 },
  { from: beatF(166), src: "audio/impact-deep-whoosh.mp3", volume: .4, duration: 82 },
  { from: beatF(168), src: "audio/sparkle-wand.mp3", volume: .24, duration: 76 },
] as const;

type PromoProps = { bgm: boolean };

export const LingganProjectHistory: React.FC<PromoProps> = ({ bgm }) => (
  <AbsoluteFill style={{ background: PAPER, fontFamily: SANS }}>
    <Sequence from={SHOTS.open.from} durationInFrames={SHOTS.open.duration}><IntroScene /></Sequence>
    <Sequence from={SHOTS.decay.from} durationInFrames={SHOTS.decay.duration}><DecayScene /></Sequence>
    <Sequence from={SHOTS.timeline.from} durationInFrames={SHOTS.timeline.duration}><TimelineScene /></Sequence>
    <Sequence from={SHOTS.v1.from} durationInFrames={SHOTS.v1.duration}><V1Scene /></Sequence>
    <Sequence from={SHOTS.v2.from} durationInFrames={SHOTS.v2.duration}><V2Scene /></Sequence>
    <Sequence from={SHOTS.capture.from} durationInFrames={SHOTS.capture.duration}><CaptureFlowScene /></Sequence>
    <Sequence from={SHOTS.v21.from} durationInFrames={SHOTS.v21.duration}><V21Scene /></Sequence>
    <Sequence from={SHOTS.parser.from} durationInFrames={SHOTS.parser.duration}><ParserReliabilityScene /></Sequence>
    <Sequence from={SHOTS.v22.from} durationInFrames={SHOTS.v22.duration}><V22Scene /></Sequence>
    <Sequence from={SHOTS.collect.from} durationInFrames={SHOTS.collect.duration}><V23CollectScene /></Sequence>
    <Sequence from={SHOTS.relationship.from} durationInFrames={SHOTS.relationship.duration}><V23RelationshipScene /></Sequence>
    <Sequence from={SHOTS.brainstorm.from} durationInFrames={SHOTS.brainstorm.duration}><V23BrainstormScene /></Sequence>
    <Sequence from={SHOTS.capabilities.from} durationInFrames={SHOTS.capabilities.duration}><CapabilitiesScene /></Sequence>
    <Sequence from={SHOTS.outro.from} durationInFrames={SHOTS.outro.duration}><FinaleScene /></Sequence>
    {TRANSITIONS.map((transition) => <Sequence key={`${transition.frame}-${transition.mode}`} from={transition.frame - 10} durationInFrames={24}><CutTransition mode={transition.mode} /></Sequence>)}
    {bgm ? <>
      <Sequence from={0} durationInFrames={beatF(138)}><Audio src={staticFile("audio/bgm-expanded.mp3")} volume={(frame) => clamp(frame, [0, 30, beatF(134), beatF(138)], [0, .24, .24, 0])} /></Sequence>
      <Sequence from={BGM_SECOND_FROM} durationInFrames={TOTAL_FRAMES - BGM_SECOND_FROM}><Audio src={staticFile("audio/bgm-expanded.mp3")} trimBefore={beatF(6)} volume={(frame) => clamp(frame, [0, beatF(4), TOTAL_FRAMES - BGM_SECOND_FROM - 60, TOTAL_FRAMES - BGM_SECOND_FROM], [0, .24, .24, 0])} /></Sequence>
    </> : null}
    {SFX_CALM.map((item) => <Sequence key={`${item.from}-${item.src}`} from={item.from} durationInFrames={item.duration}><Audio src={staticFile(item.src)} volume={item.volume} /></Sequence>)}
  </AbsoluteFill>
);
