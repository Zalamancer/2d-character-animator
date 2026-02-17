// =============================================================================
// @bonerigging/core — Pure computation library for 2D character rigging
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type { Vec2, Mat2x3, Transform, DistToSegmentResult } from './types/math';
export type { Joint, Bone, Skeleton } from './types/skeleton';
export type { BoneWeight } from './types/weights';
export type { Triangle, UV, MeshData } from './types/mesh';
export type { JointDelta, Keyframe, Animation, Pose, NormalizedAnimation, NormalizedKeyframe } from './types/animation';
export type { CharacterLibraryEntry } from './types/character-library';
export type {
  ViewBox,
  BBox,
  ControlPoint,
  PathData,
  AlphaGrid,
  ParsedCharacter,
} from './types/parsed';

// ---------------------------------------------------------------------------
// Math utilities
// ---------------------------------------------------------------------------
export {
  V2,
  v2Add,
  v2Sub,
  v2Scale,
  v2Dot,
  v2Cross,
  v2Len,
  v2Dist,
  v2Norm,
  v2Lerp,
  v2Rot,
  v2RotAround,
  angleNorm,
  clamp,
  distToSegment,
  m2Identity,
  m2Multiply,
  m2Transform,
  m2Rotate,
  m2Translate,
  m2Invert,
  pointInPolygon,
} from './engine/math';

// ---------------------------------------------------------------------------
// Deformation Engine
// ---------------------------------------------------------------------------
export { DeformationEngine } from './engine/deformation-engine';
export type { BoneData } from './engine/deformation-engine';

// ---------------------------------------------------------------------------
// IK Solver (FABRIK)
// ---------------------------------------------------------------------------
export {
  getIKChain,
  applyRigidDrag,
  propagateRigidFK,
  propagateFK,
} from './engine/ik-solver';

// ---------------------------------------------------------------------------
// Spring Physics
// ---------------------------------------------------------------------------
export { createSpringChain, simulateSprings } from './engine/spring-simulator';
export type { SpringChain, SpringState } from './engine/spring-simulator';

// ---------------------------------------------------------------------------
// Skin Weight Calculator
// ---------------------------------------------------------------------------
export { SkinWeightCalculator } from './engine/skin-weight-calculator';

// ---------------------------------------------------------------------------
// Auto Rigger
// ---------------------------------------------------------------------------
export { AutoRigger } from './engine/auto-rigger';

// ---------------------------------------------------------------------------
// Silhouette Analyzer (used by AutoRigger for alpha-grid body landmark detection)
// ---------------------------------------------------------------------------
export { SilhouetteAnalyzer } from './engine/silhouette-analyzer';
export type { BodyLandmarks } from './engine/silhouette-analyzer';

// ---------------------------------------------------------------------------
// Mesh Generator
// ---------------------------------------------------------------------------
export { MeshGenerator } from './engine/mesh-generator';

// ---------------------------------------------------------------------------
// SVG Parser
// ---------------------------------------------------------------------------
export { SVGParser } from './engine/svg-parser';

// ---------------------------------------------------------------------------
// Raster Parser
// ---------------------------------------------------------------------------
export { RasterParser } from './engine/raster-parser';

// ---------------------------------------------------------------------------
// Path Reconstructor
// ---------------------------------------------------------------------------
export { PathReconstructor } from './engine/path-reconstructor';
export type { ReconstructedPath } from './engine/path-reconstructor';

// ---------------------------------------------------------------------------
// Animation Manager
// ---------------------------------------------------------------------------
export { AnimationManager } from './engine/animation-manager';
export type { InterpolatedPose, PersistCallback } from './engine/animation-manager';

// ---------------------------------------------------------------------------
// Pose Manager
// ---------------------------------------------------------------------------
export { PoseManager } from './engine/pose-manager';
export type { PosePersistCallback } from './engine/pose-manager';

// ---------------------------------------------------------------------------
// Undo Manager
// ---------------------------------------------------------------------------
export { UndoManager } from './engine/undo-manager';
export type { UndoSnapshot, JointSnapshot } from './engine/undo-manager';

// ---------------------------------------------------------------------------
// Serialization (bonerigging <-> AutoStudio format conversion)
// ---------------------------------------------------------------------------
export { BoneRiggingConverter } from './serialization/converter';
export type { SerializedRigData, SerializedAnimation, SerializedJoint, SerializedBone, SerializedBoneWeight, SerializedMeshVertex, SerializedMeshTriangle, SerializedKeyframe, SerializedPose } from './serialization/schema';
