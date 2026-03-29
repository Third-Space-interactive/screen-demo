// -- Browse Plan (input to record script) --

export interface BrowsePlanAction {
  type: "navigate" | "click" | "hover" | "scroll" | "wait" | "script";
  url?: string;
  selector?: string;
  deltaY?: number;
  ms?: number;
  js?: string;
  description: string;
}

export interface BrowsePlan {
  url: string;
  viewport: { width: number; height: number };
  actions: BrowsePlanAction[];
}

// -- Moments (output from record script) --

export interface MomentsMetadata {
  url: string;
  viewportWidth: number;
  viewportHeight: number;
  totalDurationMs: number;
  recordingStart: string;
}

export interface CursorPosition {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Moment {
  id: number;
  type: "navigate" | "click" | "hover" | "scroll" | "wait" | "script" | "drag" | "type" | "key";
  timestamp: number;
  url?: string;
  cursor?: CursorPosition;
  target?: BoundingBox;
  scrollDelta?: { x: number; y: number };
  dragFrom?: CursorPosition;
  dragTo?: CursorPosition;
  keys?: string;
  stayedInArea?: boolean;
  maxDriftPx?: number;
  description: string;
}

export interface MomentsFile {
  metadata: MomentsMetadata;
  moments: Moment[];
}

// -- Edit Plan (drives Remotion composition) --

export interface TimeRegion {
  videoStartFrame: number;
  videoEndFrame: number;
  compStartFrame: number;
  compEndFrame: number;
  speed: number;
}

export interface EditSegment {
  momentId: number;
  startFrame: number;
  endFrame: number;
  speed: number;
  zoom: number;
  zoomTarget: CursorPosition | null;
  zoomTargetEnd?: CursorPosition;
  easeInFrames?: number;
  easeOutFrames?: number;
  description: string;
}

export interface EditPlan {
  totalDurationFrames: number;
  fps: number;
  defaultZoom: number;
  timeRegions?: TimeRegion[];
  segments: EditSegment[];
}
