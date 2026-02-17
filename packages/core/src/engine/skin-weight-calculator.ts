import type { Skeleton } from '../types/skeleton';
import type { ControlPoint, BBox } from '../types/parsed';
import type { Vec2 } from '../types/math';
import type { BoneWeight } from '../types/weights';
import { distToSegment } from './math';

export class SkinWeightCalculator {
  // Default radius multipliers per bone category -- smaller = tighter influence
  static DEFAULT_RADII: Record<string, number> = {
    spine: 0.8, chest: 0.8, neck: 0.5, head: 0.6,
    leftCollar: 0.3, rightCollar: 0.3,
    leftUpperArm: 0.7, leftForearm: 0.6,
    rightUpperArm: 0.7, rightForearm: 0.6,
    leftHipBone: 0.3, rightHipBone: 0.3,
    leftThigh: 0.7, leftShin: 0.6,
    rightThigh: 0.7, rightShin: 0.6,
    leftHand: 0.4, rightHand: 0.4,
    leftThumb: 0.25, leftIndex: 0.25, leftMiddle: 0.25, leftRing: 0.25, leftPinky: 0.25,
    rightThumb: 0.25, rightIndex: 0.25, rightMiddle: 0.25, rightRing: 0.25, rightPinky: 0.25,
    leftFoot: 0.4, rightFoot: 0.4,
  };

  static compute(controlPoints: ControlPoint[], skeleton: Skeleton, bbox: BBox): BoneWeight[][] {
    const maxInfluences: number = 4;
    const weights: BoneWeight[][] = [];
    const falloffPower: number = 3.0; // sharper than before (was 2.0)

    for (const cp of controlPoints) {
      const p: Vec2 = cp.point;
      const boneWeights: BoneWeight[] = [];

      for (const bone of skeleton.bones) {
        const head: Vec2 = skeleton.joints[bone.from].rest;
        const tail: Vec2 = skeleton.joints[bone.to].rest;
        const { dist, t } = distToSegment(p, head, tail);

        // Per-bone radius: use bone's own radiusMul, or lookup default, or 0.6
        const radiusMul: number = bone.radiusMul !== undefined ? bone.radiusMul
          : (SkinWeightCalculator.DEFAULT_RADII[bone.name] || 0.6);

        // Envelope = bone length * multiplier, with a small minimum to prevent zero
        const envelope: number = Math.max(bone.restLength * radiusMul, bbox.h * 0.03);

        if (dist < envelope) {
          const norm: number = dist / envelope;
          let w: number = Math.pow(1.0 - norm, falloffPower);

          // Side-awareness: penalize bones on the opposite side
          const isLeftBone: boolean = bone.name.startsWith('left');
          const isRightBone: boolean = bone.name.startsWith('right');
          const pointIsLeft: boolean = p.x < bbox.cx;

          if ((isLeftBone && !pointIsLeft) || (isRightBone && pointIsLeft)) {
            w *= 0.1;
          }

          // Penalize connector bones (collars, hip bridges) to reduce torso bleed
          if (bone.name.includes('Collar') || bone.name.includes('HipBone')) {
            w *= 0.4;
          }

          if (w > 0.001) {
            // Store t = projection along bone (0=head, 1=tail) for rigid blending
            boneWeights.push({ boneIndex: bone.index, weight: w, boneName: bone.name, t });
          }
        }
      }

      // Sort by weight descending, keep top N
      boneWeights.sort((a: BoneWeight, b: BoneWeight) => b.weight - a.weight);
      boneWeights.length = Math.min(boneWeights.length, maxInfluences);

      // Normalize
      const total: number = boneWeights.reduce((s: number, bw: BoneWeight) => s + bw.weight, 0);
      if (total > 0) {
        for (const bw of boneWeights) bw.weight /= total;
      } else {
        // Fallback: assign to nearest bone
        let minDist: number = Infinity;
        let nearestIdx: number = 0;
        let nearestT: number = 0;
        for (const bone of skeleton.bones) {
          const head: Vec2 = skeleton.joints[bone.from].rest;
          const tail: Vec2 = skeleton.joints[bone.to].rest;
          const { dist, t } = distToSegment(p, head, tail);
          if (dist < minDist) {
            minDist = dist;
            nearestIdx = bone.index;
            nearestT = t;
          }
        }
        boneWeights.push({ boneIndex: nearestIdx, weight: 1.0, boneName: '', t: nearestT });
      }

      weights.push(boneWeights);
    }

    return weights;
  }
}
