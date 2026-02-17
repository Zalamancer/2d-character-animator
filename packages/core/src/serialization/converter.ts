/**
 * BoneRiggingConverter — Converts between bonerigging internal format,
 * the SerializedRigData wire format, and AutoStudio's RigData format.
 */

import type { Joint, Bone, Skeleton } from '../types/skeleton';
import type { BoneWeight } from '../types/weights';
import type { MeshData } from '../types/mesh';
import type { Animation, Pose } from '../types/animation';
import type { Vec2 } from '../types/math';
import type { ControlPoint } from '../types/parsed';
import type { SpringChain, SpringState } from '../engine/spring-simulator';
import type { Mat2x3 } from '../types/math';
import type {
  SerializedRigData,
  SerializedJoint,
  SerializedBone,
  SerializedBoneWeight,
  SerializedMeshVertex,
  SerializedMeshTriangle,
  SerializedAnimation,
  SerializedPose,
  SerializedSpringChain,
} from './schema';

// ---------------------------------------------------------------------------
// AutoStudio type shapes (duplicated here to avoid hard dependency)
// These match the types in AutoStudio's src/types/rig.ts
// ---------------------------------------------------------------------------

interface AutoStudioBoneJoint {
  id: string;
  name: string;
  parentId: string | null;
  restPosition: { x: number; y: number };
  category: string;
  color?: string;
}

interface AutoStudioBoneSkeleton {
  joints: AutoStudioBoneJoint[];
  rootJointId: string;
}

interface AutoStudioJointPoseState {
  dx: number;
  dy: number;
  rotation: number;
}

type AutoStudioBonePose = Record<string, AutoStudioJointPoseState>;

interface AutoStudioMeshVertex {
  restX: number;
  restY: number;
  u: number;
  v: number;
  deformedX: number;
  deformedY: number;
}

interface AutoStudioMeshTriangle {
  a: number;
  b: number;
  c: number;
}

interface AutoStudioMeshData {
  vertices: AutoStudioMeshVertex[];
  triangles: AutoStudioMeshTriangle[];
  imageWidth: number;
  imageHeight: number;
  gridSpacing: number;
}

interface AutoStudioSkinWeight {
  jointId: string;
  weight: number;
}

interface AutoStudioRigData {
  id: string;
  sourceImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  skeleton: AutoStudioBoneSkeleton;
  mesh: AutoStudioMeshData;
  skinning: AutoStudioSkinWeight[][];
  meshGridSpacing: number;
  restPose: AutoStudioBonePose;
  createdAt: string;
  svgSource?: string;
}

interface AutoStudioBonePoseKeyframe {
  id: string;
  frame: number;
  pose: AutoStudioBonePose;
  easing: string;
}

interface AutoStudioBonePoseTrack {
  id: string;
  characterId: string;
  keyframes: AutoStudioBonePoseKeyframe[];
}

// ---------------------------------------------------------------------------
// Category inference from joint names
// ---------------------------------------------------------------------------

function inferCategory(jointName: string): string {
  const n = jointName.toLowerCase();
  if (n === 'hips' || n === 'root' || n === 'pelvis') return 'root';
  if (n.includes('spine') || n.includes('chest') || n.includes('torso') || n.includes('collar')) return 'torso';
  if (n.includes('head') || n.includes('neck') || n.includes('jaw') || n.includes('eye')) return 'head';
  if (n.includes('left') && (n.includes('shoulder') || n.includes('elbow') || n.includes('wrist') || n.includes('hand') || n.includes('finger') || n.includes('thumb'))) return 'arm-left';
  if (n.includes('right') && (n.includes('shoulder') || n.includes('elbow') || n.includes('wrist') || n.includes('hand') || n.includes('finger') || n.includes('thumb'))) return 'arm-right';
  if (n.includes('left') && (n.includes('hip') || n.includes('knee') || n.includes('ankle') || n.includes('foot') || n.includes('toe') || n.includes('thigh') || n.includes('shin'))) return 'leg-left';
  if (n.includes('right') && (n.includes('hip') || n.includes('knee') || n.includes('ankle') || n.includes('foot') || n.includes('toe') || n.includes('thigh') || n.includes('shin'))) return 'leg-right';
  if (n.includes('tail')) return 'tail';
  return 'other';
}

