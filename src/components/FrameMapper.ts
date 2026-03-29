import type { EditPlan, EditSegment } from "../types";

export function getSegmentAtFrame(
  frame: number,
  editPlan: EditPlan
): EditSegment | null {
  let best: EditSegment | null = null;
  let bestSpan = Infinity;

  for (const seg of editPlan.segments) {
    if (frame >= seg.startFrame && frame <= seg.endFrame) {
      const span = seg.endFrame - seg.startFrame;
      if (span < bestSpan) {
        best = seg;
        bestSpan = span;
      }
    }
  }
  return best;
}

export function frameToVideoTime(
  frame: number,
  editPlan: EditPlan
): number {
  const { fps, segments } = editPlan;
  const maxSpan = editPlan.totalDurationFrames;
  const actionSegments = segments
    .filter((s) => s.endFrame - s.startFrame < maxSpan)
    .sort((a, b) => a.startFrame - b.startFrame);

  const hasVariableSpeed = actionSegments.some((s) => s.speed !== 1.0);
  if (actionSegments.length === 0 || !hasVariableSpeed) {
    return frame / fps;
  }

  let videoTimeMs = 0;
  let lastEndFrame = 0;

  for (const seg of actionSegments) {
    if (frame <= lastEndFrame) break;

    const gapStart = lastEndFrame;
    const gapEnd = seg.startFrame;
    if (frame <= gapEnd) {
      const gapFrames = frame - gapStart;
      videoTimeMs += (gapFrames / fps) * 1000;
      return videoTimeMs / 1000;
    }
    videoTimeMs += ((gapEnd - gapStart) / fps) * 1000;

    if (frame <= seg.endFrame) {
      const segFrames = frame - seg.startFrame;
      videoTimeMs += (segFrames / fps) * seg.speed * 1000;
      return videoTimeMs / 1000;
    }
    const fullSegFrames = seg.endFrame - seg.startFrame;
    videoTimeMs += (fullSegFrames / fps) * seg.speed * 1000;

    lastEndFrame = seg.endFrame;
  }

  const remaining = frame - lastEndFrame;
  videoTimeMs += (remaining / fps) * 1000;

  return videoTimeMs / 1000;
}
