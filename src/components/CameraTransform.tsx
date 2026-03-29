import React from "react";
import { useCurrentFrame, interpolate, Easing } from "remotion";
import type { EditPlan, EditSegment, CursorPosition } from "../types";
import { WINDOW_WIDTH, WINDOW_HEIGHT } from "./FloatingWindow";

interface CameraTransformProps {
  editPlan: EditPlan;
  canvasWidth: number;
  canvasHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  children: React.ReactNode;
}

interface ZoomState {
  scale: number;
  translateX: number;
  translateY: number;
}

/**
 * Base FPS for ease duration authoring. Ease frame counts in the edit plan
 * are authored assuming this FPS. At higher FPS, they scale proportionally
 * so the animation takes the same wall-clock time.
 */
const BASE_FPS = 30;

function computeTranslate(
  point: CursorPosition,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { translateX: number; translateY: number } {
  const windowLeft = (canvasWidth - WINDOW_WIDTH) / 2;
  const windowTop = (canvasHeight - WINDOW_HEIGHT) / 2;
  const scaleX = WINDOW_WIDTH / viewportWidth;
  const scaleY = WINDOW_HEIGHT / viewportHeight;

  const targetScreenX = windowLeft + point.x * scaleX;
  const targetScreenY = windowTop + point.y * scaleY;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  return {
    translateX: (centerX - targetScreenX) * zoom,
    translateY: (centerY - targetScreenY) * zoom,
  };
}

function computeZoomTarget(
  seg: EditSegment,
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { maxTranslateX: number; maxTranslateY: number } {
  if (!seg.zoomTarget) return { maxTranslateX: 0, maxTranslateY: 0 };
  const { translateX, translateY } = computeTranslate(
    seg.zoomTarget, seg.zoom, canvasWidth, canvasHeight, viewportWidth, viewportHeight
  );
  return { maxTranslateX: translateX, maxTranslateY: translateY };
}

/**
 * If the total bounce time (ease-out + dead air + ease-in) between two
 * segments is under this threshold, pan directly instead of zooming out
 * and back in. Value is in seconds of wall-clock time.
 */
const PAN_THRESHOLD_SECONDS = 3.0;

/**
 * Check if two zoom segments are close enough to pan between them
 * instead of zooming out to 1x and back in.
 *
 * The bounce would take: easeOut + gap + easeIn frames.
 * If that total is less than PAN_THRESHOLD_SECONDS, pan instead.
 */
function shouldPanBetween(
  prev: EditSegment,
  next: EditSegment,
  fps: number,
  fpsScale: number
): boolean {
  if (!prev.zoomTarget || !next.zoomTarget) return false;
  if (prev.zoom <= 1 || next.zoom <= 1) return false;

  const easeOut = Math.round((prev.easeOutFrames ?? 20) * fpsScale);
  const easeIn = Math.round((next.easeInFrames ?? 15) * fpsScale);
  const gap = next.startFrame - prev.endFrame;
  const totalBounceFrames = easeOut + Math.max(0, gap) + easeIn;
  const totalBounceSeconds = totalBounceFrames / fps;

  return totalBounceSeconds <= PAN_THRESHOLD_SECONDS;
}

function getCameraState(
  frame: number,
  editPlan: EditPlan,
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number
): ZoomState {
  const defaultState: ZoomState = { scale: 1, translateX: 0, translateY: 0 };
  const fpsScale = editPlan.fps / BASE_FPS;
  const zoomSegments = editPlan.segments.filter(
    (s) => s.zoomTarget && s.zoom > 1
  );

  if (zoomSegments.length === 0) return defaultState;

  for (let i = 0; i < zoomSegments.length; i++) {
    const seg = zoomSegments[i];
    const prevSeg = i > 0 ? zoomSegments[i - 1] : null;
    const nextSeg = i < zoomSegments.length - 1 ? zoomSegments[i + 1] : null;

    const easeIn = Math.round((seg.easeInFrames ?? 15) * fpsScale);
    const easeOut = Math.round((seg.easeOutFrames ?? 20) * fpsScale);
    const zoomStart = seg.startFrame - easeIn;
    const zoomEnd = seg.endFrame + easeOut;

    const { maxTranslateX, maxTranslateY } = computeZoomTarget(
      seg, canvasWidth, canvasHeight, viewportWidth, viewportHeight
    );

    // Pan FROM previous segment into this one
    const panFromPrev = prevSeg && shouldPanBetween(prevSeg, seg, editPlan.fps, fpsScale);
    if (panFromPrev) {
      const PAN_HALF = Math.round(8 * fpsScale);
      const boundary = Math.round((prevSeg.endFrame + seg.startFrame) / 2);
      const panStart = boundary - PAN_HALF;
      const panEnd = boundary + PAN_HALF;

      if (frame >= panStart && frame <= panEnd) {
        const prevTarget = computeZoomTarget(
          prevSeg, canvasWidth, canvasHeight, viewportWidth, viewportHeight
        );
        const t = interpolate(frame, [panStart, panEnd], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.cubic),
        });

        const scale = prevSeg.zoom + (seg.zoom - prevSeg.zoom) * t;
        return {
          scale,
          translateX: prevTarget.maxTranslateX + (maxTranslateX - prevTarget.maxTranslateX) * t,
          translateY: prevTarget.maxTranslateY + (maxTranslateY - prevTarget.maxTranslateY) * t,
        };
      }

      // After pan finishes but before hold starts: hold at this segment's target
      if (frame > panEnd && frame < seg.startFrame) {
        return { scale: seg.zoom, translateX: maxTranslateX, translateY: maxTranslateY };
      }
    }

    // Pan TO next segment instead of easing out
    if (nextSeg && shouldPanBetween(seg, nextSeg, editPlan.fps, fpsScale)) {
      const PAN_HALF = Math.round(8 * fpsScale);
      const boundary = Math.round((seg.endFrame + nextSeg.startFrame) / 2);
      const panStart = boundary - PAN_HALF;

      if (frame >= seg.startFrame && frame < panStart) {
        return holdState(frame, seg, maxTranslateX, maxTranslateY,
          canvasWidth, canvasHeight, viewportWidth, viewportHeight);
      }
      if (panFromPrev && frame < seg.startFrame) {
        continue;
      }
    }

    if (frame < zoomStart || frame > zoomEnd) continue;

    // Ease in (only if not panning from previous)
    if (frame < seg.startFrame) {
      if (panFromPrev) {
        continue;
      }
      const t = interpolate(frame, [zoomStart, seg.startFrame], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      });
      return {
        scale: 1 + (seg.zoom - 1) * t,
        translateX: maxTranslateX * t,
        translateY: maxTranslateY * t,
      };
    }

    // Hold (with drag following)
    if (frame <= seg.endFrame) {
      return holdState(frame, seg, maxTranslateX, maxTranslateY,
        canvasWidth, canvasHeight, viewportWidth, viewportHeight);
    }

    // Ease out (only if not panning to next)
    if (nextSeg && shouldPanBetween(seg, nextSeg, editPlan.fps, fpsScale)) {
      continue;
    }

    const t = interpolate(frame, [seg.endFrame, zoomEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    });
    return {
      scale: 1 + (seg.zoom - 1) * t,
      translateX: maxTranslateX * t,
      translateY: maxTranslateY * t,
    };
  }

  return defaultState;
}

