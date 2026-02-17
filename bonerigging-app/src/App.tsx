import { useCallback, useRef, useEffect, useState } from 'react';
import { CharacterProvider, useCharacterContext } from './contexts/CharacterContext';
import { ViewportProvider, useViewportContext } from './contexts/ViewportContext';
import { ToolProvider, useToolContext } from './contexts/ToolContext';
import { AnimationProvider, useAnimationContext } from './contexts/AnimationContext';
import { Toolbar } from './components/layout/Toolbar';
import { Statusbar } from './components/layout/Statusbar';
import { Viewport } from './components/viewport/Viewport';
import { SVGLayer } from './components/viewport/SVGLayer';
import { UploadPrompt } from './components/viewport/UploadPrompt';
import { ZoomControls } from './components/viewport/ZoomControls';
import { DisplayToggle } from './components/viewport/DisplayToggle';
import { TimelinePanel } from './components/panels/TimelinePanel';
import { PosePanel } from './components/panels/PosePanel';
import { WeightPaintPanel } from './components/panels/WeightPaintPanel';
import { WeightPanel } from './components/panels/WeightPanel';
import { usePointerInteraction } from './hooks/usePointerInteraction';
import { useUndoRedo } from './hooks/useUndoRedo';
import { SVGParser } from './core/svg-parser';
import { RasterParser } from './core/raster-parser';
import { MeshGenerator } from './core/mesh-generator';
import { AutoRigger } from './core/auto-rigger';
import { SkinWeightCalculator } from './core/skin-weight-calculator';
import { DeformationEngine } from './core/deformation-engine';
import { PathReconstructor } from './core/path-reconstructor';
import { PoseManager } from './core/pose-manager';
import { V2 } from './core/math';
import { PixiViewport } from './pixi/PixiViewport';
import type { Pose } from './types/animation';
import './styles/global.css';
import './styles/toolbar.css';
import './styles/viewport.css';
import './styles/panels.css';
import './styles/timeline.css';

// ---------------------------------------------------------------------------
// Inner App (has access to all contexts)
// ---------------------------------------------------------------------------

