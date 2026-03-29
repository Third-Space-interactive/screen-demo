import React from "react";
import { useCurrentFrame, Easing } from "remotion";
import type { Moment } from "../types";
import {
  CURSOR_PATH,
  CURSOR_WIDTH,
  CURSOR_HEIGHT,
  CLICK_SCALE_MIN,
} from "../styles/cursor";
import type { EditPlan } from "../types";
import { frameToVideoTime } from "./FrameMapper";

interface SyntheticCursorProps {
  moments: Moment[];
  editPlan: EditPlan;
  windowWidth: number;
  windowHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

// How long (ms) the cursor takes to travel between positions.
// Shorter = snappier, more intentional movement.
const TRAVEL_DURATION_MS = 450;

function getCursorState(
  videoTimeMs: number,
  moments: Moment[]
): {
  x: number;
  y: number;
  visible: boolean;
  isClick: boolean;
  clickProgress: number;
} {
  const cursorMoments = moments.filter(
    (m) => m.cursor && (m.type === "click" || m.type === "hover" || m.type === "scroll")
  );

  if (cursorMoments.length === 0) {
    return { x: 0, y: 0, visible: false, isClick: false, clickProgress: 0 };
  }

  // Show cursor 1200ms before first action
  const firstTime = cursorMoments[0].timestamp;
  if (videoTimeMs < firstTime - 1200) {
    return { x: 0, y: 0, visible: false, isClick: false, clickProgress: 0 };
  }

  // Lead-in: glide from center to first target over 800ms
  if (videoTimeMs < firstTime) {
    const leadDuration = 800;
    const leadStart = firstTime - leadDuration;
    if (videoTimeMs < leadStart) {
      // Before lead-in starts, show at center
      return { x: 960, y: 540, visible: true, isClick: false, clickProgress: 0 };
    }
    const t = (videoTimeMs - leadStart) / leadDuration;
    const eased = Easing.out(Easing.cubic)(Math.min(1, Math.max(0, t)));
    const x = 960 + (cursorMoments[0].cursor!.x - 960) * eased;
    const y = 540 + (cursorMoments[0].cursor!.y - 540) * eased;
    return { x, y, visible: true, isClick: false, clickProgress: 0 };
  }

  // Find which moment we're at or between
  let currentIdx = 0;
  for (let i = 0; i < cursorMoments.length; i++) {
    if (cursorMoments[i].timestamp <= videoTimeMs) {
      currentIdx = i;
    }
  }

  const current = cursorMoments[currentIdx];
  const next = cursorMoments[currentIdx + 1];

  let x: number;
  let y: number;

  if (!next) {
    // Past the last cursor moment: hold at last position
    x = current.cursor!.x;
    y = current.cursor!.y;
  } else {
    // Key change: cursor holds at current position, then moves to next
    // in the last TRAVEL_DURATION_MS before the next moment.
    const moveStart = next.timestamp - TRAVEL_DURATION_MS;

    if (videoTimeMs < moveStart) {
      // Holding at current position
      x = current.cursor!.x;
      y = current.cursor!.y;
    } else {
      // Moving toward next position
      const t = (videoTimeMs - moveStart) / TRAVEL_DURATION_MS;
      const eased = Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, t)));
      x = current.cursor!.x + (next.cursor!.x - current.cursor!.x) * eased;
      y = current.cursor!.y + (next.cursor!.y - current.cursor!.y) * eased;
    }
  }

  // Click detection: within 350ms after a click moment
  let isClick = false;
  let clickProgress = 0;
  for (const m of cursorMoments) {
    if (m.type === "click") {
      const elapsed = videoTimeMs - m.timestamp;
      if (elapsed >= 0 && elapsed < 350) {
        isClick = true;
        clickProgress = elapsed / 350;
      }
    }
  }

  return { x, y, visible: true, isClick, clickProgress };
}

export const SyntheticCursor: React.FC<SyntheticCursorProps> = ({
  moments,
  editPlan,
  windowWidth,
  windowHeight,
  viewportWidth,
  viewportHeight,
}) => {
  const frame = useCurrentFrame();
  const videoTimeSec = frameToVideoTime(frame, editPlan);
  const videoTimeMs = videoTimeSec * 1000;

  const { x, y, visible, isClick, clickProgress } = getCursorState(
    videoTimeMs,
    moments
  );

  if (!visible) return null;

  // Scale cursor coords from viewport space to window space
  const scaleX = windowWidth / viewportWidth;
  const scaleY = windowHeight / viewportHeight;
  const screenX = x * scaleX;
  const screenY = y * scaleY;

  // Click animation: scale down then up
  let cursorScale = 1;
  if (isClick) {
    if (clickProgress < 0.25) {
      cursorScale = 1 - (1 - CLICK_SCALE_MIN) * (clickProgress / 0.25);
    } else if (clickProgress < 0.55) {
      cursorScale = CLICK_SCALE_MIN;
    } else {
      cursorScale = CLICK_SCALE_MIN + (1 - CLICK_SCALE_MIN) * ((clickProgress - 0.55) / 0.45);
    }
  }

  // Click ring animation
  const ringOpacity = isClick ? Math.max(0, 0.6 * (1 - clickProgress)) : 0;
  const ringScale = isClick ? 1 + clickProgress * 1.5 : 1;

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        transform: `translate(-4px, -2px)`,
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      {isClick && ringOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            left: 4,
            top: 2,
            width: 20,
            height: 20,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.8)",
            opacity: ringOpacity,
            transform: `translate(-50%, -50%) scale(${ringScale})`,
          }}
        />
      )}
      <svg
        width={CURSOR_WIDTH}
        height={CURSOR_HEIGHT}
        viewBox="0 0 28 36"
        fill="none"
        style={{ transform: `scale(${cursorScale})`, transformOrigin: "top left" }}
      >
        <path
          d={CURSOR_PATH}
          fill={isClick && clickProgress < 0.55 ? "#333333" : "#FFFFFF"}
          stroke="#333333"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