/**
 * Compute camera state during the hold phase.
 * If the segment has a zoomTargetEnd (drag), interpolate between start and end.
 * Otherwise, hold at the static zoomTarget.
 */
function holdState(
  frame: number,
  seg: EditSegment,
  staticTranslateX: number,
  staticTranslateY: number,
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number
): ZoomState {
  if (!seg.zoomTargetEnd) {
    return { scale: seg.zoom, translateX: staticTranslateX, translateY: staticTranslateY };
  }

  // Drag following: interpolate from zoomTarget to zoomTargetEnd over the hold duration
  const endTranslate = computeTranslate(
    seg.zoomTargetEnd, seg.zoom, canvasWidth, canvasHeight, viewportWidth, viewportHeight
  );

  const t = interpolate(frame, [seg.startFrame, seg.endFrame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  return {
    scale: seg.zoom,
    translateX: staticTranslateX + (endTranslate.translateX - staticTranslateX) * t,
    translateY: staticTranslateY + (endTranslate.translateY - staticTranslateY) * t,
  };
}

export const CameraTransform: React.FC<CameraTransformProps> = ({
  editPlan,
  canvasWidth,
  canvasHeight,
  viewportWidth,
  viewportHeight,
  children,
}) => {
  const frame = useCurrentFrame();
  const { scale, translateX, translateY } = getCameraState(
    frame, editPlan, canvasWidth, canvasHeight, viewportWidth, viewportHeight
  );

  return (
    <div
      style={{
        position: "absolute",
        width: canvasWidth,
        height: canvasHeight,
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transformOrigin: "center center",
      }}
    >
      {children}
    </div>
  );
};
