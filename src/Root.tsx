import React from "react";
import { Composition } from "remotion";
import { ScreenDemo } from "./ScreenDemo";
import type { EditPlan, MomentsFile } from "./types";

// Point these at your recording data
import editPlanData from "../data/example/edit-plan.json";
import momentsData from "../data/example/moments.json";

const editPlan = editPlanData as EditPlan;
const moments = momentsData as MomentsFile;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ScreenDemo"
        component={ScreenDemo as unknown as React.ComponentType<Record<string, unknown>>}
        durationInFrames={editPlan.totalDurationFrames}
        fps={editPlan.fps}
        width={1920}
        height={1080}
        defaultProps={{
          editPlan,
          moments,
          videoFileName: "recording.mp4",
          showCursor: true,
          showSfx: true,
        }}
      />
    </>
  );
};
