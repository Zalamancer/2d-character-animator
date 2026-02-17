import type { Animation, Keyframe, JointDelta, NormalizedAnimation, NormalizedKeyframe } from '../types/animation';
import type { Skeleton } from '../types/skeleton';

export interface InterpolatedPose {
  deltas: Record<string, JointDelta>;
  pinned: string[];
}

/**
 * Optional persistence callback. Consumers can provide this to save
 * animations to their preferred storage (localStorage, Zustand, etc.).
 */
export type PersistCallback = (animations: Animation[]) => void;

export class AnimationManager {
  animations: Animation[] = [];
  currentAnimation: Animation | null = null;
  currentTime: number = 0;
  isPlaying: boolean = false;
  isRecording: boolean = false;
  playbackSpeed: number = 1.0;
  loop: boolean = false;

  private _recordHeadTime: number = 0;
  private _layerSourceIndex: number | null = null;
  private _onPersist: PersistCallback | null = null;

  constructor(onPersist?: PersistCallback) {
    this._onPersist = onPersist ?? null;
  }

  // ---------------------------------------------------------------------------
  // Data Loading (replaces localStorage)
  // ---------------------------------------------------------------------------

  /** Load animations from external source (replaces constructor localStorage load) */
  loadAnimations(animations: Animation[]): void {
    this.animations = animations;
  }

  /** Get current animations for external persistence */
  getAnimations(): Animation[] {
    return this.animations;
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  startRecording(name: string, fps: number = 24, startTime: number = 0): void {
    this.isRecording = true;
    this._recordHeadTime = startTime;
    this._layerSourceIndex = null;
    this.currentAnimation = {
      name: name || 'Animation ' + (this.animations.length + 1),
      duration: 0,
      fps,
      loop: false,
      keyframes: [],
      ts: Date.now(),
    };
    this.currentTime = startTime;
  }

  /**
   * Start recording as a layer on top of an existing animation.
   * Returns false if the animation index is invalid.
   */
  startLayerRecording(animIndex: number, startTime: number = 0): boolean {
    const anim = this.animations[animIndex];
    if (!anim) return false;
    this.isRecording = true;
    this._recordHeadTime = startTime;
    this._layerSourceIndex = animIndex;
    // Work on a deep copy so we can merge into it
    this.currentAnimation = JSON.parse(JSON.stringify(anim)) as Animation;
    this.currentTime = startTime;
    return true;
  }

  addKeyframe(
    skeleton: Skeleton,
    pinnedJoints: Set<string>,
    time?: number,
    recordFilter?: Set<string> | null
  ): void {
    if (!this.isRecording || !this.currentAnimation) return;

    const deltas: Record<string, JointDelta> = {};
    for (const [jn, j] of Object.entries(skeleton.joints)) {
      // If a bone filter is active, only record joints belonging to selected bones
      if (recordFilter && recordFilter.size > 0 && !recordFilter.has(jn)) continue;
      const dx = j.current.x - j.rest.x;
      const dy = j.current.y - j.rest.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        deltas[jn] = { x: dx, y: dy };
      }
    }

    // Use provided time, or use current scrubber position (currentTime)
    const t: number = time !== undefined ? time : this.currentTime;

    // Advance head for next auto-keyframe (drag-end uses this)
    this._recordHeadTime = t + 1 / this.currentAnimation.fps;
    this.currentTime = this._recordHeadTime;

    // Check if a keyframe already exists at this time (for layering/merging)
    const epsilon = 0.001;
    const existing: Keyframe | undefined = this.currentAnimation.keyframes.find(
      (kf) => Math.abs(kf.time - t) < epsilon
    );

    if (existing) {
      // Merge: add new joint deltas into existing keyframe (overwrite per-joint)
      for (const [jn, d] of Object.entries(deltas)) {
        existing.deltas[jn] = d;
      }
    } else {
      this.currentAnimation.keyframes.push({
        time: t,
        deltas,
        pinned: [...pinnedJoints],
      });
      // Keep keyframes sorted by time
      this.currentAnimation.keyframes.sort((a, b) => a.time - b.time);
    }

    this.currentAnimation.duration = Math.max(this.currentAnimation.duration, t);
  }

