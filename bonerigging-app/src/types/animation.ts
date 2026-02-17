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