function AppInner() {
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

    const boneData = DeformationEngine.computeBoneData(skeleton, squashStretchEnabled);

    if (mode === 'svg') {
      const deformed = DeformationEngine.deformControlPoints(
        parsed.allControlPoints, weights, boneData, squashStretchEnabled
      );
      // Apply FFD offsets on top of bone deformation for SVG mode
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
      // Ignore events from UI panels (sliders, buttons, etc.)
      const target = e.target as HTMLElement;
      if (target.closest('.panel, .timeline-panel')) return;

      // Right-click: toggle pin on closest joint
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

      // Capture undo snapshot before any left-click drag
      if (e.button === 0 && charRef.current.skeleton) {
        captureUndoSnapshot();
      }

      // Weight paint mode: track painting with a mutable ref (React dispatch is async)
      if (toolRef.current.weightPaintMode && e.button === 0 && !e.altKey) {
        wpPaintingRef.current = true;
        // Capture pointer so painting continues smoothly
        (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
        // Do an initial paint stroke at click position
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
        return; // Don't pass to pointer hook for joint selection
      }

      pointer.onPointerDown(e, getRect());
    };
    const handleMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.panel, .timeline-panel')) return;

      // Update brush cursor position when in weight paint mode
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

      // Weight paint brush stroke during drag
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

      // FFD drag: eagerly sync offsets (dispatch is async, would be stale).
      // The pointer hook stores newly-computed offsets in lastFfdOffsetsRef so
      // we can read them synchronously and update charRef before applyDeformation().
      const pendingFfdOffsets = pointer.lastFfdOffsetsRef.current;
      if (pendingFfdOffsets) {
        charRef.current = { ...charRef.current, ffdOffsets: pendingFfdOffsets };
        pointer.lastFfdOffsetsRef.current = null; // consume
      }

      // In edit mode we only reposition bones — no deformation
      if (!toolRef.current.editMode) applyDeformation();
      renderScene();
    };
    const handleUp = (e: PointerEvent) => {
      // Stop weight painting
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

        // Auto-capture keyframe during recording
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

      // Ctrl+Z = Undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }
      // Ctrl+Shift+Z or Ctrl+Y = Redo
      if (((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
          ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        handleRedo();
        return;
      }
      // R = start/stop recording (not in edit mode or input)
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !toolRef.current.editMode && !isInput) {
        e.preventDefault();
        handleAnimRecord();
        return;
      }
      // Space = add keyframe (recording) or toggle play/pause (not recording)
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
      // Delete = delete joint in edit mode
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
    toolDispatch({ type: 'ENTER_EDIT_MODE' });
    charDispatch({ type: 'SET_STATUS', text: 'Edit mode — modify skeleton, then click Apply' });
  }, [toolState.editMode, toolDispatch, charDispatch, captureUndoSnapshot]);

  const handleApplyRig = useCallback(() => {
    const { skeleton, parsed } = charRef.current;
    if (!skeleton || !parsed) return;

    // 1. Commit current positions as the new rest pose
    for (const joint of Object.values(skeleton.joints)) {
      joint.rest = V2(joint.current.x, joint.current.y);
    }

    // 2. Recompute bone rest data (angles + lengths)
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

    // 3. Recompute skin weights
    const weights = SkinWeightCalculator.compute(
      charRef.current.mode === 'raster' && charRef.current.mesh
        ? charRef.current.mesh.vertices
        : parsed.allControlPoints,
      skeleton, parsed.bbox
    );
    charDispatch({ type: 'UPDATE_WEIGHTS', weights });

    // 4. Eagerly sync the mutable ref so updateScene sees new weights immediately
    charRef.current = { ...charRef.current, weights };

    // 5. Reset raster deformed cache (rest == current now, so no deformation)
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
    const { skeleton, parsed } = charRef.current;
    if (!skeleton) return;

    captureUndoSnapshot();
    const cx = parsed?.bbox.cx ?? 0;

    // Mirror only current positions of left→right joints (matching original HTML)
    for (const [name, joint] of Object.entries(skeleton.joints)) {
      if (!name.startsWith('left')) continue;
      const rightName = 'right' + name.slice(4);
      const rightJoint = skeleton.joints[rightName];
      if (!rightJoint) continue;
      const mirrorX = cx + (cx - joint.current.x);
      rightJoint.current = V2(mirrorX, joint.current.y);
    }

    charDispatch({ type: 'SET_STATUS', text: 'Mirrored left → right' });
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
      // Eagerly update the mutable ref so updateScene() sees the new weights
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

    // Eagerly update the mutable ref so updateScene() sees the new mesh/weights
    // immediately (the React state dispatch won't propagate until next render).
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

  // ------ Status text ------
  const statusText = charState.statusText || (charState.parsed
    ? `${charState.mode === 'svg' ? 'SVG' : 'Raster'} mode — ${Object.keys(charState.skeleton?.joints || {}).length} joints`
    : 'Ready — upload an SVG or image to begin');

  const svgTransform = {
    scale: vpState.scale,
    offsetX: vpState.offsetX,
    offsetY: vpState.offsetY,
  };

  const hasCharacter = charState.parsed !== null;

  return (
    <div id="app">
      <Toolbar
        onUpload={loadFile}
        onResetPose={handleResetPose}
        onEditRig={handleEditRig}
        onApplyRig={handleApplyRig}
        onAddJoint={handleAddJoint}
        onDeleteJoint={handleDeleteJoint}
        onMirror={handleMirror}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleTimeline={handleToggleTimeline}
        onTogglePoses={handleTogglePoses}
        onToggleWeightPaint={() => {
          if (toolState.weightPaintMode) {
            toolDispatch({ type: 'EXIT_WEIGHT_PAINT' });
            charDispatch({ type: 'SET_STATUS', text: 'Weight paint mode exited' });
          } else {
            toolDispatch({ type: 'ENTER_WEIGHT_PAINT' });
            // Auto-enable weight visualization so user can see what they're painting
            if (!vpState.showWeights) {
              vpDispatch({ type: 'TOGGLE_WEIGHTS', show: true });
            }
            charDispatch({ type: 'SET_STATUS', text: 'Weight paint mode — paint bone influences' });
          }
        }}
        onToggleFFD={() => {
          const newEnabled = !charState.ffdMode;
          charDispatch({ type: 'SET_FFD_MODE', enabled: newEnabled });
          if (newEnabled) {
            // Initialize FFD offsets array (all zeros) if not already set
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
            // Auto-enable mesh visualization so user can see FFD vertices
            if (!vpState.showMesh) {
              vpDispatch({ type: 'TOGGLE_MESH', show: true });
            }
            charDispatch({ type: 'SET_STATUS', text: 'FFD mode — drag mesh vertices to deform' });
          } else {
            charRef.current = { ...charRef.current, ffdMode: false };
            charDispatch({ type: 'SET_STATUS', text: 'FFD mode exited' });
          }
          updateScene();
        }}
        canUndo={canUndo}
        canRedo={canRedo}
        fps={fps}
      />
      <Viewport
        ref={viewportContainerRef}
        pixiRef={pixiRef}
        svgLayerRef={pixiContainerRef}
        onFileDrop={loadFile}
        computeTransform={computeTransform}
        applyDeformation={applyDeformation}
        render={renderScene}
        showPoses={showPoses}
      >
        <UploadPrompt visible={!hasCharacter} />

        {charState.mode === 'svg' && charState.parsed && (
          <SVGLayer
            svgElement={charState.parsed.svgElement}
            transform={svgTransform}
          />
        )}

        <div
          ref={pixiContainerRef}
          className="pixi-canvas"
          style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
        />

        {/* Weight paint brush cursor */}
        <div
          ref={brushCursorRef}
          style={{
            display: toolState.weightPaintMode ? 'block' : 'none',
            position: 'absolute',
            borderRadius: '50%',
            border: '2px solid rgba(255, 200, 0, 0.7)',
            pointerEvents: 'none',
            zIndex: 3,
            width: toolState.wpState.radius * 2,
            height: toolState.wpState.radius * 2,
            transform: 'translate(0, 0)',
          }}
        />

        <ZoomControls
          zoom={vpState.zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onReset={handleZoomReset}
        />

        <DisplayToggle />

        {/* Side panels — stop pointer events from reaching viewport handlers */}
        <div
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100% - 16px)', overflowY: 'auto', pointerEvents: 'auto' }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <WeightPanel onRadiusChange={handleRadiusChange} />
          <WeightPaintPanel
            visible={toolState.weightPaintMode}
            onReset={handleWeightPaintReset}
            onDone={handleWeightPaintDone}
          />
          <PosePanel
            visible={showPoses}
            poses={poses}
            onSavePose={handleSavePose}
            onApplyPose={handleApplyPose}
            onDeletePose={handleDeletePose}
            onExportPoses={handleExportPoses}
            onImportPoses={handleImportPoses}
          />
        </div>
      </Viewport>

      <TimelinePanel
        visible={animState.showTimeline}
        onRecord={handleAnimRecord}
        onAddKeyframe={handleAnimAddKeyframe}
        onPlay={handleAnimPlay}
        onStop={handleAnimStop}
        onSeek={handleAnimSeek}
        onLoadAnimation={handleAnimLoadAnimation}
        onDeleteAnimation={handleAnimDeleteAnimation}
        onExportAnimations={handleAnimExport}
        onImportAnimations={handleAnimImport}
      />

      <Statusbar text={statusText} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App — wraps with providers
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <CharacterProvider>
      <ViewportProvider>
        <ToolProvider>
          <AnimationProvider>
            <AppInner />
          </AnimationProvider>
        </ToolProvider>
      </ViewportProvider>
    </CharacterProvider>
  );
}