// ---------------------------------------------------------------------------
// BoneRiggingConverter
// ---------------------------------------------------------------------------

export class BoneRiggingConverter {
  /**
   * Convert bonerigging internal state to SerializedRigData.
   * Called by the editor's onSave callback.
   */
  static serialize(
    skeleton: Skeleton,
    weights: BoneWeight[][] | null,
    mesh: MeshData | null,
    animations: Animation[],
    poses: Pose[],
    metadata: {
      sourceImageUrl: string;
      imageWidth: number;
      imageHeight: number;
      mode: 'svg' | 'raster';
      squashStretchEnabled: boolean;
      springChains: SpringChain[];
      svgSource?: string;
      ffdOffsets?: Vec2[] | null;
    }
  ): SerializedRigData {
    // Serialize joints
    const joints: SerializedJoint[] = Object.entries(skeleton.joints).map(
      ([_name, joint]) => ({
        id: joint.name,
        name: joint.displayName || joint.name,
        parentId: joint.parent,
        restX: joint.rest.x,
        restY: joint.rest.y,
        category: inferCategory(joint.name),
        custom: joint.custom,
      })
    );

    // Serialize bones
    const bones: SerializedBone[] = skeleton.bones.map((bone) => ({
      name: bone.name,
      fromJointId: bone.from,
      toJointId: bone.to,
      index: bone.index,
      restAngle: bone.restAngle,
      restLength: bone.restLength,
      bindMatrix: [...bone.bindMatrix],
      inverseBindMatrix: [...bone.inverseBindMatrix],
      radiusMul: bone.radiusMul,
    }));

    // Serialize mesh
    const meshVertices: SerializedMeshVertex[] = mesh
      ? mesh.vertices.map((v, i) => ({
          x: v.point.x,
          y: v.point.y,
          u: mesh.uvs[i]?.u ?? 0,
          v: mesh.uvs[i]?.v ?? 0,
        }))
      : [];

    const meshTriangles: SerializedMeshTriangle[] = mesh
      ? mesh.triangles.map((t) => ({
          v0: t.v0,
          v1: t.v1,
          v2: t.v2,
        }))
      : [];

    // Serialize weights
    const skinning: SerializedBoneWeight[][] = (weights || []).map((vWeights) =>
      vWeights.map((w) => ({
        boneIndex: w.boneIndex,
        boneName: w.boneName,
        weight: w.weight,
        t: w.t,
      }))
    );

    // Serialize animations
    const serializedAnimations: SerializedAnimation[] = animations.map((anim) => ({
      name: anim.name,
      duration: anim.duration,
      fps: anim.fps,
      loop: anim.loop,
      keyframes: anim.keyframes.map((kf) => ({
        time: kf.time,
        deltas: kf.deltas,
        pinned: kf.pinned,
      })),
    }));

    // Serialize poses
    const serializedPoses: SerializedPose[] = poses.map((pose) => ({
      name: pose.name,
      deltas: pose.deltas,
      pinned: pose.pinned,
    }));

    // Serialize spring chains
    const springChains: SerializedSpringChain[] = metadata.springChains.map((sc) => ({
      rootJoint: sc.rootJoint,
      joints: sc.joints,
      stiffness: sc.stiffness,
      damping: sc.damping,
      gravity: { x: sc.gravity.x, y: sc.gravity.y },
    }));

    // Serialize FFD offsets
    const ffdOffsets = metadata.ffdOffsets
      ? metadata.ffdOffsets.map((o) => ({ x: o.x, y: o.y }))
      : undefined;

    return {
      version: 1,
      format: 'bonerigging-v1',
      sourceImageUrl: metadata.sourceImageUrl,
      imageWidth: metadata.imageWidth,
      imageHeight: metadata.imageHeight,
      mode: metadata.mode,
      joints,
      bones,
      meshVertices,
      meshTriangles,
      meshGridCols: mesh?.gridCols ?? 0,
      meshGridRows: mesh?.gridRows ?? 0,
      skinning,
      squashStretchEnabled: metadata.squashStretchEnabled,
      springChains,
      animations: serializedAnimations,
      poses: serializedPoses,
      svgSource: metadata.svgSource,
      ffdOffsets,
    };
  }

