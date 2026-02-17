/**
 * RigPlaybackViewer — Lightweight read-only viewer that renders a rigged
 * character with PixiJS using the exact same rendering pipeline as the
 * bonerigging editor (PixiViewport + RasterMesh + BoneOverlay).
 *
 * Does NOT require BoneRiggingProvider or any editor context.
 * Takes SerializedRigData and renders the deformed mesh + skeleton.
 *
 * Rendering strategy:
 * - Inner PixiJS canvas renders at native source image resolution (crisp mesh)
 * - CSS transform scales the container down to the requested display size
 * - uiScale compensates bone overlay sizes so they appear correct on screen
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  BoneRiggingConverter,
  DeformationEngine,
  AnimationManager,
  RasterParser,
  V2,
} from '@bonerigging/core';
import type {
  SerializedRigData,
  Skeleton,
  MeshData,
  BoneWeight,
  Vec2,
  Animation,
} from '@bonerigging/core';
import { PixiViewport } from '../../pixi/PixiViewport';

export interface RigPlaybackViewerProps {
  /** Serialized rig data (from boneriggingSerializedData on RigData) */
  data: SerializedRigData;
  /** Width of the viewer in pixels */
  width: number;
  /** Height of the viewer in pixels */
  height: number;
  /** Animation index to play (default: 0, first animation) */
  animationIndex?: number;
  /** Current playback time in seconds (driven externally). If not provided, uses internal RAF loop. */
  time?: number;
  /** Whether to show the bone skeleton overlay (default: true) */
  showBones?: boolean;
  /** Whether the animation is playing (default: true when time is not provided) */
  isPlaying?: boolean;
  /** Whether to loop the animation (default: true) */
  loop?: boolean;
}

