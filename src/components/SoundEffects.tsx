import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import type { EditPlan, MomentsFile } from "../types";

const BASE_FPS = 30;

const CLICK_SOUNDS = [
  staticFile("sfx/click-1.mp3"),
  staticFile("sfx/click-2.mp3"),
  staticFile("sfx/click-3.mp3"),
];

const WHOOSH_IN_SOUNDS = [
  staticFile("sfx/whoosh-in-1.mp3"),
  staticFile("sfx/whoosh-in-2.mp3"),
];

const WHOOSH_OUT_SOUNDS = [
  staticFile("sfx/whoosh-out-1.mp3"),
  staticFile("sfx/whoosh-out-2.mp3"),
];

const WHOOSH_PAN_SOUND = staticFile("sfx/whoosh-pan.mp3");

interface SoundEffectsProps {
  editPlan: EditPlan;
  moments: MomentsFile;
  clickVolume?: number;
  whooshVolume?: number;
}

interface SfxEvent {
  frame: number;
  src: string;
  volume: number;
}

/**
 * Check if two segments will pan between each other (same logic as CameraTransform).
 */
function willPanBetween(
  prev: { endFrame: number; easeOutFrames?: number; zoom: number; zoomTarget: unknown },
  next: { startFrame: number; easeInFrames?: number; zoom: number; zoomTarget: unknown },
  fps: number,
  fpsScale: number
): boolean {
  if (!prev.zoomTarget || !next.zoomTarget) return false;
  if (prev.zoom <= 1 || next.zoom <= 1) return false;
  const easeOut = Math.round((prev.easeOutFrames ?? 20) * fpsScale);
  const easeIn = Math.round((next.easeInFrames ?? 15) * fpsScale);
  const gap = next.startFrame - prev.endFrame;
  const totalBounceFrames = easeOut + Math.max(0, gap) + easeIn;
  return totalBounceFrames / fps <= 3.0;
}

export const SoundEffects: React.FC<SoundEffectsProps> = ({
  editPlan,
  moments,
  clickVolume = 0.3,
  whooshVolume = 0.1,
}) => {
  const fpsScale = editPlan.fps / BASE_FPS;
  const events: SfxEvent[] = [];

  // Click sounds on click moments
  const clickMoments = moments.moments.filter((m) => m.type === "click");
  clickMoments.forEach((m, idx) => {
    const frame = Math.round((m.timestamp / 1000) * editPlan.fps);
    events.push({
      frame,
      src: CLICK_SOUNDS[idx % CLICK_SOUNDS.length],
      volume: clickVolume,
    });
  });

  // Camera whooshes from zoom segments
  const zoomSegments = editPlan.segments.filter(
    (s) => s.zoomTarget && s.zoom > 1
  );

  for (let i = 0; i < zoomSegments.length; i++) {
    const seg = zoomSegments[i];
    const prevSeg = i > 0 ? zoomSegments[i - 1] : null;
    const nextSeg = i < zoomSegments.length - 1 ? zoomSegments[i + 1] : null;
    const easeIn = Math.round((seg.easeInFrames ?? 15) * fpsScale);
    const easeOut = Math.round((seg.easeOutFrames ?? 20) * fpsScale);

    // Panning from previous: use pan whoosh
    const panFromPrev = prevSeg && willPanBetween(prevSeg, seg, editPlan.fps, fpsScale);
    if (panFromPrev) {
      const boundary = Math.round((prevSeg.endFrame + seg.startFrame) / 2);
      events.push({
        frame: boundary - Math.round(8 * fpsScale),
        src: WHOOSH_PAN_SOUND,
        volume: whooshVolume * 0.8,
      });
    } else {
      // Zoom in whoosh
      events.push({
        frame: seg.startFrame - easeIn,
        src: WHOOSH_IN_SOUNDS[i % WHOOSH_IN_SOUNDS.length],
        volume: whooshVolume,
      });
    }

    // Zoom out whoosh (only if not panning to next)
    const panToNext = nextSeg && willPanBetween(seg, nextSeg, editPlan.fps, fpsScale);
    if (!panToNext) {
      events.push({
        frame: seg.endFrame,
        src: WHOOSH_OUT_SOUNDS[i % WHOOSH_OUT_SOUNDS.length],
        volume: whooshVolume,
      });
    }
  }

  return (
    <>
      {events.map((evt, idx) => (
        <Sequence key={idx} from={Math.max(0, evt.frame)}>
          <Audio src={evt.src} volume={evt.volume} />
        </Sequence>
      ))}
    </>
  );
};
