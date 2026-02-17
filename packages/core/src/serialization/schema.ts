/**
 * SerializedRigData — The versioned wire format for bonerigging data.
 * This is the data contract between the bonerigging editor and consuming apps
 * (like AutoStudio). It is JSON-serializable and transport-agnostic.
 */

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export interface SerializedJoint {
  id: string;
  name: string;
  parentId: string | null;
  restX: number;
  restY: number;
  /** BoneCategory hint for AutoStudio compatibility */
  category?: string;
  /** True if user-added (not from auto-rigger) */
  custom?: boolean;
}

export interface SerializedBone {
  name: string;
  fromJointId: string;
  toJointId: string;
  index: number;
  restAngle: number;
  restLength: number;
  /** Inverse bind matrix [a, b, c, d, tx, ty] */
  bindMatrix: number[];
  inverseBindMatrix: number[];
  /** Envelope radius multiplier */
  radiusMul?: number;
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

export interface SerializedBoneWeight {
  boneIndex: number;
  boneName: string;
  weight: number;
  /** Projection along bone (0=head, 1=tail) */
  t: number;
}

// ---------------------------------------------------------------------------
// Mesh
// ---------------------------------------------------------------------------

export interface SerializedMeshVertex {
  x: number;
  y: number;
  u: number;
  v: number;
}

export interface SerializedMeshTriangle {
  v0: number;
  v1: number;
  v2: number;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export interface SerializedKeyframe {
  /** Time in seconds */
  time: number;
  /** Joint name -> {x, y} position offset from rest */
  deltas: Record<string, { x: number; y: number }>;
  /** Pinned joint names */
  pinned: string[];
}

export interface SerializedAnimation {
  name: string;
  /** Duration in seconds */
  duration: number;
  fps: number;
  loop: boolean;
  keyframes: SerializedKeyframe[];
}

export interface SerializedPose {
  name: string;
  deltas: Record<string, { x: number; y: number }>;
  pinned: string[];
}

// ---------------------------------------------------------------------------
// Spring Physics
// ---------------------------------------------------------------------------

export interface SerializedSpringChain {
  rootJoint: string;
  joints: string[];
  stiffness: number;
  damping: number;
  gravity: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Top-level container
// ---------------------------------------------------------------------------

export interface SerializedRigData {
  /** Schema version for forward compatibility */
  version: 1;
  format: 'bonerigging-v1';

  // -- Source image --
  sourceImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  mode: 'svg' | 'raster';

  // -- Skeleton --
  joints: SerializedJoint[];
  bones: SerializedBone[];

  // -- Mesh (raster mode) --
  meshVertices: SerializedMeshVertex[];
  meshTriangles: SerializedMeshTriangle[];
  meshGridCols: number;
  meshGridRows: number;

  // -- Weights (per-vertex array of bone weights) --
  skinning: SerializedBoneWeight[][];

  // -- Feature flags --
  squashStretchEnabled: boolean;
  springChains: SerializedSpringChain[];

  // -- Animation data --
  animations: SerializedAnimation[];
  poses: SerializedPose[];

  // -- SVG-specific (optional) --
  svgSource?: string;

  // -- FFD offsets (optional) --
  ffdOffsets?: Array<{ x: number; y: number }>;
}