  /**
   * Convert SerializedRigData to bonerigging internal state.
   * Called when loading existing rig into the editor.
   */
  static deserialize(data: SerializedRigData): {
    skeleton: Skeleton;
    weights: BoneWeight[][];
    mesh: MeshData | null;
    animations: Animation[];
    poses: Pose[];
    metadata: {
      sourceImageUrl: string;
      imageWidth: number;
      imageHeight: number;
      mode: 'svg' | 'raster';
      squashStretchEnabled: boolean;
      springChains: SpringChain[];
      svgSource?: string;
      ffdOffsets?: Vec2[];
    };
  } {
    // Rebuild joints
    const joints: Record<string, Joint> = {};
    for (const sj of data.joints) {
      joints[sj.id] = {
        name: sj.id,
        displayName: sj.name !== sj.id ? sj.name : undefined,
        rest: { x: sj.restX, y: sj.restY },
        current: { x: sj.restX, y: sj.restY }, // Start at rest
        parent: sj.parentId,
        custom: sj.custom,
      };
    }

    // Rebuild bones
    const bones: Bone[] = data.bones.map((sb) => ({
      name: sb.name,
      from: sb.fromJointId,
      to: sb.toJointId,
      index: sb.index,
      restAngle: sb.restAngle,
      restLength: sb.restLength,
      bindMatrix: sb.bindMatrix as Mat2x3,
      inverseBindMatrix: sb.inverseBindMatrix as Mat2x3,
      radiusMul: sb.radiusMul,
    }));

    const skeleton: Skeleton = { joints, bones };

    // Rebuild weights
    const weights: BoneWeight[][] = data.skinning.map((vWeights) =>
      vWeights.map((w) => ({
        boneIndex: w.boneIndex,
        weight: w.weight,
        boneName: w.boneName,
        t: w.t,
      }))
    );

    // Rebuild mesh
    let mesh: MeshData | null = null;
    if (data.meshVertices.length > 0) {
      const vertices: ControlPoint[] = data.meshVertices.map((mv) => ({
        point: { x: mv.x, y: mv.y },
        type: 'anchor',
      }));
      mesh = {
        vertices,
        triangles: data.meshTriangles.map((mt) => ({
          v0: mt.v0,
          v1: mt.v1,
          v2: mt.v2,
        })),
        uvs: data.meshVertices.map((mv) => ({
          u: mv.u,
          v: mv.v,
        })),
        gridCols: data.meshGridCols,
        gridRows: data.meshGridRows,
      };
    }

    // Rebuild animations
    const animations: Animation[] = data.animations.map((sa) => ({
      name: sa.name,
      duration: sa.duration,
      fps: sa.fps,
      loop: sa.loop,
      keyframes: sa.keyframes.map((sk) => ({
        time: sk.time,
        deltas: sk.deltas,
        pinned: sk.pinned,
      })),
      ts: Date.now(),
    }));

    // Rebuild poses
    const poses: Pose[] = data.poses.map((sp) => ({
      name: sp.name,
      deltas: sp.deltas,
      pinned: sp.pinned,
      ts: Date.now(),
    }));

    // Rebuild spring chains
    const springChains: SpringChain[] = data.springChains.map((sc) => ({
      rootJoint: sc.rootJoint,
      joints: sc.joints,
      stiffness: sc.stiffness,
      damping: sc.damping,
      gravity: { x: sc.gravity.x, y: sc.gravity.y },
      states: [] as SpringState[], // Empty states — will be initialized by SpringSimulator
    }));

    const ffdOffsets = data.ffdOffsets
      ? data.ffdOffsets.map((o) => ({ x: o.x, y: o.y }))
      : undefined;

    return {
      skeleton,
      weights,
      mesh,
      animations,
      poses,
      metadata: {
        sourceImageUrl: data.sourceImageUrl,
        imageWidth: data.imageWidth,
        imageHeight: data.imageHeight,
        mode: data.mode,
        squashStretchEnabled: data.squashStretchEnabled,
        springChains,
        svgSource: data.svgSource,
        ffdOffsets,
      },
    };
  }

