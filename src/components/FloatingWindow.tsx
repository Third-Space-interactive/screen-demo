import React from "react";

interface FloatingWindowProps {
  width: number;
  height: number;
  children?: React.ReactNode;
}

export const WINDOW_WIDTH = 1632;
export const WINDOW_HEIGHT = 918;
export const WINDOW_BORDER_RADIUS = 12;

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
  width,
  height,
  children,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        left: (width - WINDOW_WIDTH) / 2,
        top: (height - WINDOW_HEIGHT) / 2,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        borderRadius: WINDOW_BORDER_RADIUS,
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}
    >
      {children}
    </div>
  );
};
