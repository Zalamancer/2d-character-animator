import { useCallback, useRef, useEffect, useState } from 'react';
import { useCharacterContext } from '../contexts/CharacterContext';
import { useViewportContext } from '../contexts/ViewportContext';
import { useToolContext } from '../contexts/ToolContext';
import { useAnimationContext } from '../contexts/AnimationContext';
import { usePointerInteraction } from './usePointerInteraction';
import { useUndoRedo } from './useUndoRedo';
import { SVGParser, RasterParser, MeshGenerator, AutoRigger, SkinWeightCalculator, DeformationEngine, PathReconstructor, PoseManager, V2, BoneRiggingConverter } from '@bonerigging/core';
import { PixiViewport } from '../pixi/PixiViewport';
import type { Pose, SerializedRigData } from '@bonerigging/core';

// ---------------------------------------------------------------------------
// Engine API type — returned by the hook, consumed by all BR* components
// ---------------------------------------------------------------------------

export interface BoneRiggingEngineAPI {
  // DOM refs (components bind to these)
  viewportContainerRef: React.RefObject<HTMLDivElement | null>;
  pixiContainerRef: React.RefObject<HTMLDivElement | null>;
  brushCursorRef: React.RefObject<HTMLDivElement | null>;
  pixiRef: React.RefObject<PixiViewport | null>;

  // File operations
  loadFile: (file: File) => Promise<void>;
  loadCharacterFromUrl: (url: string, name?: string) => Promise<void>;

  // Rig editing
  handleResetPose: () => void;
  handleEditRig: () => void;
  handleApplyRig: () => void;
  handleAddJoint: () => void;
  handleDeleteJoint: () => void;
  handleMirror: () => void;

  // Undo/redo
  handleUndo: () => void;
  handleRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Panel toggles
  handleToggleTimeline: () => void;
  handleTogglePoses: () => void;
  handleToggleWeightPaint: () => void;
  handleToggleFFD: () => void;

  // Weight adjustments
  handleRadiusChange: (boneIndex: number, radius: number) => void;
  handleWeightPaintReset: () => void;
  handleWeightPaintDone: () => void;

  // Animation
  handleAnimRecord: () => void;
  handleAnimAddKeyframe: () => void;
  handleAnimPlay: () => void;
  handleAnimStop: () => void;
  handleAnimSeek: (time: number) => void;
  handleAnimLoadAnimation: (index: number) => void;
  handleAnimDeleteAnimation: (index: number) => void;
  handleAnimExport: () => void;
  handleAnimImport: (json: string) => void;

  // Poses
  showPoses: boolean;
  poses: Pose[];
  handleSavePose: (name: string) => void;
  handleApplyPose: (index: number) => void;
  handleDeletePose: (index: number) => void;
  handleExportPoses: () => void;
  handleImportPoses: (json: string) => void;

  // Zoom
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleZoomReset: () => void;

  // Computed values
  fps: number;
  statusText: string;

  // Serialization — get current rig + animations as SerializedRigData
  getSerializedData: () => SerializedRigData | null;

  // Rendering helpers (needed by Viewport for SVG layer & PixiJS)
  computeTransform: () => { scale: number; offsetX: number; offsetY: number };
  applyDeformation: () => void;
  renderScene: () => void;
  updateScene: () => void;
}

// ---------------------------------------------------------------------------
// The hook — all callback logic extracted from AppInner
// ---------------------------------------------------------------------------

