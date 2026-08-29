import React from "react";
import { Composition } from "remotion";
import { LingganV23Update } from "./Main";

export const VideoRoot: React.FC = () => (
  <Composition
    id="LingganV23Update"
    component={LingganV23Update}
    durationInFrames={900}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ bgm: true }}
  />
);
