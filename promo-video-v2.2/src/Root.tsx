import React from "react";
import { Composition } from "remotion";
import { LingganV22 } from "./Main";

export const VideoRoot: React.FC = () => (
  <Composition
    id="LingganV22"
    component={LingganV22}
    durationInFrames={900}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ bgm: true }}
  />
);