export function useBoneRiggingEngine(): BoneRiggingEngineAPI {
  const { state: charState, dispatch: charDispatch } = useCharacterContext();
  const { state: vpState, dispatch: vpDispatch } = useViewportContext();
  const { state: toolState, dispatch: toolDispatch } = useToolContext();
  const { state: animState, dispatch: animDispatch, managerRef: animManagerRef } = useAnimationContext();

  const pixiRef = useRef<PixiViewport | null>(null);
  const viewportContainerRef = useRef<HTMLDivElement | null>(null);
  const pixiContainerRef = useRef<HTMLDivElement | null>(null);

  // --- Undo/Redo ---
  const undoRedo = useUndoRedo(50);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const weightsDirtyRef = useRef(false);

  // --- Pose Manager ---
  const poseManagerRef = useRef(new PoseManager());
  const [poses, setPoses] = useState<Pose[]>(() => poseManagerRef.current.poses);
  const [showPoses, setShowPoses] = useState(false);

  // --- FPS counter ---
  const [fps, setFps] = useState(0);
  const fpsFrames = useRef(0);
  const fpsLastTime = useRef(performance.now());

  // Refs for mutable state in callbacks (avoids stale closures)
  const charRef = useRef(charState);
  charRef.current = charState;
  const vpRef = useRef(vpState);
  vpRef.current = vpState;
  const toolRef = useRef(toolState);
  toolRef.current = toolState;
  const animRef = useRef(animState);
  animRef.current = animState;

  // Mutable cache for raster deformed positions (not part of React state)
  const deformedPosRef = useRef<{ x: number; y: number }[] | null>(null);

  // Brush cursor for weight painting
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  // Mutable flag for weight painting (avoids stale React state in pointer events)
  const wpPaintingRef = useRef(false);

  // Synchronous transform cache — updated by computeTransform, read by renderScene.
  const transformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });

  // Animation playback RAF
  const playbackRafRef = useRef<number>(0);
  const playbackLastTimeRef = useRef<number>(0);

  // ------ Initialize PixiJS ------
  useEffect(() => {
    const container = pixiContainerRef.current;
    if (!container) return;

    const vp = new PixiViewport();
    pixiRef.current = vp;
    let destroyed = false;

    vp.init(container).then(() => {
      if (destroyed) {
        vp.destroy();
        return;
      }
    });

    return () => {
      destroyed = true;
      if (pixiRef.current) {
        pixiRef.current.destroy();
        pixiRef.current = null;
      }
    };
  }, []);

  // ------ File loading ------
  const loadFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    const isImage = /\.(png|jpg|jpeg|webp|gif|bmp)$/.test(name);

    charDispatch({ type: 'SET_STATUS', text: `Loading ${file.name}...` });

    if (isImage) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const parsed = RasterParser.parse(img);
        const skeleton = AutoRigger.createSkeleton(parsed);
        const mesh = MeshGenerator.generate(parsed.bbox, 20, 30, img.naturalWidth, img.naturalHeight, parsed.alphaGrid);
        const weights = SkinWeightCalculator.compute(mesh.vertices, skeleton, parsed.bbox);
        charDispatch({
          type: 'SET_CHARACTER',
          parsed, skeleton, weights, mesh,
          mode: 'raster',
          rasterImage: img,
        });
        charDispatch({ type: 'SET_STATUS', text: `Loaded ${file.name} — ${Object.keys(skeleton.joints).length} joints, ${skeleton.bones.length} bones` });
      };
      img.src = url;
    } else {
      const text = await file.text();
      const parsed = SVGParser.parse(text);
      const skeleton = AutoRigger.createSkeleton(parsed);
      const weights = SkinWeightCalculator.compute(parsed.allControlPoints, skeleton, parsed.bbox);
      charDispatch({
        type: 'SET_CHARACTER',
        parsed, skeleton, weights, mesh: null,
        mode: 'svg',
        rasterImage: null,
      });
      charDispatch({ type: 'SET_STATUS', text: `Loaded ${file.name} — ${Object.keys(skeleton.joints).length} joints, ${skeleton.bones.length} bones, ${parsed.paths.length} paths` });
    }
  }, [charDispatch]);

  // ------ Load character from URL (for character library) ------
  const loadCharacterFromUrl = useCallback(async (url: string, name?: string) => {
    charDispatch({ type: 'SET_STATUS', text: `Loading ${name || 'character'}...` });
    try {
      const img = await RasterParser.loadFromUrl(url);
      const parsed = RasterParser.parse(img);
      const skeleton = AutoRigger.createSkeleton(parsed);
      const mesh = MeshGenerator.generate(parsed.bbox, 20, 30, img.naturalWidth, img.naturalHeight, parsed.alphaGrid);
      const weights = SkinWeightCalculator.compute(mesh.vertices, skeleton, parsed.bbox);
      charDispatch({
        type: 'SET_CHARACTER',
        parsed, skeleton, weights, mesh,
        mode: 'raster',
        rasterImage: img,
      });
      charDispatch({ type: 'SET_STATUS', text: `Loaded ${name || 'character'} — ${Object.keys(skeleton.joints).length} joints, ${skeleton.bones.length} bones` });
    } catch (err) {
      charDispatch({ type: 'SET_STATUS', text: `Failed to load character: ${err instanceof Error ? err.message : 'unknown error'}` });
    }
  }, [charDispatch]);

  // ------ Transform computation ------
  const computeTransform = useCallback(() => {
    const { parsed } = charRef.current;
    const container = viewportContainerRef.current;
    if (!parsed || !container) return { scale: 1, offsetX: 0, offsetY: 0 };

    const rect = container.getBoundingClientRect();
    const vb = parsed.viewBox;
    const padding = 40;
    const availW = rect.width - padding * 2;
    const availH = rect.height - padding * 2;
    const scaleX = availW / vb.w;
    const scaleY = availH / vb.h;
    const baseScale = Math.min(scaleX, scaleY);
    const baseOffsetX = (rect.width - vb.w * baseScale) / 2 - vb.x * baseScale;
    const baseOffsetY = (rect.height - vb.h * baseScale) / 2 - vb.y * baseScale;

    const { zoom, panX, panY } = vpRef.current;
    const finalScale = baseScale * zoom;
    const finalOffsetX = baseOffsetX * zoom + panX;
    const finalOffsetY = baseOffsetY * zoom + panY;

    transformRef.current = { scale: finalScale, offsetX: finalOffsetX, offsetY: finalOffsetY };
    vpDispatch({ type: 'SET_TRANSFORM', scale: finalScale, offsetX: finalOffsetX, offsetY: finalOffsetY });
    return transformRef.current;
  }, [vpDispatch]);

  // ------ Deformation pipeline ------
  const applyDeformation = useCallback(() => {
    const { skeleton, parsed, weights, mode, mesh, squashStretchEnabled, ffdOffsets } = charRef.current;
    if (!skeleton || !parsed || !weights) return;

    // In edit mode the mesh must stay at rest — no deformation ever
    if (toolRef.current.editMode) {
      if (mode === 'svg') {
        // Restore SVG paths to their original (rest) control points
        const rest = parsed.allControlPoints.map(cp => cp.point);
        const reconstructed = PathReconstructor.reconstructPaths(parsed, rest);
        for (const { element, d } of reconstructed) {
          if (element) element.setAttribute('d', d);
        }
      }
      if (mode === 'raster' && mesh) {
        // Reset deformed positions to rest vertex positions
        if (!deformedPosRef.current || deformedPosRef.current.length !== mesh.vertices.length) {
          deformedPosRef.current = mesh.vertices.map(v => V2(v.point.x, v.point.y));
        } else {
          for (let i = 0; i < mesh.vertices.length; i++) {
            deformedPosRef.current[i] = V2(mesh.vertices[i].point.x, mesh.vertices[i].point.y);
          }
        }
      }
      return;
    }

    const boneData = DeformationEngine.computeBoneData(skeleton, squashStretchEnabled);

    if (mode === 'svg') {
      const deformed = DeformationEngine.deformControlPoints(
        parsed.allControlPoints, weights, boneData, squashStretchEnabled
      );
      if (ffdOffsets) {
        for (let i = 0; i < deformed.length && i < ffdOffsets.length; i++) {
          deformed[i] = V2(deformed[i].x + ffdOffsets[i].x, deformed[i].y + ffdOffsets[i].y);
        }
      }
      const reconstructed = PathReconstructor.reconstructPaths(parsed, deformed);
      for (const { element, d } of reconstructed) {
        if (element) element.setAttribute('d', d);
      }
    }

    if (mode === 'raster' && mesh) {
      if (!deformedPosRef.current || deformedPosRef.current.length !== mesh.vertices.length) {
        deformedPosRef.current = mesh.vertices.map(v => V2(v.point.x, v.point.y));
      }
      const out = deformedPosRef.current;
      DeformationEngine.deformInPlace(mesh.vertices, weights, boneData, out, squashStretchEnabled);

      if (ffdOffsets) {
        for (let i = 0; i < out.length && i < ffdOffsets.length; i++) {
          out[i].x += ffdOffsets[i].x;
          out[i].y += ffdOffsets[i].y;
        }
      }
    }
  }, []);

  // ------ Rendering ------
  const renderScene = useCallback(() => {
    const pixi = pixiRef.current;
    if (!pixi) return;

    const { skeleton, parsed, weights, mode, mesh, selectedJoint, hoveredJoint, pinnedJoints } = charRef.current;
    const { showBones, showMesh, showWeights, showLabels } = vpRef.current;
    const { editMode } = toolRef.current;

    if (!skeleton || !parsed) return;

    const transform = transformRef.current;

    pixi.render({
      skeleton,
      parsed,
      transform,
      weights,
      selectedJoint,
      hoveredJoint,
      pinnedJoints,
      showBones,
      showMesh,
      showWeights,
      showLabels,
      editMode,
      mode,
      mesh,
      rasterDeformed: deformedPosRef.current || null,
      rasterImage: charRef.current.rasterImage,
    });

    // FPS counter
    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsLastTime.current >= 1000) {
      setFps(fpsFrames.current);
      fpsFrames.current = 0;
      fpsLastTime.current = now;
    }
  }, []);

  // ------ Recompute + render helper ------
  const updateScene = useCallback(() => {
    computeTransform();
    applyDeformation();
    renderScene();
  }, [computeTransform, applyDeformation, renderScene]);

  // ------ Undo/Redo helpers ------
  const captureUndoSnapshot = useCallback(() => {
    const { skeleton, pinnedJoints, weights, ffdOffsets } = charRef.current;
    if (!skeleton) return;
    undoRedo.capture(skeleton, pinnedJoints, weights, ffdOffsets, weightsDirtyRef.current);
    weightsDirtyRef.current = false;
    setCanUndo(undoRedo.canUndo());
    setCanRedo(undoRedo.canRedo());
  }, [undoRedo]);

  const handleUndo = useCallback(() => {
    const snapshot = undoRedo.undo();
    if (!snapshot) return;
    const { skeleton } = charRef.current;
    if (!skeleton) return;
    const result = undoRedo.applySnapshot(snapshot, skeleton);
    charDispatch({ type: 'SET_PINNED', pinned: result.pinnedJoints });
    if (result.weights) {
      charDispatch({ type: 'UPDATE_WEIGHTS', weights: result.weights });
      charRef.current = { ...charRef.current, weights: result.weights };
    }
    if (result.ffdOffsets) {
      charDispatch({ type: 'SET_FFD_OFFSETS', offsets: result.ffdOffsets });
      charRef.current = { ...charRef.current, ffdOffsets: result.ffdOffsets };
    }
    deformedPosRef.current = null;
    setCanUndo(undoRedo.canUndo());
    setCanRedo(undoRedo.canRedo());
    updateScene();
    charDispatch({ type: 'SET_STATUS', text: 'Undo' });
  }, [undoRedo, charDispatch, updateScene]);

  const handleRedo = useCallback(() => {
    const snapshot = undoRedo.redo();
    if (!snapshot) return;
    const { skeleton } = charRef.current;
    if (!skeleton) return;
    const result = undoRedo.applySnapshot(snapshot, skeleton);
    charDispatch({ type: 'SET_PINNED', pinned: result.pinnedJoints });
    if (result.weights) {
      charDispatch({ type: 'UPDATE_WEIGHTS', weights: result.weights });
      charRef.current = { ...charRef.current, weights: result.weights };
    }
    if (result.ffdOffsets) {
      charDispatch({ type: 'SET_FFD_OFFSETS', offsets: result.ffdOffsets });
      charRef.current = { ...charRef.current, ffdOffsets: result.ffdOffsets };
    }
    deformedPosRef.current = null;
    setCanUndo(undoRedo.canUndo());
    setCanRedo(undoRedo.canRedo());
    updateScene();
    charDispatch({ type: 'SET_STATUS', text: 'Redo' });
  }, [undoRedo, charDispatch, updateScene]);

  // ------ Viewport action helpers for pointer interaction ------
  const viewportActions = useRef({
    startPan: (clientX: number, clientY: number) => {
      const vp = vpRef.current;
      return { startX: clientX, startY: clientY, startPanX: vp.panX, startPanY: vp.panY };
    },
    updatePan: (clientX: number, clientY: number, panStart: { startX: number; startY: number; startPanX: number; startPanY: number }) => {
      const dx = clientX - panStart.startX;
      const dy = clientY - panStart.startY;
      vpDispatch({ type: 'PAN', panX: panStart.startPanX + dx, panY: panStart.startPanY + dy });
    },
    zoomBy: (factor: number, _cursorX?: number, _cursorY?: number) => {
      const vp = vpRef.current;
      vpDispatch({ type: 'ZOOM', zoom: vp.zoom * factor });
    },
  }).current;

  // ------ Pointer interaction hook ------
  const pointer = usePointerInteraction(
    charState,
    charDispatch,
    vpState,
    viewportActions,
    toolState,
    toolDispatch,
    animDispatch,
    animState.isPlaying,
  );

  // ------ Attach pointer events to viewport ------
  useEffect(() => {
    const el = viewportContainerRef.current;
    if (!el) return;

    const getRect = () => el.getBoundingClientRect();

    const handleDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.panel, .timeline-panel, .joint-popover')) return;

      if (e.button === 2) {
        e.preventDefault();
        const { skeleton } = charRef.current;
        if (!skeleton) return;
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const { scale, offsetX, offsetY } = vpRef.current;
        const worldX = scale > 0 ? (mx - offsetX) / scale : mx;
        const worldY = scale > 0 ? (my - offsetY) / scale : my;
        let closest: string | null = null;
        let closestDist = scale > 0 ? 12 / scale : 12;
        for (const [name, joint] of Object.entries(skeleton.joints)) {
          const dx = worldX - joint.current.x;
          const dy = worldY - joint.current.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < closestDist) {
            closestDist = d;
            closest = name;
          }
        }
        if (closest) {
          captureUndoSnapshot();
          charDispatch({ type: 'TOGGLE_PIN', joint: closest });
          const wasPinned = charRef.current.pinnedJoints.has(closest);
          charDispatch({ type: 'SET_STATUS', text: wasPinned ? `Unpinned ${closest}` : `Pinned ${closest}` });
          requestAnimationFrame(() => renderScene());
        }
        return;
      }

      if (e.button === 0 && charRef.current.skeleton) {
        captureUndoSnapshot();
      }

      if (toolRef.current.weightPaintMode && e.button === 0 && !e.altKey) {
        wpPaintingRef.current = true;
        (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
        const rect = getRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const newWeights = pointer.paintWeights(mx, my, rect, charRef.current.weights);
        if (newWeights) {
          charDispatch({ type: 'UPDATE_WEIGHTS', weights: newWeights });
          charRef.current = { ...charRef.current, weights: newWeights };
          weightsDirtyRef.current = true;
          deformedPosRef.current = null;
          applyDeformation();
          renderScene();
        }
        return;
      }

      pointer.onPointerDown(e, getRect());
    };
    const handleMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.panel, .timeline-panel, .joint-popover')) return;

      if (toolRef.current.weightPaintMode && brushCursorRef.current) {
        const rect = getRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const r = toolRef.current.wpState.radius;
        const cursor = brushCursorRef.current;
        cursor.style.display = 'block';
        cursor.style.left = `${mx - r}px`;
        cursor.style.top = `${my - r}px`;
        cursor.style.width = `${r * 2}px`;
        cursor.style.height = `${r * 2}px`;
      }

      if (toolRef.current.weightPaintMode && wpPaintingRef.current) {
        const rect = getRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const newWeights = pointer.paintWeights(mx, my, rect, charRef.current.weights);
        if (newWeights) {
          charDispatch({ type: 'UPDATE_WEIGHTS', weights: newWeights });
          charRef.current = { ...charRef.current, weights: newWeights };
          weightsDirtyRef.current = true;
          deformedPosRef.current = null;
          applyDeformation();
        }
        renderScene();
        return;
      }

      pointer.onPointerMove(e, getRect());

      const pendingFfdOffsets = pointer.lastFfdOffsetsRef.current;
      if (pendingFfdOffsets) {
        charRef.current = { ...charRef.current, ffdOffsets: pendingFfdOffsets };
        pointer.lastFfdOffsetsRef.current = null;
      }

      if (!toolRef.current.editMode) applyDeformation();
      renderScene();
    };
    const handleUp = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.joint-popover')) return;

      if (wpPaintingRef.current) {
        wpPaintingRef.current = false;
        (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
        renderScene();
        return;
      }

      const wasDragging = pointer.pointerStateRef.current.isDragging;
      pointer.onPointerUp(e);
      if (!toolRef.current.editMode) applyDeformation();
      renderScene();

      if (wasDragging) {
        setCanUndo(undoRedo.canUndo());
        setCanRedo(undoRedo.canRedo());

        if (animRef.current.isRecording && charRef.current.skeleton) {
          const mgr = animManagerRef.current;
          const filter = animRef.current.autoFilterRecord && animRef.current.lastDraggedJoint
            ? new Set([animRef.current.lastDraggedJoint])
            : (animRef.current.recordBoneFilter.size > 0 ? animRef.current.recordBoneFilter : null);
          mgr.addKeyframe(charRef.current.skeleton, charRef.current.pinnedJoints, undefined, filter);
          if (mgr.currentAnimation) {
            animDispatch({ type: 'SET_DURATION', duration: mgr.currentAnimation.duration });
            animDispatch({ type: 'SET_TIME', time: mgr.currentTime });
          }
        }
      }
    };
    const handleWheel = (e: WheelEvent) => {
      pointer.onWheel(e, getRect());
    };
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    el.addEventListener('pointerdown', handleDown);
    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerup', handleUp);
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('contextmenu', handleContextMenu);

    return () => {
      el.removeEventListener('pointerdown', handleDown);
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerup', handleUp);
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [pointer, applyDeformation, renderScene, charDispatch, captureUndoSnapshot, undoRedo, animDispatch, animManagerRef]);

  // ------ Keyboard shortcuts ------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
          ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !toolRef.current.editMode && !isInput) {
        e.preventDefault();
        handleAnimRecord();
        return;
      }
      if (e.key === ' ' && !toolRef.current.editMode && !isInput) {
        e.preventDefault();
        if (animRef.current.isRecording) {
          handleAnimAddKeyframe();
        } else if (animRef.current.isPlaying) {
          handleAnimStop();
        } else if (animManagerRef.current.animations.length > 0) {
          handleAnimPlay();
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && toolRef.current.editMode && !isInput) {
        e.preventDefault();
        handleDeleteJoint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleUndo, handleRedo]);

  // ------ Effects ------

  // Recompute on character load
  useEffect(() => {
    if (charState.parsed && charState.skeleton) {
      requestAnimationFrame(() => {
        computeTransform();
        applyDeformation();
        renderScene();
      });
    }
  }, [charState.parsed, charState.skeleton, computeTransform, applyDeformation, renderScene]);

  // Recompute on viewport changes or deformation settings
  useEffect(() => {
    if (charState.parsed) {
      computeTransform();
      applyDeformation();
      renderScene();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vpState.zoom, vpState.panX, vpState.panY, vpState.showBones, vpState.showMesh, vpState.showWeights, vpState.showLabels, charState.squashStretchEnabled]);

  // Re-render when selection/hover changes
  useEffect(() => {
    if (charState.parsed) {
      renderScene();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charState.selectedJoint, charState.hoveredJoint, charState.pinnedJoints, toolState.editMode]);

  // Resize handler
  useEffect(() => {
    const onResize = () => {
      if (charRef.current.parsed) {
        computeTransform();
        renderScene();
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [computeTransform, renderScene]);

  // ------ Toolbar callbacks ------
  const handleResetPose = useCallback(() => {
    const { skeleton } = charRef.current;
    if (!skeleton) return;
    captureUndoSnapshot();
    for (const j of Object.values(skeleton.joints)) {
      j.current = V2(j.rest.x, j.rest.y);
    }
    charDispatch({ type: 'SET_PINNED', pinned: new Set() });
    charDispatch({ type: 'SET_STATUS', text: 'Pose reset to rest position' });
    updateScene();
  }, [charDispatch, updateScene, captureUndoSnapshot]);

  const handleEditRig = useCallback(() => {
    if (toolState.editMode) return;
    captureUndoSnapshot();
    // Reset pose to rest position before entering edit mode
    const { skeleton } = charRef.current;
    if (skeleton) {
      for (const j of Object.values(skeleton.joints)) {
        j.current = V2(j.rest.x, j.rest.y);
      }
      charDispatch({ type: 'SET_PINNED', pinned: new Set() });
    }
    toolDispatch({ type: 'ENTER_EDIT_MODE' });
    updateScene();
    charDispatch({ type: 'SET_STATUS', text: 'Edit mode — modify skeleton, then click Apply' });
  }, [toolState.editMode, toolDispatch, charDispatch, captureUndoSnapshot, updateScene]);

  const handleApplyRig = useCallback(() => {
    const { skeleton, parsed } = charRef.current;
    if (!skeleton || !parsed) return;

    for (const joint of Object.values(skeleton.joints)) {
      joint.rest = V2(joint.current.x, joint.current.y);
    }

    for (const bone of skeleton.bones) {
      const head = skeleton.joints[bone.from];
      const tail = skeleton.joints[bone.to];
      if (head && tail) {
        bone.restAngle = Math.atan2(tail.rest.y - head.rest.y, tail.rest.x - head.rest.x);
        bone.restLength = Math.sqrt(
          (tail.rest.x - head.rest.x) ** 2 + (tail.rest.y - head.rest.y) ** 2
        );
      }
    }

    const weights = SkinWeightCalculator.compute(
      charRef.current.mode === 'raster' && charRef.current.mesh
        ? charRef.current.mesh.vertices
        : parsed.allControlPoints,
      skeleton, parsed.bbox
    );
    charDispatch({ type: 'UPDATE_WEIGHTS', weights });
    charRef.current = { ...charRef.current, weights };
    deformedPosRef.current = null;
    toolDispatch({ type: 'EXIT_EDIT_MODE' });
    charDispatch({ type: 'SET_STATUS', text: 'Rig applied — weights recalculated' });
    updateScene();
  }, [charDispatch, toolDispatch, updateScene]);

  // ------ Add Joint ------
  const handleAddJoint = useCallback(() => {
    toolDispatch({ type: 'TOGGLE_ADD_JOINT', enabled: !toolState.addJointMode });
  }, [toolDispatch, toolState.addJointMode]);

  // Process add-joint pending click
  useEffect(() => {
    const pending = toolState.addJointPending;
    if (!pending || !toolState.addJointMode) return;

    const { skeleton } = charRef.current;
    if (!skeleton) return;

    const pos = pending.position;
    let parentName = charRef.current.selectedJoint;
    if (!parentName) {
      let closest: string | null = null;
      let closestDist = Infinity;
      for (const [name, joint] of Object.entries(skeleton.joints)) {
        const dx = pos.x - joint.current.x;
        const dy = pos.y - joint.current.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < closestDist) {
          closestDist = d;
          closest = name;
        }
      }
      parentName = closest;
    }
    if (!parentName) return;

    let newName = `custom_${Object.keys(skeleton.joints).length}`;
    let counter = 0;
    while (skeleton.joints[newName]) {
      counter++;
      newName = `custom_${Object.keys(skeleton.joints).length + counter}`;
    }

    captureUndoSnapshot();

    skeleton.joints[newName] = {
      rest: V2(pos.x, pos.y),
      current: V2(pos.x, pos.y),
      parent: parentName,
      name: newName,
    };

    const parentJoint = skeleton.joints[parentName];
    const dx = pos.x - parentJoint.rest.x;
    const dy = pos.y - parentJoint.rest.y;
    const restLen = Math.sqrt(dx * dx + dy * dy);
    const restAngle = Math.atan2(dy, dx);

    skeleton.bones.push({
      name: `bone_${newName}`,
      from: parentName,
      to: newName,
      index: skeleton.bones.length,
      restAngle,
      restLength: restLen,
      radiusMul: 1.0,
    } as any);

    const { parsed } = charRef.current;
    if (parsed) {
      const weights = SkinWeightCalculator.compute(
        charRef.current.mode === 'raster' && charRef.current.mesh
          ? charRef.current.mesh.vertices
          : parsed.allControlPoints,
        skeleton, parsed.bbox
      );
      charDispatch({ type: 'UPDATE_WEIGHTS', weights });
    }

    charDispatch({ type: 'SELECT_JOINT', name: newName });
    charDispatch({ type: 'SET_STATUS', text: `Added joint "${newName}" → parent "${parentName}"` });
    toolDispatch({ type: 'SET_ADD_JOINT_PENDING', pending: null });
    updateScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolState.addJointPending]);

  // ------ Delete Joint ------
  const handleDeleteJoint = useCallback(() => {
    const { skeleton, selectedJoint, parsed } = charRef.current;
    if (!skeleton || !selectedJoint) {
      charDispatch({ type: 'SET_STATUS', text: 'No joint selected to delete' });
      return;
    }
    if (selectedJoint === 'hips') {
      charDispatch({ type: 'SET_STATUS', text: 'Cannot delete root joint' });
      return;
    }

    captureUndoSnapshot();

    const parentBone = skeleton.bones.find(b => b.to === selectedJoint);
    const parentName = parentBone ? parentBone.from : null;
    const childBones = skeleton.bones.filter(b => b.from === selectedJoint);

    for (const childBone of childBones) {
      if (parentName) {
        childBone.from = parentName;
        const childJoint = skeleton.joints[childBone.to];
        if (childJoint) childJoint.parent = parentName;
        const head = skeleton.joints[parentName];
        const tail = skeleton.joints[childBone.to];
        if (head && tail) {
          childBone.restAngle = Math.atan2(tail.rest.y - head.rest.y, tail.rest.x - head.rest.x);
          childBone.restLength = Math.sqrt(
            (tail.rest.x - head.rest.x) ** 2 + (tail.rest.y - head.rest.y) ** 2
          );
        }
      }
    }

    const toRemove = skeleton.bones.filter(b => b.to === selectedJoint);
    for (const bone of toRemove) {
      const idx = skeleton.bones.indexOf(bone);
      if (idx >= 0) skeleton.bones.splice(idx, 1);
    }
    if (!parentName) {
      for (const childBone of childBones) {
        const idx = skeleton.bones.indexOf(childBone);
        if (idx >= 0) skeleton.bones.splice(idx, 1);
      }
    }

    skeleton.bones.forEach((b, i) => { b.index = i; });
    delete skeleton.joints[selectedJoint];

    const newPinned = new Set(charRef.current.pinnedJoints);
    newPinned.delete(selectedJoint);
    charDispatch({ type: 'SET_PINNED', pinned: newPinned });

    if (parsed) {
      const weights = SkinWeightCalculator.compute(
        charRef.current.mode === 'raster' && charRef.current.mesh
          ? charRef.current.mesh.vertices
          : parsed.allControlPoints,
        skeleton, parsed.bbox
      );
      charDispatch({ type: 'UPDATE_WEIGHTS', weights });
    }

    charDispatch({ type: 'SELECT_JOINT', name: null });
    charDispatch({ type: 'SET_STATUS', text: `Deleted joint "${selectedJoint}"` });
    updateScene();
  }, [charDispatch, updateScene, captureUndoSnapshot]);

  // ------ Mirror L->R ------
  const handleMirror = useCallback(() => {
    const { skeleton, parsed, weights } = charRef.current;
    if (!skeleton) return;

    captureUndoSnapshot();
    const cx = parsed?.bbox.cx ?? 0;

    // 1) Mirror joint positions
    for (const [name, joint] of Object.entries(skeleton.joints)) {
      if (!name.startsWith('left')) continue;
      const rightName = 'right' + name.slice(4);
      const rightJoint = skeleton.joints[rightName];
      if (!rightJoint) continue;
      const mirrorX = cx + (cx - joint.current.x);
      rightJoint.current = V2(mirrorX, joint.current.y);
    }

    // 2) Mirror bone radiusMul from left → right
    const boneNameToIndex: Record<string, number> = {};
    for (let i = 0; i < skeleton.bones.length; i++) {
      boneNameToIndex[skeleton.bones[i].name] = i;
    }
    for (const bone of skeleton.bones) {
      if (!bone.name.startsWith('left')) continue;
      const rightBoneName = 'right' + bone.name.slice(4);
      const rightIdx = boneNameToIndex[rightBoneName];
      if (rightIdx === undefined) continue;
      skeleton.bones[rightIdx].radiusMul = bone.radiusMul;
    }

    // 3) Mirror weights — copy left bone weights to their right counterparts per vertex
    if (weights) {
      const newWeights = weights.map((vertexWeights) =>
        vertexWeights.map((bw) => {
          if (!bw.boneName.startsWith('left')) return { ...bw };
          const rightBoneName = 'right' + bw.boneName.slice(4);
          const rightIdx = boneNameToIndex[rightBoneName];
          if (rightIdx === undefined) return { ...bw };
          // Find if this vertex already has a weight for the right bone
          return { ...bw }; // keep left as-is; we patch right below
        })
      );
      // For each vertex, overwrite right-bone weights with left-bone values
      for (let vi = 0; vi < newWeights.length; vi++) {
        const vw = newWeights[vi];
        // Build map of left bone weights in this vertex
        const leftWeights: Record<string, { weight: number; t: number }> = {};
        for (const bw of vw) {
          if (bw.boneName.startsWith('left')) {
            const rightBoneName = 'right' + bw.boneName.slice(4);
            if (boneNameToIndex[rightBoneName] !== undefined) {
              leftWeights[rightBoneName] = { weight: bw.weight, t: bw.t };
            }
          }
        }
        // Apply: for each right bone weight entry, copy from left
        for (const bw of vw) {
          if (leftWeights[bw.boneName]) {
            bw.weight = leftWeights[bw.boneName].weight;
            bw.t = leftWeights[bw.boneName].t;
          }
        }
      }
      charDispatch({ type: 'UPDATE_WEIGHTS', weights: newWeights });
    }

    charDispatch({ type: 'SET_STATUS', text: 'Mirrored left → right (positions + weights)' });
    updateScene();
  }, [charDispatch, updateScene, captureUndoSnapshot]);

  // ------ Weight Paint callbacks ------
  const handleWeightPaintReset = useCallback(() => {
    const { skeleton, parsed } = charRef.current;
    if (!skeleton || !parsed) return;
    captureUndoSnapshot();
    const weights = SkinWeightCalculator.compute(
      charRef.current.mode === 'raster' && charRef.current.mesh
        ? charRef.current.mesh.vertices
        : parsed.allControlPoints,
      skeleton, parsed.bbox
    );
    charDispatch({ type: 'UPDATE_WEIGHTS', weights });
    weightsDirtyRef.current = false;
    charDispatch({ type: 'SET_STATUS', text: 'Weights reset to automatic' });
    updateScene();
  }, [charDispatch, updateScene, captureUndoSnapshot]);

  const handleWeightPaintDone = useCallback(() => {
    toolDispatch({ type: 'EXIT_WEIGHT_PAINT' });
    charDispatch({ type: 'SET_STATUS', text: 'Weight paint mode exited' });
  }, [toolDispatch, charDispatch]);

  // ------ Bone radius change (WeightPanel) ------
  const handleRadiusChange = useCallback((boneIndex: number, radius: number) => {
    const { skeleton, parsed } = charRef.current;
    if (!skeleton) return;
    const bone = skeleton.bones[boneIndex];
    if (!bone) return;
    bone.radiusMul = radius;

    if (parsed) {
      const weights = SkinWeightCalculator.compute(
        charRef.current.mode === 'raster' && charRef.current.mesh
          ? charRef.current.mesh.vertices
          : parsed.allControlPoints,
        skeleton, parsed.bbox
      );
      charDispatch({ type: 'UPDATE_WEIGHTS', weights });
      charRef.current = { ...charRef.current, weights };
    }
    updateScene();
  }, [charDispatch, updateScene]);

  // ------ Mesh density change (raster mode) ------
  useEffect(() => {
    if (charState.mode !== 'raster' || !charState.parsed || !charState.skeleton || !charState.rasterImage) return;
    const img = charState.rasterImage;
    const parsed = charState.parsed;
    const skeleton = charState.skeleton;

    const rp = parsed as any;
    const mesh = MeshGenerator.generate(
      parsed.bbox,
      vpState.meshDensity, vpState.meshDensity * 1.5,
      img.naturalWidth, img.naturalHeight,
      rp.alphaGrid
    );
    const weights = SkinWeightCalculator.compute(mesh.vertices, skeleton, parsed.bbox);
    charDispatch({ type: 'UPDATE_MESH', mesh });
    charDispatch({ type: 'UPDATE_WEIGHTS', weights });

    charRef.current = { ...charRef.current, mesh, weights };
    deformedPosRef.current = null;
    updateScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vpState.meshDensity]);

  // ------ Timeline / Animation callbacks ------
  const handleToggleTimeline = useCallback(() => {
    animDispatch({ type: 'TOGGLE_TIMELINE', show: !animState.showTimeline });
  }, [animState.showTimeline, animDispatch]);

  const handleTogglePoses = useCallback(() => {
    setShowPoses(prev => !prev);
  }, []);

  const handleAnimRecord = useCallback(() => {
    const mgr = animManagerRef.current;
    if (animState.isRecording) {
      mgr.stopRecording();
      animDispatch({ type: 'STOP_RECORDING' });
      charDispatch({ type: 'SET_STATUS', text: 'Recording stopped' });
    } else {
      mgr.startRecording('Animation ' + (mgr.animations.length + 1));
      animDispatch({ type: 'START_RECORDING' });
      charDispatch({ type: 'SET_STATUS', text: 'Recording — drag joints to create keyframes, Space to add keyframe, R to stop' });
    }
  }, [animState.isRecording, animDispatch, charDispatch, animManagerRef]);

  const handleAnimAddKeyframe = useCallback(() => {
    const { skeleton, pinnedJoints } = charRef.current;
    if (!skeleton) return;
    const mgr = animManagerRef.current;
    const filter = animRef.current.recordBoneFilter.size > 0 ? animRef.current.recordBoneFilter : null;
    mgr.addKeyframe(skeleton, pinnedJoints, undefined, filter);
    if (mgr.currentAnimation) {
      animDispatch({ type: 'SET_DURATION', duration: mgr.currentAnimation.duration });
      animDispatch({ type: 'SET_TIME', time: mgr.currentTime });
    }
    charDispatch({ type: 'SET_STATUS', text: 'Keyframe added' });
  }, [animDispatch, charDispatch, animManagerRef]);

  const handleAnimPlay = useCallback(() => {
    const mgr = animManagerRef.current;
    if (animState.isPlaying) {
      mgr.pause();
      animDispatch({ type: 'PAUSE' });
      if (playbackRafRef.current) {
        cancelAnimationFrame(playbackRafRef.current);
        playbackRafRef.current = 0;
      }
      return;
    }

    if (!mgr.currentAnimation && mgr.animations.length > 0) {
      mgr.play(0);
    } else if (mgr.currentAnimation) {
      mgr.resume();
    } else {
      return;
    }

    animDispatch({ type: 'PLAY' });
    playbackLastTimeRef.current = performance.now();

    const tick = (now: number) => {
      if (!animRef.current.isPlaying) return;

      const dt = (now - playbackLastTimeRef.current) / 1000;
      playbackLastTimeRef.current = now;

      const m = animManagerRef.current;
      if (!m.currentAnimation || !m.isPlaying) {
        animDispatch({ type: 'STOP' });
        return;
      }

      m.currentTime += dt * m.playbackSpeed;

      if (m.currentTime >= m.currentAnimation.duration) {
        if (m.loop) {
          m.currentTime = 0;
        } else {
          m.currentTime = m.currentAnimation.duration;
          m.isPlaying = false;
          animDispatch({ type: 'STOP' });
          charDispatch({ type: 'SET_STATUS', text: 'Playback finished' });
          return;
        }
      }

      const pose = m.getInterpolatedPose(m.currentAnimation, m.currentTime);
      if (pose) {
        const { skeleton } = charRef.current;
        if (skeleton) {
          for (const j of Object.values(skeleton.joints)) {
            j.current = V2(j.rest.x, j.rest.y);
          }
          for (const [jn, d] of Object.entries(pose.deltas)) {
            const j = skeleton.joints[jn];
            if (j) j.current = V2(j.rest.x + d.x, j.rest.y + d.y);
          }
        }
      }

      animDispatch({ type: 'SET_TIME', time: m.currentTime });
      updateScene();
      playbackRafRef.current = requestAnimationFrame(tick);
    };

    playbackRafRef.current = requestAnimationFrame(tick);
  }, [animState.isPlaying, animDispatch, charDispatch, animManagerRef, updateScene]);

  const handleAnimStop = useCallback(() => {
    const mgr = animManagerRef.current;
    if (animState.isRecording) {
      mgr.stopRecording();
      animDispatch({ type: 'STOP_RECORDING' });
    }
    mgr.stop();
    animDispatch({ type: 'STOP' });
    if (playbackRafRef.current) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = 0;
    }
    const { skeleton } = charRef.current;
    if (skeleton) {
      for (const j of Object.values(skeleton.joints)) {
        j.current = V2(j.rest.x, j.rest.y);
      }
    }
    updateScene();
    charDispatch({ type: 'SET_STATUS', text: 'Stopped' });
  }, [animState.isRecording, animDispatch, charDispatch, animManagerRef, updateScene]);

  const handleAnimSeek = useCallback((time: number) => {
    const mgr = animManagerRef.current;
    mgr.seekTo(time);
    animDispatch({ type: 'SET_TIME', time: mgr.currentTime });

    if (mgr.currentAnimation) {
      const pose = mgr.getInterpolatedPose(mgr.currentAnimation, mgr.currentTime);
      if (pose) {
        const { skeleton } = charRef.current;
        if (skeleton) {
          for (const j of Object.values(skeleton.joints)) {
            j.current = V2(j.rest.x, j.rest.y);
          }
          for (const [jn, d] of Object.entries(pose.deltas)) {
            const j = skeleton.joints[jn];
            if (j) j.current = V2(j.rest.x + d.x, j.rest.y + d.y);
          }
        }
      }
    }
    updateScene();
  }, [animDispatch, animManagerRef, updateScene]);

  const handleAnimLoadAnimation = useCallback((index: number) => {
    const mgr = animManagerRef.current;
    if (mgr.play(index)) {
      mgr.pause();
      animDispatch({ type: 'SET_TIME', time: 0 });
      animDispatch({ type: 'SET_DURATION', duration: mgr.currentAnimation?.duration ?? 0 });
      charDispatch({ type: 'SET_STATUS', text: `Loaded animation "${mgr.animations[index]?.name}"` });
    }
  }, [animDispatch, charDispatch, animManagerRef]);

  const handleAnimDeleteAnimation = useCallback((index: number) => {
    const mgr = animManagerRef.current;
    const name = mgr.animations[index]?.name ?? '';
    mgr.remove(index);
    charDispatch({ type: 'SET_STATUS', text: `Deleted animation "${name}"` });
  }, [charDispatch, animManagerRef]);

  const handleAnimExport = useCallback(() => {
    const mgr = animManagerRef.current;
    const json = mgr.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'animations.json';
    a.click();
    URL.revokeObjectURL(url);
    charDispatch({ type: 'SET_STATUS', text: 'Animations exported' });
  }, [charDispatch, animManagerRef]);

  const handleAnimImport = useCallback((jsonStr: string) => {
    const mgr = animManagerRef.current;
    const count = mgr.importJSON(jsonStr);
    if (count >= 0) {
      charDispatch({ type: 'SET_STATUS', text: `Imported ${count} animation(s)` });
    } else {
      charDispatch({ type: 'SET_STATUS', text: 'Failed to import animations' });
    }
  }, [charDispatch, animManagerRef]);

  // ------ Pose callbacks ------
  const handleSavePose = useCallback((name: string) => {
    const { skeleton, pinnedJoints } = charRef.current;
    if (!skeleton) return;
    poseManagerRef.current.save(name, skeleton, pinnedJoints);
    setPoses([...poseManagerRef.current.poses]);
    charDispatch({ type: 'SET_STATUS', text: `Saved pose "${name}"` });
  }, [charDispatch]);

  const handleApplyPose = useCallback((index: number) => {
    const { skeleton } = charRef.current;
    if (!skeleton) return;
    captureUndoSnapshot();
    const result = poseManagerRef.current.apply(index, skeleton);
    if (result) {
      charDispatch({ type: 'SET_PINNED', pinned: new Set(result.pinned) });
      charDispatch({ type: 'SET_STATUS', text: `Applied pose (${result.skipped} joints skipped)` });
    }
    updateScene();
  }, [charDispatch, updateScene, captureUndoSnapshot]);

  const handleDeletePose = useCallback((index: number) => {
    const name = poseManagerRef.current.poses[index]?.name ?? '';
    poseManagerRef.current.remove(index);
    setPoses([...poseManagerRef.current.poses]);
    charDispatch({ type: 'SET_STATUS', text: `Deleted pose "${name}"` });
  }, [charDispatch]);

  const handleExportPoses = useCallback(() => {
    const json = poseManagerRef.current.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'poses.json';
    a.click();
    URL.revokeObjectURL(url);
    charDispatch({ type: 'SET_STATUS', text: 'Poses exported' });
  }, [charDispatch]);

  const handleImportPoses = useCallback((jsonStr: string) => {
    const count = poseManagerRef.current.importJSON(jsonStr);
    if (count >= 0) {
      setPoses([...poseManagerRef.current.poses]);
      charDispatch({ type: 'SET_STATUS', text: `Imported ${count} pose(s)` });
    } else {
      charDispatch({ type: 'SET_STATUS', text: 'Failed to import poses' });
    }
  }, [charDispatch]);

  // ------ Zoom callbacks ------
  const handleZoomIn = useCallback(() => {
    vpDispatch({ type: 'ZOOM', zoom: vpRef.current.zoom * 1.2 });
  }, [vpDispatch]);

  const handleZoomOut = useCallback(() => {
    vpDispatch({ type: 'ZOOM', zoom: vpRef.current.zoom / 1.2 });
  }, [vpDispatch]);

  const handleZoomReset = useCallback(() => {
    vpDispatch({ type: 'ZOOM', zoom: 1 });
    vpDispatch({ type: 'PAN', panX: 0, panY: 0 });
  }, [vpDispatch]);

  // ------ Toggle callbacks ------
  const handleToggleWeightPaint = useCallback(() => {
    if (toolState.weightPaintMode) {
      toolDispatch({ type: 'EXIT_WEIGHT_PAINT' });
      charDispatch({ type: 'SET_STATUS', text: 'Weight paint mode exited' });
    } else {
      toolDispatch({ type: 'ENTER_WEIGHT_PAINT' });
      if (!vpState.showWeights) {
        vpDispatch({ type: 'TOGGLE_WEIGHTS', show: true });
      }
      charDispatch({ type: 'SET_STATUS', text: 'Weight paint mode — paint bone influences' });
    }
  }, [toolState.weightPaintMode, toolDispatch, charDispatch, vpState.showWeights, vpDispatch]);

  const handleToggleFFD = useCallback(() => {
    const newEnabled = !charState.ffdMode;
    charDispatch({ type: 'SET_FFD_MODE', enabled: newEnabled });
    if (newEnabled) {
      const { mode, mesh, parsed } = charRef.current;
      const n = (mode === 'raster' && mesh)
        ? mesh.vertices.length
        : (parsed ? parsed.allControlPoints.length : 0);
      const currentOffsets = charRef.current.ffdOffsets;
      if (!currentOffsets || currentOffsets.length !== n) {
        const offsets = Array.from({ length: n }, () => V2(0, 0));
        charDispatch({ type: 'SET_FFD_OFFSETS', offsets });
        charRef.current = { ...charRef.current, ffdOffsets: offsets, ffdMode: true };
      } else {
        charRef.current = { ...charRef.current, ffdMode: true };
      }
      if (!vpState.showMesh) {
        vpDispatch({ type: 'TOGGLE_MESH', show: true });
      }
      charDispatch({ type: 'SET_STATUS', text: 'FFD mode — drag mesh vertices to deform' });
    } else {
      charRef.current = { ...charRef.current, ffdMode: false };
      charDispatch({ type: 'SET_STATUS', text: 'FFD mode exited' });
    }
    updateScene();
  }, [charState.ffdMode, charDispatch, vpState.showMesh, vpDispatch, updateScene]);

  // ------ Serialization — get full rig + animations as SerializedRigData ------
  const getSerializedData = useCallback((): SerializedRigData | null => {
    const { skeleton, weights, mesh, mode, parsed, rasterImage, squashStretchEnabled, springChains, ffdOffsets } = charRef.current;
    if (!skeleton || !mode || !parsed) return null;

    // Get sourceImageUrl: for raster use the img.src, for SVG reconstruct from parsed
    let sourceImageUrl = '';
    if (rasterImage) {
      sourceImageUrl = rasterImage.src;
    } else if (parsed.svgElement) {
      // SVG mode: use the SVG source if available
      sourceImageUrl = '';
    }

    const imageWidth = parsed.viewBox.w;
    const imageHeight = parsed.viewBox.h;

    const mgr = animManagerRef.current;
    const animations = mgr.animations;
    const currentPoses = poseManagerRef.current.poses;

    return BoneRiggingConverter.serialize(
      skeleton,
      weights,
      mesh,
      animations,
      currentPoses,
      {
        sourceImageUrl,
        imageWidth,
        imageHeight,
        mode,
        squashStretchEnabled,
        springChains: springChains || [],
        svgSource: parsed.svgElement ? new XMLSerializer().serializeToString(parsed.svgElement) : undefined,
        ffdOffsets,
      }
    );
  }, [animManagerRef]);

  // ------ Status text ------
  const statusText = charState.statusText || (charState.parsed
    ? `${charState.mode === 'svg' ? 'SVG' : 'Raster'} mode — ${Object.keys(charState.skeleton?.joints || {}).length} joints`
    : 'Ready — upload an SVG or image to begin');

  // ------ Return API ------
  return {
    viewportContainerRef,
    pixiContainerRef,
    brushCursorRef,
    pixiRef,

    loadFile,
    loadCharacterFromUrl,

    handleResetPose,
    handleEditRig,
    handleApplyRig,
    handleAddJoint,
    handleDeleteJoint,
    handleMirror,

    handleUndo,
    handleRedo,
    canUndo,
    canRedo,

    handleToggleTimeline,
    handleTogglePoses,
    handleToggleWeightPaint,
    handleToggleFFD,

    handleRadiusChange,
    handleWeightPaintReset,
    handleWeightPaintDone,

    handleAnimRecord,
    handleAnimAddKeyframe,
    handleAnimPlay,
    handleAnimStop,
    handleAnimSeek,
    handleAnimLoadAnimation,
    handleAnimDeleteAnimation,
    handleAnimExport,
    handleAnimImport,

    showPoses,
    poses,
    handleSavePose,
    handleApplyPose,
    handleDeletePose,
    handleExportPoses,
    handleImportPoses,

    handleZoomIn,
    handleZoomOut,
    handleZoomReset,

    fps,
    statusText,

    getSerializedData,

    computeTransform,
    applyDeformation,
    renderScene,
    updateScene,
  };
}
