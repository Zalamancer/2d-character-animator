export interface JointDelta {
  x: number;
  y: number;
}

export interface Keyframe {
  time: number;
  deltas: Record<string, JointDelta>;
  pinned: string[];
}

export interface Animation {
  name: string;
  duration: number;
  fps: number;
  loop: boolean;
  keyframes: Keyframe[];
  ts: number;
}

export interface Pose {
  name: string;
  deltas: Record<string, JointDelta>;
  pinned: string[];
  ts: number;
}

/** Keyframe with deltas normalized as fraction of bboxHeight */
export interface NormalizedKeyframe {
  time: number;
  deltas: Record<string, JointDelta>;
  pinned: string[];
}

/** Animation with deltas normalized by bboxHeight — transferable across characters */
export interface NormalizedAnimation {
  name: string;
  duration: number;
  fps: number;
  loop: boolean;
  keyframes: NormalizedKeyframe[];
  ts: number;
  bboxHeight: number;
}
