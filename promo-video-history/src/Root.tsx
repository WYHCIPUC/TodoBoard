import React from "react";
import { Composition } from "remotion";
import { LingganProjectHistory, TOTAL_FRAMES } from "./Main";

export const VideoRoot: React.FC = () => (
  <Composition
    id="LingganProjectHistory"
    component={LingganProjectHistory}
    durationInFrames={TOTAL_FRAMES}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ bgm: true }}
  />
);
