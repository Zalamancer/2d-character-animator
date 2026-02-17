import { useCallback, useRef } from 'react';
import { UndoManager } from '@bonerigging/core';
import type { UndoSnapshot, JointSnapshot } from '@bonerigging/core';
import type { Skeleton } from '@bonerigging/core';
import type { BoneWeight } from '@bonerigging/core';
import type { Vec2 } from '@bonerigging/core';
import { V2 } from '@bonerigging/core';

// Re-export for convenience so consumers don't need to import from core
export type { UndoSnapshot, JointSnapshot };

/**
 * Hook that wraps the UndoManager class to provide undo/redo for the
 * skeleton deformation state.
 *
 * A snapshot captures:
 *  - All joint rest and current positions + parent links
 *  - Per-bone radius multipliers
 *  - Pinned joint set
 *  - (Optionally) skin weights -- only when they have been manually edited
 *  - (Optionally) FFD mesh offsets
 */
export function useUndoRedo(maxSnapshots: number = 50) {
  const managerRef = useRef<UndoManager>(new UndoManager(maxSnapshots));

  /**
   * Build an UndoSnapshot from the current skeleton state and push it
   * onto the undo stack.
   *
   * @param skeleton     - current skeleton
   * @param pinnedJoints - currently pinned joints
   * @param weights      - skin weights (only captured when weightsDirty is true)
   * @param ffdOffsets   - FFD vertex offsets (if FFD is active)
   * @param weightsDirty - whether weights have been modified since last capture
   */
  const capture = useCallback(
    (
      skeleton: Skeleton,
      pinnedJoints: Set<string>,
      weights: BoneWeight[][] | null,
      ffdOffsets: Vec2[] | null,
      weightsDirty: boolean,
    ) => {
      const joints: Record<string, JointSnapshot> = {};
      for (const [name, j] of Object.entries(skeleton.joints)) {
        joints[name] = {
          restX: j.rest.x,
          restY: j.rest.y,
          curX: j.current.x,
          curY: j.current.y,
          parent: j.parent,
        };
      }

      const radii: Record<string, number | undefined> = {};
      for (const b of skeleton.bones) {
        radii[b.name] = b.radiusMul;
      }

      const pinned = [...pinnedJoints];

      const snap: UndoSnapshot = { joints, radii, pinned };

      // Only include weights when they've been modified (e.g. weight painting)
      if (weightsDirty && weights) {
        snap.weights = weights.map((w) =>
          w ? w.map((e) => ({ ...e })) : null,
        );
      }

      // Include FFD offsets if present
      if (ffdOffsets) {
        snap.ffd = ffdOffsets.map((v) => V2(v.x, v.y));
      }

      managerRef.current.capture(snap);
    },
    [],
  );

  /**
   * Move one step back in the undo history.
   * Returns the snapshot to restore, or null if at the bottom of the stack.
   */
  const undo = useCallback((): UndoSnapshot | null => {
    return managerRef.current.undo();
  }, []);

  /**
   * Move one step forward in the undo history.
   * Returns the snapshot to restore, or null if at the top of the stack.
   */
  const redo = useCallback((): UndoSnapshot | null => {
    return managerRef.current.redo();
  }, []);

  const canUndo = useCallback((): boolean => {
    return managerRef.current.canUndo();
  }, []);

  const canRedo = useCallback((): boolean => {
    return managerRef.current.canRedo();
  }, []);

  /**
   * Apply a restored snapshot to a skeleton, updating joint positions
   * and bone radius multipliers in place.
   *
   * Returns the pinned joints set and optional weights/ffd data from
   * the snapshot.
   */
  const applySnapshot = useCallback(
    (
      snapshot: UndoSnapshot,
      skeleton: Skeleton,
    ): {
      pinnedJoints: Set<string>;
      weights: BoneWeight[][] | null;
      ffdOffsets: Vec2[] | null;
    } => {
      // Restore joint positions
      for (const [name, s] of Object.entries(snapshot.joints)) {
        const joint = skeleton.joints[name];
        if (joint) {
          joint.rest = V2(s.restX, s.restY);
          joint.current = V2(s.curX, s.curY);
          joint.parent = s.parent;
        }
      }

      // Restore bone radius multipliers
      for (const bone of skeleton.bones) {
        if (snapshot.radii[bone.name] !== undefined) {
          bone.radiusMul = snapshot.radii[bone.name];
        }
      }

      // Rebuild pinned set
      const pinnedJoints = new Set<string>(snapshot.pinned);

      // Restore weights if present
      const weights: BoneWeight[][] | null = snapshot.weights
        ? (snapshot.weights.map((w) =>
            w ? w.map((e) => ({ ...e })) : [],
          ) as BoneWeight[][])
        : null;

      // Restore FFD offsets if present
      const ffdOffsets: Vec2[] | null = snapshot.ffd
        ? snapshot.ffd.map((v) => V2(v.x, v.y))
        : null;

      return { pinnedJoints, weights, ffdOffsets };
    },
    [],
  );

  return {
    capture,
    undo,
    redo,
    canUndo,
    canRedo,
    applySnapshot,
    managerRef,
  };
}
