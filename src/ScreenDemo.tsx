import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { Background } from "./backgrounds/Background";
import { FloatingWindow, WINDOW_WIDTH, WINDOW_HEIGHT } from "./components/FloatingWindow";
import { SyntheticCursor } from "./components/SyntheticCursor";
import { CameraTransform } from "./components/CameraTransform";
import { SoundEffects } from "./components/SoundEffects";
import type { EditPlan, MomentsFile } from "./types";

const WIDTH = 1920;
const HEIGHT = 1080;

interface ScreenDemoProps {
  editPlan: EditPlan;
  moments: MomentsFile;
  videoFileName: string;
  showCursor?: boolean;
  showSfx?: boolean;
}

export const ScreenDemo: React.FC<ScreenDemoProps> = ({
  editPlan,
  moments,
  videoFileName,
  showCursor = true,
  showSfx = true,
}) => {
  const videoSrc = staticFile(videoFileName);

  return (
    <AbsoluteFill>
      <Background />

      <CameraTransform
        editPlan={editPlan}
        canvasWidth={WIDTH}
        canvasHeight={HEIGHT}
        viewportWidth={moments.metadata.viewportWidth}
        viewportHeight={moments.metadata.viewportHeight}
      >
        <FloatingWindow width={WIDTH} height={HEIGHT}>
          <OffthreadVideo
            src={videoSrc}
            startFrom={0}
            playbackRate={1}
            style={{
              width: WINDOW_WIDTH,
              height: WINDOW_HEIGHT,
              objectFit: "cover",
            }}
          />
          {showCursor && (
            <SyntheticCursor
              moments={moments.moments}
              editPlan={editPlan}
              windowWidth={WINDOW_WIDTH}
              windowHeight={WINDOW_HEIGHT}
              viewportWidth={moments.metadata.viewportWidth}
              viewportHeight={moments.metadata.viewportHeight}
            />
          )}
        </FloatingWindow>
      </CameraTransform>

      {showSfx && (
        <SoundEffects editPlan={editPlan} moments={moments} />
      )}
    </AbsoluteFill>
  );
};