  /**
   * Convert SerializedRigData to AutoStudio's RigData format.
   * Called by AutoStudio when receiving data from the editor.
   */
  static toAutoStudioRigData(
    data: SerializedRigData,
    characterId: string = 'primary'
  ): {
    rigData: AutoStudioRigData;
    poseTracks: AutoStudioBonePoseTrack[];
  } {
    // Find root joint (joint with no parent)
    const rootJoint = data.joints.find((j) => j.parentId === null);
    const rootJointId = rootJoint?.id || data.joints[0]?.id || 'root';

    // Convert joints
    const asJoints: AutoStudioBoneJoint[] = data.joints.map((j) => ({
      id: j.id,
      name: j.name,
      parentId: j.parentId,
      restPosition: { x: j.restX, y: j.restY },
      category: j.category || inferCategory(j.id),
    }));

    // Convert mesh vertices
    const asVertices: AutoStudioMeshVertex[] = data.meshVertices.map((v) => ({
      restX: v.x,
      restY: v.y,
      u: v.u,
      v: v.v,
      deformedX: v.x,
      deformedY: v.y,
    }));

    // Convert mesh triangles
    const asTriangles: AutoStudioMeshTriangle[] = data.meshTriangles.map((t) => ({
      a: t.v0,
      b: t.v1,
      c: t.v2,
    }));

    // Build a bone name -> bone from/to lookup for weight conversion
    const boneToJointMap = new Map<number, string>();
    for (const bone of data.bones) {
      // In AutoStudio, weights reference the child joint (bone.to)
      boneToJointMap.set(bone.index, bone.toJointId);
    }

    // Convert skinning weights (boneIndex -> jointId)
    const asSkinning: AutoStudioSkinWeight[][] = data.skinning.map((vWeights) =>
      vWeights.map((w) => ({
        jointId: boneToJointMap.get(w.boneIndex) || w.boneName,
        weight: w.weight,
      }))
    );

    // Build rest pose
    const restPose: AutoStudioBonePose = {};
    for (const joint of data.joints) {
      restPose[joint.id] = { dx: 0, dy: 0, rotation: 0 };
    }

    // Compute grid spacing from mesh dimensions
    const gridSpacing = data.meshGridCols > 0
      ? Math.round(data.imageWidth / data.meshGridCols)
      : 20;

    const rigData: AutoStudioRigData = {
      id: `rig_${Date.now()}`,
      sourceImageUrl: data.sourceImageUrl,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
      skeleton: {
        joints: asJoints,
        rootJointId,
      },
      mesh: {
        vertices: asVertices,
        triangles: asTriangles,
        imageWidth: data.imageWidth,
        imageHeight: data.imageHeight,
        gridSpacing,
      },
      skinning: asSkinning,
      meshGridSpacing: gridSpacing,
      restPose,
      createdAt: new Date().toISOString(),
      svgSource: data.svgSource,
    };

    // Convert animations to pose tracks
    const poseTracks: AutoStudioBonePoseTrack[] = [];

    for (const anim of data.animations) {
      const keyframes: AutoStudioBonePoseKeyframe[] = anim.keyframes.map(
        (kf, index) => {
          const pose: AutoStudioBonePose = {};
          for (const [jointName, delta] of Object.entries(kf.deltas)) {
            pose[jointName] = {
              dx: delta.x,
              dy: delta.y,
              rotation: 0, // bonerigging uses position-based deformation, not rotation
            };
          }
          return {
            id: `kf_${Date.now()}_${index}`,
            frame: Math.round(kf.time * anim.fps),
            pose,
            easing: 'linear',
          };
        }
      );

      poseTracks.push({
        id: `track_${Date.now()}_${anim.name}`,
        characterId,
        keyframes,
      });
    }

    return { rigData, poseTracks };
  }