export function RigPlaybackViewer({
  data,
  width,
  height,
  animationIndex = 0,
  time: externalTime,
  showBones = true,
  isPlaying = true,
  loop = true,
}: RigPlaybackViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiViewport | null>(null);
  const destroyedRef = useRef(false);

  // Track source image dimensions in state so re-render updates the CSS layout
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);

  // Deserialized state (mutable refs to avoid re-renders)
  const skeletonRef = useRef<Skeleton | null>(null);
  const weightsRef = useRef<BoneWeight[][] | null>(null);
  const meshRef = useRef<MeshData | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const deformedPosRef = useRef<Vec2[] | null>(null);
  const squashStretchRef = useRef(false);
  const imageWidthRef = useRef(0);
  const imageHeightRef = useRef(0);

  // Animation state
  const animManagerRef = useRef(new AnimationManager());
  const playbackTimeRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const rafRef = useRef(0);

  // The PixiJS canvas renders at native image resolution (1:1) so the mesh
  // texture is perfectly crisp. No scaling inside PixiJS.
  const computeTransform = useCallback(() => {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }, []);

  // Apply deformation at a given time
  const applyDeformationAtTime = useCallback((time: number) => {
    const skeleton = skeletonRef.current;
    const mesh = meshRef.current;
    const weights = weightsRef.current;
    if (!skeleton || !mesh || !weights) return;

    const mgr = animManagerRef.current;
    const anim = mgr.currentAnimation;

    // Reset joints to rest
    for (const j of Object.values(skeleton.joints)) {
      j.current = V2(j.rest.x, j.rest.y);
    }

    // Apply animation pose
    if (anim) {
      const pose = mgr.getInterpolatedPose(anim, time);
      if (pose) {
        for (const [jn, d] of Object.entries(pose.deltas)) {
          const j = skeleton.joints[jn];
          if (j) j.current = V2(j.rest.x + d.x, j.rest.y + d.y);
        }
      }
    }

    // Deform mesh vertices
    const boneData = DeformationEngine.computeBoneData(skeleton, squashStretchRef.current);
    if (!deformedPosRef.current || deformedPosRef.current.length !== mesh.vertices.length) {
      deformedPosRef.current = mesh.vertices.map(v => V2(v.point.x, v.point.y));
    }
    DeformationEngine.deformInPlace(
      mesh.vertices, weights, boneData, deformedPosRef.current, squashStretchRef.current
    );
  }, []);

  // Render one frame
  const renderFrame = useCallback(() => {
    const pixi = pixiRef.current;
    const skeleton = skeletonRef.current;
    const mesh = meshRef.current;
    const weights = weightsRef.current;
    const image = imageRef.current;
    if (!pixi || !skeleton || !mesh || !weights || !image) return;

    const transform = computeTransform();

    const imgW = imageWidthRef.current;
    const imgH = imageHeightRef.current;
    if (!imgW || !imgH) return;

    // uiScale: compensate bone sizes for the CSS downscale.
    // Canvas is imgW CSS px, displayed at `width` CSS px via CSS scale.
    // Base: 1/cssScale makes bones 5px on screen (same as editor's raw size).
    // But the editor's viewport is much larger (~700px) so 5px looks small
    // relative to the character. On the smaller main canvas display, 5px is
    // proportionally too big. We apply a 0.5 factor so bones appear at the
    // same proportion relative to the character as in the editor.
    const cssScaleX = width / imgW;
    const cssScaleY = height / imgH;
    const cssScale = Math.min(cssScaleX, cssScaleY);
    const uiScale = cssScale > 0 ? 0.5 / cssScale : 1;

    pixi.render({
      skeleton,
      parsed: {
        svgElement: null,
        viewBox: { x: 0, y: 0, w: imgW, h: imgH },
        paths: [],
        allControlPoints: mesh.vertices,
        bbox: { minX: 0, minY: 0, maxX: imgW, maxY: imgH, w: imgW, h: imgH, cx: imgW / 2, cy: imgH / 2 },
      },
      transform,
      weights,
      selectedJoint: null,
      hoveredJoint: null,
      pinnedJoints: new Set(),
      showBones,
      showMesh: false,
      showWeights: false,
      showLabels: false,
      editMode: false,
      mode: 'raster',
      mesh,
      rasterDeformed: deformedPosRef.current,
      rasterImage: image,
      uiScale,
    });
  }, [computeTransform, showBones, width, height]);

  // Full update: deform + render
  const updateScene = useCallback((time: number) => {
    applyDeformationAtTime(time);
    renderFrame();
  }, [applyDeformationAtTime, renderFrame]);

  // Deserialize data and load image on mount / data change
  useEffect(() => {
    destroyedRef.current = false;

    const deserialized = BoneRiggingConverter.deserialize(data);
    skeletonRef.current = deserialized.skeleton;
    weightsRef.current = deserialized.weights;
    meshRef.current = deserialized.mesh;
    animationsRef.current = deserialized.animations;
    squashStretchRef.current = deserialized.metadata.squashStretchEnabled;
    imageWidthRef.current = deserialized.metadata.imageWidth;
    imageHeightRef.current = deserialized.metadata.imageHeight;

    // Update state so layout re-renders with correct dimensions
    setImgDims({ w: deserialized.metadata.imageWidth, h: deserialized.metadata.imageHeight });

    // Load animations into manager
    const mgr = animManagerRef.current;
    mgr.loadAnimations(deserialized.animations);
    mgr.loop = loop;

    // Select the animation
    if (deserialized.animations.length > 0) {
      const idx = Math.min(animationIndex, deserialized.animations.length - 1);
      mgr.play(idx);
      mgr.pause(); // We drive playback ourselves
    }

    // Load raster image
    const imageUrl = deserialized.metadata.sourceImageUrl;
    if (imageUrl) {
      RasterParser.loadFromUrl(imageUrl).then((img) => {
        if (destroyedRef.current) return;
        imageRef.current = img;
        // Upload mesh to pixi rasterMesh
        const pixi = pixiRef.current;
        if (pixi && deserialized.mesh) {
          pixi.rasterMesh.uploadMesh(deserialized.mesh);
        }
        // Render first frame
        updateScene(0);
      }).catch((err) => {
        console.error('[RigPlaybackViewer] Failed to load image:', err);
      });
    }

    return () => {
      destroyedRef.current = true;
    };
  }, [data, animationIndex, loop, updateScene]);

  // Initialize PixiJS
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const vp = new PixiViewport();
    pixiRef.current = vp;
    let destroyed = false;

    vp.init(container).then(() => {
      if (destroyed) {
        vp.destroy();
        return;
      }
      // Upload mesh if already loaded
      if (meshRef.current) {
        vp.rasterMesh.uploadMesh(meshRef.current);
      }
      // Render initial frame
      updateScene(playbackTimeRef.current);
    });

    return () => {
      destroyed = true;
      if (pixiRef.current) {
        pixiRef.current.destroy();
        pixiRef.current = null;
      }
    };
  }, []);

  // Handle externally-driven time
  useEffect(() => {
    if (externalTime !== undefined) {
      playbackTimeRef.current = externalTime;
      updateScene(externalTime);
    }
  }, [externalTime, updateScene]);

  // Internal playback RAF loop (when time is NOT externally driven)
  useEffect(() => {
    if (externalTime !== undefined) return; // External time control
    if (!isPlaying) return;

    lastFrameTimeRef.current = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = now;

      const mgr = animManagerRef.current;
      const anim = mgr.currentAnimation;
      if (!anim) return;

      playbackTimeRef.current += dt;

      if (playbackTimeRef.current >= anim.duration) {
        if (loop) {
          playbackTimeRef.current = playbackTimeRef.current % anim.duration;
        } else {
          playbackTimeRef.current = anim.duration;
          updateScene(playbackTimeRef.current);
          return; // Stop
        }
      }

      updateScene(playbackTimeRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [externalTime, isPlaying, loop, updateScene]);

  // Re-render when showBones changes
  useEffect(() => {
    renderFrame();
  }, [showBones, renderFrame]);

  // Layout: outer div = display size, inner div = native image resolution.
  // CSS scale shrinks the inner div to fit the outer. PixiJS renders at native
  // res for a crisp mesh, and uiScale compensates bone sizes.
  const imgW = imgDims?.w || width;
  const imgH = imgDims?.h || height;
  const cssScaleX = width / imgW;
  const cssScaleY = height / imgH;
  const cssScale = Math.min(cssScaleX, cssScaleY);

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'visible',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: imgW,
          height: imgH,
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `scale(${cssScale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}
