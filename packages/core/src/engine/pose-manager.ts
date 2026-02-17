import type { Pose, JointDelta } from '../types/animation';
import type { Skeleton } from '../types/skeleton';
import { V2 } from './math';

/**
 * Optional persistence callback. Consumers can provide this to save
 * poses to their preferred storage (localStorage, Zustand, etc.).
 */
export type PosePersistCallback = (poses: Pose[]) => void;

export class PoseManager {
  poses: Pose[] = [];

  private _onPersist: PosePersistCallback | null = null;

  constructor(onPersist?: PosePersistCallback) {
    this._onPersist = onPersist ?? null;
  }

  // ---------------------------------------------------------------------------
  // Data Loading (replaces localStorage)
  // ---------------------------------------------------------------------------

  /** Load poses from external source (replaces constructor localStorage load) */
  loadPoses(poses: Pose[]): void {
    this.poses = poses;
  }

  /** Get current poses for external persistence */
  getPoses(): Pose[] {
    return this.poses;
  }

  // ---------------------------------------------------------------------------
  // Pose Operations
  // ---------------------------------------------------------------------------

  /**
   * Capture the current skeleton pose as a named pose.
   * Only joints that have moved from rest are stored.
   */
  save(name: string, skeleton: Skeleton, pinnedJoints: Set<string>): void {
    const deltas: Record<string, JointDelta> = {};
    for (const [jn, j] of Object.entries(skeleton.joints)) {
      const dx = j.current.x - j.rest.x;
      const dy = j.current.y - j.rest.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        deltas[jn] = { x: dx, y: dy };
      }
    }
    this.poses.push({
      name,
      deltas,
      pinned: [...pinnedJoints],
      ts: Date.now(),
    });
    this._notifyPersist();
  }

  /**
   * Apply a stored pose to the skeleton.
   * Returns the number of joints in the pose that no longer exist in the
   * skeleton (skipped), or undefined if the index is invalid.
   */
  apply(
    index: number,
    skeleton: Skeleton
  ): { skipped: number; pinned: string[] } | undefined {
    const pose = this.poses[index];
    if (!pose) return undefined;

    // Reset to rest first
    for (const j of Object.values(skeleton.joints)) {
      j.current = V2(j.rest.x, j.rest.y);
    }

    // Apply deltas
    let skipped = 0;
    for (const [jn, d] of Object.entries(pose.deltas)) {
      const j = skeleton.joints[jn];
      if (j) {
        j.current = V2(j.rest.x + d.x, j.rest.y + d.y);
      } else {
        skipped++;
      }
    }

    // Return pinned list filtered to joints that actually exist
    const pinned = pose.pinned.filter((n) => skeleton.joints[n]);
    return { skipped, pinned };
  }

  remove(index: number): void {
    this.poses.splice(index, 1);
    this._notifyPersist();
  }

  exportJSON(): string {
    return JSON.stringify(this.poses, null, 2);
  }

  importJSON(str: string): number {
    try {
      const arr: Pose[] = JSON.parse(str);
      if (!Array.isArray(arr)) throw new Error('Not an array');
      this.poses.push(...arr);
      this._notifyPersist();
      return arr.length;
    } catch (_e) {
      return -1;
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence (delegated to consumer)
  // ---------------------------------------------------------------------------

  private _notifyPersist(): void {
    if (this._onPersist) {
      this._onPersist(this.poses);
    }
  }
}