  /**
   * Convert AutoStudio's RigData to SerializedRigData.
   * Called when passing existing AutoStudio rig to the bonerigging editor.
   */
  static fromAutoStudioRigData(
    rigData: AutoStudioRigData,
    poseTracks: AutoStudioBonePoseTrack[],
    fps: number = 24
  ): SerializedRigData {
    // Convert joints
    const joints: SerializedJoint[] = rigData.skeleton.joints.map((j) => ({
      id: j.id,
      name: j.name,
      parentId: j.parentId,
      restX: j.restPosition.x,
      restY: j.restPosition.y,
      category: j.category,
    }));

    // AutoStudio doesn't store explicit bone objects — infer from parent-child
    const bones: SerializedBone[] = [];
    let boneIndex = 0;
    for (const joint of rigData.skeleton.joints) {
      if (joint.parentId) {
        const parent = rigData.skeleton.joints.find((j) => j.id === joint.parentId);
        if (parent) {
          const dx = joint.restPosition.x - parent.restPosition.x;
          const dy = joint.restPosition.y - parent.restPosition.y;
          const restLength = Math.sqrt(dx * dx + dy * dy);
          const restAngle = Math.atan2(dy, dx);

          bones.push({
            name: `${parent.id}_to_${joint.id}`,
            fromJointId: parent.id,
            toJointId: joint.id,
            index: boneIndex,
            restAngle,
            restLength,
            bindMatrix: [1, 0, 0, 1, 0, 0], // Identity — will be recomputed
            inverseBindMatrix: [1, 0, 0, 1, 0, 0],
          });
          boneIndex++;
        }
      }
    }

    // Build jointId -> boneIndex map for weight conversion
    const jointToBoneIndex = new Map<string, number>();
    for (const bone of bones) {
      jointToBoneIndex.set(bone.toJointId, bone.index);
    }

    // Convert mesh vertices
    const meshVertices: SerializedMeshVertex[] = rigData.mesh.vertices.map((v) => ({
      x: v.restX,
      y: v.restY,
      u: v.u,
      v: v.v,
    }));

    // Convert mesh triangles
    const meshTriangles: SerializedMeshTriangle[] = rigData.mesh.triangles.map((t) => ({
      v0: t.a,
      v1: t.b,
      v2: t.c,
    }));

    // Convert skinning weights (jointId -> boneIndex)
    const skinning: SerializedBoneWeight[][] = rigData.skinning.map((vWeights) =>
      vWeights.map((w) => ({
        boneIndex: jointToBoneIndex.get(w.jointId) ?? 0,
        boneName: w.jointId,
        weight: w.weight,
        t: 0.5, // AutoStudio doesn't store projection — default to midpoint
      }))
    );

    // Convert pose tracks to animations
    const animations: SerializedAnimation[] = [];
    for (const track of poseTracks) {
      if (track.keyframes.length === 0) continue;

      const maxFrame = Math.max(...track.keyframes.map((kf) => kf.frame));
      animations.push({
        name: `Track_${track.characterId}`,
        duration: maxFrame / fps,
        fps,
        loop: false,
        keyframes: track.keyframes.map((kf) => ({
          time: kf.frame / fps,
          deltas: Object.fromEntries(
            Object.entries(kf.pose)
              .filter(([_, state]) => Math.abs(state.dx) > 0.01 || Math.abs(state.dy) > 0.01)
              .map(([jointId, state]) => [jointId, { x: state.dx, y: state.dy }])
          ),
          pinned: [],
        })),
      });
    }

    // Compute grid cols from spacing
    const gridCols = rigData.meshGridSpacing > 0
      ? Math.ceil(rigData.imageWidth / rigData.meshGridSpacing)
      : 0;
    const gridRows = rigData.meshGridSpacing > 0
      ? Math.ceil(rigData.imageHeight / rigData.meshGridSpacing)
      : 0;

    return {
      version: 1,
      format: 'bonerigging-v1',
      sourceImageUrl: rigData.sourceImageUrl,
      imageWidth: rigData.imageWidth,
      imageHeight: rigData.imageHeight,
      mode: rigData.svgSource ? 'svg' : 'raster',
      joints,
      bones,
      meshVertices,
      meshTriangles,
      meshGridCols: gridCols,
      meshGridRows: gridRows,
      skinning,
      squashStretchEnabled: false, // AutoStudio doesn't have S&S
      springChains: [],            // AutoStudio doesn't have spring physics
      animations,
      poses: [],                   // AutoStudio doesn't have a pose library
      svgSource: rigData.svgSource,
    };
  }
}
