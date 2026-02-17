import type { Vec2 } from '../types/math';
import type { BoneWeight } from '../types/weights';

/**
 * Serializable snapshot of the skeleton and deformation state,
 * decoupled from the App object so it can be captured / restored
 * by any consumer.
 */
export interface JointSnapshot {
  restX: number;
  restY: number;
  curX: number;
  curY: number;
  parent: string | null;
}

export interface UndoSnapshot {
  joints: Record<string, JointSnapshot>;
  radii: Record<string, number | undefined>;
  pinned: string[];
  weights?: (BoneWeight[] | null)[];
  ffd?: Vec2[];
}

export class UndoManager {
  private stack: UndoSnapshot[] = [];
  private index: number = -1;
  private max: number;

  constructor(maxSnapshots: number = 50) {
    this.max = maxSnapshots;
  }

  /**
   * Push a new snapshot onto the undo stack.
   * Truncates any redo history beyond the current position.
   */
  capture(snapshot: UndoSnapshot): void {
    // Truncate redo history
    this.stack.length = this.index + 1;
    this.stack.push(snapshot);
    if (this.stack.length > this.max) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  /**
   * Move back one step in the undo stack.
   * Returns the snapshot to restore, or null if nothing to undo.
   */
  undo(): UndoSnapshot | null {
    if (this.index <= 0) return null;
    this.index--;
    return this._cloneSnapshot(this.stack[this.index]);
  }

  /**
   * Move forward one step in the undo stack.
   * Returns the snapshot to restore, or null if nothing to redo.
   */
  redo(): UndoSnapshot | null {
    if (this.index >= this.stack.length - 1) return null;
    this.index++;
    return this._cloneSnapshot(this.stack[this.index]);
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /**
   * Deep-clone a snapshot so mutations in the caller don't corrupt the stack.
   */
  private _cloneSnapshot(snap: UndoSnapshot): UndoSnapshot {
    const joints: Record<string, JointSnapshot> = {};
    for (const [name, s] of Object.entries(snap.joints)) {
      joints[name] = {
        restX: s.restX,
        restY: s.restY,
        curX: s.curX,
        curY: s.curY,
        parent: s.parent,
      };
    }

    const radii: Record<string, number | undefined> = {};
    for (const [name, r] of Object.entries(snap.radii)) {
      radii[name] = r;
    }

    const result: UndoSnapshot = {
      joints,
      radii,
      pinned: [...snap.pinned],
    };

    if (snap.weights) {
      result.weights = snap.weights.map(
        (w) => (w ? w.map((e) => ({ ...e })) : null)
      );
    }

    if (snap.ffd) {
      result.ffd = snap.ffd.map((v) => ({ x: v.x, y: v.y }));
    }

    return result;
  }
}