  stopRecording(): Animation | null {
    if (!this.isRecording) return null;
    this.isRecording = false;
    const anim = this.currentAnimation;

    if (anim && anim.keyframes.length > 0) {
      if (this._layerSourceIndex !== undefined && this._layerSourceIndex !== null) {
        // Layer mode: replace the original animation
        this.animations[this._layerSourceIndex] = anim;
      } else {
        this.animations.push(anim);
      }
      this._notifyPersist();
    }

    this._layerSourceIndex = null;
    this.currentAnimation = null;
    this.currentTime = 0;
    return anim;
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  play(index: number): boolean {
    const anim = this.animations[index];
    if (!anim || anim.keyframes.length === 0) return false;
    this.currentAnimation = anim;
    this.currentTime = 0;
    this.isPlaying = true;
    this.loop = anim.loop;
    return true;
  }

  pause(): void {
    this.isPlaying = false;
  }

  resume(): void {
    if (this.currentAnimation) this.isPlaying = true;
  }

  stop(): void {
    this.isPlaying = false;
    this.currentAnimation = null;
    this.currentTime = 0;
  }

  seekTo(time: number): void {
    if (!this.currentAnimation) return;
    this.currentTime = Math.max(0, Math.min(time, this.currentAnimation.duration));
  }

  // ---------------------------------------------------------------------------
  // Core Interpolation
  // ---------------------------------------------------------------------------

  getInterpolatedPose(animation: Animation, time: number): InterpolatedPose | null {
    const kfs = animation.keyframes;
    if (kfs.length === 0) return null;
    if (kfs.length === 1) return { deltas: kfs[0].deltas, pinned: kfs[0].pinned };

    const t = Math.max(kfs[0].time, Math.min(time, kfs[kfs.length - 1].time));

    // Find surrounding keyframes
    let i = 0;
    for (; i < kfs.length - 1; i++) {
      if (kfs[i + 1].time >= t) break;
    }
    const kfA = kfs[i];
    const kfB = kfs[Math.min(i + 1, kfs.length - 1)];

    if (kfA === kfB || kfA.time === kfB.time) {
      return { deltas: kfA.deltas, pinned: kfA.pinned };
    }

    const alpha = (t - kfA.time) / (kfB.time - kfA.time);

    // Interpolate deltas
    const allJoints = new Set([...Object.keys(kfA.deltas), ...Object.keys(kfB.deltas)]);
    const deltas: Record<string, JointDelta> = {};
    for (const jn of allJoints) {
      const a = kfA.deltas[jn] || { x: 0, y: 0 };
      const b = kfB.deltas[jn] || { x: 0, y: 0 };
      deltas[jn] = {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
      };
    }

    return { deltas, pinned: kfA.pinned };
  }

  // ---------------------------------------------------------------------------
  // Library Management
  // ---------------------------------------------------------------------------

  remove(index: number): void {
    this.animations.splice(index, 1);
    this._notifyPersist();
  }

  rename(index: number, newName: string): void {
    if (this.animations[index]) {
      this.animations[index].name = newName;
      this._notifyPersist();
    }
  }

  exportJSON(): string {
    return JSON.stringify(this.animations, null, 2);
  }

  importJSON(str: string): number {
    try {
      const arr: Animation[] = JSON.parse(str);
      if (!Array.isArray(arr)) throw new Error('Not an array');
      this.animations.push(...arr);
      this._notifyPersist();
      return arr.length;
    } catch (_e) {
      return -1;
    }
  }

  // ---------------------------------------------------------------------------
  // Normalization (for cross-character animation transfer)
  // ---------------------------------------------------------------------------

  /** Normalize an animation's deltas by dividing by bboxHeight */
  static normalizeAnimation(anim: Animation, bboxHeight: number): NormalizedAnimation {
    const h = Math.max(bboxHeight, 1);
    const keyframes: NormalizedKeyframe[] = anim.keyframes.map((kf) => {
      const deltas: Record<string, JointDelta> = {};
      for (const [jn, d] of Object.entries(kf.deltas)) {
        deltas[jn] = { x: d.x / h, y: d.y / h };
      }
      return { time: kf.time, deltas, pinned: [...kf.pinned] };
    });
    return {
      name: anim.name,
      duration: anim.duration,
      fps: anim.fps,
      loop: anim.loop,
      keyframes,
      ts: anim.ts,
      bboxHeight: h,
    };
  }

  /** Denormalize a shared animation for a target character's bboxHeight */
  static denormalizeAnimation(norm: NormalizedAnimation, targetBboxHeight: number): Animation {
    const h = Math.max(targetBboxHeight, 1);
    const keyframes: Keyframe[] = norm.keyframes.map((kf) => {
      const deltas: Record<string, JointDelta> = {};
      for (const [jn, d] of Object.entries(kf.deltas)) {
        deltas[jn] = { x: d.x * h, y: d.y * h };
      }
      return { time: kf.time, deltas, pinned: [...kf.pinned] };
    });
    return {
      name: norm.name,
      duration: norm.duration,
      fps: norm.fps,
      loop: norm.loop,
      keyframes,
      ts: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Persistence (delegated to consumer)
  // ---------------------------------------------------------------------------

  private _notifyPersist(): void {
    if (this._onPersist) {
      this._onPersist(this.animations);
    }
  }
}
