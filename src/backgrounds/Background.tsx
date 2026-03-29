import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { THEME } from "../styles/colors";

const WIDTH = 1920;
const HEIGHT = 1080;
const SPACING = 120;
const DURATION = 90;

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const offset = (frame * (SPACING / DURATION)) % SPACING;

  const cols = Math.ceil(WIDTH / SPACING) + 4;
  const rows = Math.ceil(HEIGHT / SPACING) + 4;

  return (
    <AbsoluteFill style={{ backgroundColor: THEME.bg }}>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {Array.from({ length: cols }, (_, i) => {
          const x = (i - 2) * SPACING + offset;
          return (
            <line
              key={`v-${i}`}
              x1={x}
              y1={0}
              x2={x}
              y2={HEIGHT}
              stroke={THEME.gridStroke}
              strokeWidth={1}
            />
          );
        })}
        {Array.from({ length: rows }, (_, i) => {
          const y = (i - 2) * SPACING + offset;
          return (
            <line
              key={`h-${i}`}
              x1={0}
              y1={y}
              x2={WIDTH}
              y2={y}
              stroke={THEME.gridStroke}
              strokeWidth={1}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
