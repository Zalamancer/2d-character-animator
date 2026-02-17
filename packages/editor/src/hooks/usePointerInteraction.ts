import { useCallback, useRef } from 'react';
import { V2, v2Sub, v2Add, v2Dist } from '@bonerigging/core';
import { applyRigidDrag, propagateFK } from '@bonerigging/core';
import type { Vec2 } from '@bonerigging/core';
import type { Skeleton } from '@bonerigging/core';
import type { BoneWeight } from '@bonerigging/core';
import type { CharacterState, CharacterAction } from '../contexts/CharacterContext';
import type { ViewportState } from '../contexts/ViewportContext';
import type { ToolState, ToolAction } from '../contexts/ToolContext';
import type { AnimationAction } from '../contexts/AnimationContext';
import type { SpringChain } from '@bonerigging/core';

// ---------------------------------------------------------------------------
// Internal pointer-tracking state (mutable, not React state)
// ---------------------------------------------------------------------------

interface PointerInternalState {
  isDragging: boolean;
  dragJoint: string | null;
  dragOffset: Vec2;
  isPanning: boolean;
  panStart: {
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Viewport actions shape (returned by useViewport)
// ---------------------------------------------------------------------------

interface ViewportActions {
  startPan: (
    clientX: number,
    clientY: number,
  ) => {
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  };
  updatePan: (
    clientX: number,
    clientY: number,
    panStart: {
      startX: number;
      startY: number;
      startPanX: number;
      startPanY: number;
    },
  ) => void;
  zoomBy: (
    factor: number,
    cursorX?: number,
    cursorY?: number,
    parsed?: any,
    containerW?: number,
    containerH?: number,
  ) => void;
}

/**
 * Hook that handles all pointer events on the viewport canvas.
 *
 * Responsibilities:
 *  - Joint hover detection
 *  - Joint dragging with IK (rigid mode) or FK (stretch mode)
 *  - Real-time SVG path deformation during drag
 *  - Pan (Alt+drag or middle-mouse drag)
 *  - Zoom (scroll wheel toward cursor)
 *  - Weight-paint brush stroke initiation
 *  - FFD vertex dragging
 *
 * The hook reads character/viewport/tool state but mutates the skeleton
 * in-place for performance (joint.current positions). It dispatches to
 * contexts only for discrete state changes (selection, hover, pan).
 */
export function usePointerInteraction(
  characterState: CharacterState,
  characterDispatch: React.Dispatch<CharacterAction>,
  viewportState: ViewportState,
  viewportActions: ViewportActions,
  toolState: ToolState,
  toolDispatch: React.Dispatch<ToolAction>,
  animDispatch: React.Dispatch<AnimationAction>,
  isAnimPlaying: boolean,
) {
  const stateRef = useRef<PointerInternalState>({
    isDragging: false,
    dragJoint: null,
    dragOffset: V2(),
    isPanning: false,
    panStart: null,
  });

  // Mutable ref to pass newly-computed FFD offsets back to the caller so it
  // can eagerly sync charRef before calling applyDeformation().  The hook
  // dispatches SET_FFD_OFFSETS but that's async — this ref lets the caller
  // read the value synchronously right after onPointerMove returns.
  const lastFfdOffsetsRef = useRef<Vec2[] | null>(null);

  // ---------------------------------------------------------------------------
  // Coordinate conversion: screen -> SVG/character world space
  // ---------------------------------------------------------------------------
  const screenToWorld = useCallback(
    (screenX: number, screenY: number): Vec2 => {
      const { scale, offsetX, offsetY } = viewportState;
      if (scale === 0) return V2(screenX, screenY);
      return V2(
        (screenX - offsetX) / scale,
        (screenY - offsetY) / scale,
      );
    },
    [viewportState],
  );

  // ---------------------------------------------------------------------------
  // Find the closest joint within a pixel threshold
  // ---------------------------------------------------------------------------
  const findJointAt = useCallback(
    (worldPos: Vec2, skeleton: Skeleton, threshold: number = 12): string | null => {
      const { scale } = viewportState;
      const worldThreshold = scale > 0 ? threshold / scale : threshold;
      let closest: string | null = null;
      let closestDist = worldThreshold;

      for (const [name, joint] of Object.entries(skeleton.joints)) {
        const d = v2Dist(worldPos, joint.current);
        if (d < closestDist) {
          closestDist = d;
          closest = name;
        }
      }
      return closest;
    },
    [viewportState],
  );

  // ---------------------------------------------------------------------------
  // Helper: determine whether a joint is driven by spring physics
  // ---------------------------------------------------------------------------
  const isSpringJoint = useCallback(
    (name: string): boolean => {
      const chains: SpringChain[] = characterState.springChains ?? [];
      for (const chain of chains) {
        if (chain.joints.includes(name)) return true;
      }
      return false;
    },
    [characterState.springChains],
  );

  // ---------------------------------------------------------------------------
  // Weight painting: modify per-vertex bone weights under the brush.
  // Accepts currentWeights param so the caller can pass the latest mutable
  // ref value (charRef.current.weights) instead of stale React state.
  // ---------------------------------------------------------------------------
  const paintWeights = useCallback(
    (
      screenX: number,
      screenY: number,
      _canvasRect: DOMRect,
      currentWeights?: BoneWeight[][] | null,
    ): BoneWeight[][] | null => {
      const { skeleton, parsed, weights: stateWeights, mode, mesh } = characterState;
      const { wpState } = toolState;
      const weights = currentWeights ?? stateWeights;
      if (!skeleton || !parsed || !weights || wpState.bone < 0) return null;

      const cpArr = (mode === 'raster' && mesh) ? mesh.vertices : parsed.allControlPoints;
      const n = cpArr.length;
      if (n === 0) return null;

      const { scale, offsetX, offsetY } = viewportState;

      let changed = false;
      // Clone the weights array (shallow — we'll deep-clone individual entries we modify)
      const newWeights = [...weights];

      for (let i = 0; i < n; i++) {
        const pt = cpArr[i].point;
        // Convert vertex world position to screen position
        const spx = pt.x * scale + offsetX;
        const spy = pt.y * scale + offsetY;

        const dist = Math.sqrt(
          (spx - screenX) ** 2 + (spy - screenY) ** 2
        );
        if (dist > wpState.radius) continue;

        const falloff = Math.pow(1 - dist / wpState.radius, 2);
        const delta = wpState.strength * falloff;

        // Deep clone this vertex's weights
        let wi: BoneWeight[] = newWeights[i] ? [...newWeights[i]] : [];

        if (wpState.mode === 'add') {
          let entry = wi.find(e => e.boneIndex === wpState.bone);
          if (!entry) {
            entry = {
              boneIndex: wpState.bone,
              weight: 0,
              boneName: skeleton.bones[wpState.bone]?.name ?? '',
              t: 0.5,
            };
            wi.push(entry);
          } else {
            // Clone the entry so we don't mutate the original
            const idx = wi.indexOf(entry);
            entry = { ...entry };
            wi[idx] = entry;
          }
          entry.weight = Math.min(1, entry.weight + delta);
        } else if (wpState.mode === 'subtract') {
          const entry = wi.find(e => e.boneIndex === wpState.bone);
          if (entry) {
            const idx = wi.indexOf(entry);
            const cloned = { ...entry };
            cloned.weight = Math.max(0, cloned.weight - delta);
            wi[idx] = cloned;
          }
        } else if (wpState.mode === 'smooth') {
          const entry = wi.find(e => e.boneIndex === wpState.bone);
          if (entry) {
            const idx = wi.indexOf(entry);
            const cloned = { ...entry };
            cloned.weight += (0.5 - cloned.weight) * delta;
            wi[idx] = cloned;
          }
        }

        // Normalize: remove near-zero, keep top 4, sum to 1
        wi = wi.filter(e => e.weight > 0.001);
        wi.sort((a, b) => b.weight - a.weight);
        if (wi.length > 4) wi.length = 4;
        const sum = wi.reduce((s, e) => s + e.weight, 0);
        if (sum > 0) wi.forEach(e => e.weight /= sum);

        newWeights[i] = wi;
        changed = true;
      }

      return changed ? newWeights : null;
    },
    [characterState, toolState, viewportState],
  );

  // ---------------------------------------------------------------------------
  // Pointer down
  // ---------------------------------------------------------------------------
  const onPointerDown = useCallback(
    (e: PointerEvent, canvasRect: DOMRect) => {
      const ps = stateRef.current;
      const { skeleton, parsed } = characterState;
      if (!skeleton || !parsed) return;

      // Block interaction during animation playback
      if (isAnimPlaying) return;

      const mx = e.clientX - canvasRect.left;
      const my = e.clientY - canvasRect.top;

      // --- Pan: middle mouse or alt+left-click ---
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        ps.isPanning = true;
        ps.panStart = viewportActions.startPan(e.clientX, e.clientY);
        // Capture pointer so drag continues even outside the element
        (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
        return;
      }

      const worldPos = screenToWorld(mx, my);

      // --- Weight paint mode: start painting ---
      if (toolState.weightPaintMode && e.button === 0) {
        toolDispatch({ type: 'SET_WP_PAINTING', painting: true });
        // Capture pointer so painting continues smoothly
        (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
        return;
      }

      // --- FFD mode: find closest vertex (raster mesh or SVG control points) ---
      // Matches original HTML: compare in SCREEN space with 15px threshold.
      if (characterState.ffdMode && e.button === 0) {
        const cpArr = (characterState.mode === 'raster' && characterState.mesh)
          ? characterState.mesh.vertices
          : (characterState.parsed ? characterState.parsed.allControlPoints : null);
        if (cpArr) {
          const offsets = characterState.ffdOffsets;
          const { scale, offsetX, offsetY } = viewportState;
          let bestIdx = -1;
          let bestDist = 15; // 15 screen-pixel threshold (matches original HTML)

          for (let i = 0; i < cpArr.length; i++) {
            const vp = cpArr[i].point;
            const ox = offsets ? (offsets[i]?.x ?? 0) : 0;
            const oy = offsets ? (offsets[i]?.y ?? 0) : 0;
            // Convert vertex world position to screen position
            const sx = (vp.x + ox) * scale + offsetX;
            const sy = (vp.y + oy) * scale + offsetY;
            const d = Math.sqrt((sx - mx) ** 2 + (sy - my) ** 2);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }

          if (bestIdx >= 0) {
            characterDispatch({ type: 'SET_FFD_SELECTED', index: bestIdx });
            ps.isDragging = true;
            ps.dragJoint = null; // use ffd path instead
            const vp = cpArr[bestIdx].point;
            const ox = offsets ? (offsets[bestIdx]?.x ?? 0) : 0;
            const oy = offsets ? (offsets[bestIdx]?.y ?? 0) : 0;
            ps.dragOffset = v2Sub(V2(vp.x + ox, vp.y + oy), worldPos);
          } else {
            characterDispatch({ type: 'SET_FFD_SELECTED', index: -1 });
          }
          return;
        }
      }

      // --- Add-joint mode: record click position ---
      if (toolState.addJointMode && e.button === 0) {
        toolDispatch({
          type: 'SET_ADD_JOINT_PENDING',
          pending: { position: { x: worldPos.x, y: worldPos.y } },
        });
        return;
      }

      // --- Normal: find joint under cursor ---
      if (e.button === 0) {
        const jointName = findJointAt(worldPos, skeleton);
        if (jointName) {
          characterDispatch({ type: 'SELECT_JOINT', name: jointName });
          const joint = skeleton.joints[jointName];
          ps.isDragging = true;
          ps.dragJoint = jointName;
          ps.dragOffset = v2Sub(joint.current, worldPos);
          // Capture pointer so drag continues even outside the element
          (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
        } else {
          characterDispatch({ type: 'SELECT_JOINT', name: null });
          // Pan on empty space — drag-to-pan when no joint hit
          ps.isPanning = true;
          ps.panStart = viewportActions.startPan(e.clientX, e.clientY);
          (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
        }
      }
    },
    [
      characterState,
      viewportState,
      toolState,
      screenToWorld,
      findJointAt,
      characterDispatch,
      toolDispatch,
      viewportActions,
      isAnimPlaying,
    ],
  );

  // ---------------------------------------------------------------------------
  // Pointer move
  // ---------------------------------------------------------------------------
  const onPointerMove = useCallback(
    (e: PointerEvent, canvasRect: DOMRect) => {
      const ps = stateRef.current;
      const {
        skeleton,
        parsed,
        weights,
        pinnedJoints,
        deformMode,
        squashStretchEnabled,
        mode,
        mesh,
        ffdMode,
        ffdOffsets,
        ffdSelectedVertex,
      } = characterState;
      if (!skeleton || !parsed) return;

      const mx = e.clientX - canvasRect.left;
      const my = e.clientY - canvasRect.top;

      // --- Panning ---
      if (ps.isPanning && ps.panStart) {
        viewportActions.updatePan(e.clientX, e.clientY, ps.panStart);
        return;
      }

      const worldPos = screenToWorld(mx, my);

      // --- FFD dragging ---
      if (ffdMode && ps.isDragging && ps.dragJoint === null && ffdSelectedVertex >= 0) {
        if (ffdOffsets) {
          const cpArr = (mode === 'raster' && mesh)
            ? mesh.vertices
            : parsed.allControlPoints;
          if (cpArr && ffdSelectedVertex < cpArr.length) {
            const targetPos = v2Add(worldPos, ps.dragOffset);
            const vp = cpArr[ffdSelectedVertex].point;
            const newOffsets = [...ffdOffsets];
            newOffsets[ffdSelectedVertex] = V2(
              targetPos.x - vp.x,
              targetPos.y - vp.y,
            );
            characterDispatch({ type: 'SET_FFD_OFFSETS', offsets: newOffsets });
            // Store the computed offsets so the caller (App.tsx handleMove) can
            // eagerly sync charRef before calling applyDeformation().
            lastFfdOffsetsRef.current = newOffsets;
          }
        }
        return;
      }

      // --- Hover detection (when not dragging) ---
      if (!ps.isDragging) {
        const hovered = findJointAt(worldPos, skeleton);
        characterDispatch({ type: 'HOVER_JOINT', name: hovered });
        return;
      }

      // --- Joint dragging ---
      if (ps.isDragging && ps.dragJoint) {
        const targetPos = v2Add(worldPos, ps.dragOffset);
        const editMode = toolState.editMode;

        if (editMode) {
          // In edit mode, only move current — rest is committed on "Apply Rig"
          skeleton.joints[ps.dragJoint].current = V2(targetPos.x, targetPos.y);
          propagateFK(ps.dragJoint, skeleton, true, pinnedJoints, isSpringJoint);
        } else if (deformMode === 'rigid') {
          // Rigid mode: FABRIK IK
          applyRigidDrag(
            ps.dragJoint,
            targetPos,
            skeleton,
            pinnedJoints,
            isSpringJoint,
          );
        } else {
          // Stretch mode: direct position + FK propagation
          // Save pinned positions first
          const savedPinned = new Map<string, { x: number; y: number }>();
          for (const pn of pinnedJoints) {
            const pj = skeleton.joints[pn];
            if (pj) savedPinned.set(pn, { x: pj.current.x, y: pj.current.y });
          }
          skeleton.joints[ps.dragJoint].current = V2(targetPos.x, targetPos.y);
          propagateFK(ps.dragJoint, skeleton, false, pinnedJoints, isSpringJoint);
          // Restore pinned positions
          for (const [pn, pos] of savedPinned) {
            skeleton.joints[pn].current = V2(pos.x, pos.y);
          }
        }

        // Deformation is applied by the caller (handleMove in App.tsx)
        // via applyDeformation() which handles both SVG and raster modes.

        // Track last dragged joint for auto-filter recording
        animDispatch({ type: 'SET_LAST_DRAGGED', joint: ps.dragJoint });
      }
    },
    [
      characterState,
      viewportState,
      toolState,
      screenToWorld,
      findJointAt,
      characterDispatch,
      viewportActions,
      animDispatch,
      isSpringJoint,
    ],
  );

  // ---------------------------------------------------------------------------
  // Pointer up
  // ---------------------------------------------------------------------------
  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const ps = stateRef.current;

      // Release pointer capture
      (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);

      if (ps.isPanning) {
        ps.isPanning = false;
        ps.panStart = null;
        return;
      }

      // Stop weight painting
      if (toolState.weightPaintMode) {
        toolDispatch({ type: 'SET_WP_PAINTING', painting: false });
      }

      // Clear FFD selection on pointer up
      if (characterState.ffdMode && characterState.ffdSelectedVertex >= 0) {
        characterDispatch({ type: 'SET_FFD_SELECTED', index: -1 });
      }

      if (ps.isDragging) {
        ps.isDragging = false;
        ps.dragJoint = null;
        // Undo snapshot capture and keyframe recording are handled by the
        // consuming component, which calls undoRedo.capture() and
        // animation.addKeyframe() after pointer-up.
      }
    },
    [toolState.weightPaintMode, toolDispatch, characterState.ffdMode, characterState.ffdSelectedVertex, characterDispatch],
  );

  // ---------------------------------------------------------------------------
  // Scroll wheel -> zoom toward cursor
  // ---------------------------------------------------------------------------
  const onWheel = useCallback(
    (e: WheelEvent, canvasRect: DOMRect) => {
      e.preventDefault();
      const { parsed } = characterState;
      if (!parsed) return;

      const mx = e.clientX - canvasRect.left;
      const my = e.clientY - canvasRect.top;
      const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;

      viewportActions.zoomBy(
        factor,
        mx,
        my,
        parsed,
        canvasRect.width,
        canvasRect.height,
      );
    },
    [characterState, viewportActions],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    screenToWorld,
    paintWeights,
    /** Expose internal state ref for external read (e.g. cursor style) */
    pointerStateRef: stateRef,
    /** Mutable ref holding the most-recently-computed FFD offsets from a drag.
     *  The caller should read & clear this after onPointerMove to eagerly sync
     *  charRef.current.ffdOffsets before calling applyDeformation(). */
    lastFfdOffsetsRef,
  };
}
