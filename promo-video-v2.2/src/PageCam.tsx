import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from "remotion";

export type CamKey = {
  frame: number;
  cx: number;
  cy: number;
  zoom: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  persp?: number;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Copied from video-shotcraft's calibrated PageCam. CSS zoom keeps 2x page
// textures sharp under 2.5D transforms instead of GPU-upscaling a soft layer.
export const PageCam: React.FC<{
  src: string;
  pageH: number;
  keys: CamKey[];
  children?: React.ReactNode;
  blur?: number;
  saturate?: number;
  ease?: (t: number) => number;
}> = ({ src, pageH, keys, children, blur = 0, saturate = 1, ease = Easing.bezier(0.33, 0, 0.15, 1) }) => {
  const frame = useCurrentFrame();
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (frame >= keys[i].frame && frame <= keys[i + 1].frame) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const t = a.frame === b.frame ? 1 : interpolate(frame, [a.frame, b.frame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const cx = lerp(a.cx, b.cx, t);
  const cy = lerp(a.cy, b.cy, t);
  const zoom = lerp(a.zoom, b.zoom, t);
  const rotX = lerp(a.rotX ?? 0, b.rotX ?? 0, t);
  const rotY = lerp(a.rotY ?? 0, b.rotY ?? 0, t);
  const rotZ = lerp(a.rotZ ?? 0, b.rotZ ?? 0, t);
  const persp = lerp(a.persp ?? 1400, b.persp ?? 1400, t);
  const has3D = keys.some((key) => key.rotX !== undefined || key.rotY !== undefined || key.rotZ !== undefined);
  const filters = [`blur(${blur}px)`, `saturate(${saturate})`].join(" ");

  if (!has3D) {
    return (
      <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#f7f2eb" }}>
        <div style={{
          position: "absolute",
          width: 1920,
          height: pageH,
          transform: `translate(${960 - cx * zoom}px, ${540 - cy * zoom}px) scale(${zoom})`,
          transformOrigin: "0 0",
          filter: filters,
        }}>
          <Img src={staticFile(src)} style={{ position: "absolute", width: 1920, height: pageH }} />
          {children}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#f7f2eb" }}>
      <div style={{ position: "absolute", inset: 0, perspective: `${persp * zoom}px`, perspectiveOrigin: "960px 540px" }}>
        <div style={{
          position: "absolute",
          width: 1920,
          height: pageH,
          zoom,
          transform: `translate(${960 / zoom - cx}px, ${540 / zoom - cy}px) rotateY(${rotY}deg) rotateX(${rotX}deg) rotateZ(${rotZ}deg)`,
          transformOrigin: `${cx}px ${cy}px`,
          transformStyle: "preserve-3d",
          filter: filters,
        }}>
          <Img src={staticFile(src)} style={{ position: "absolute", width: 1920, height: pageH }} />
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};
