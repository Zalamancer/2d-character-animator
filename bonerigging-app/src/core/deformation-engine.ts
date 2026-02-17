import type { Skeleton } from '../types/skeleton';
import type { BoneWeight } from '../types/weights';
import type { Vec2 } from '../types/math';
import type { ControlPoint } from '../types/parsed';
import { V2, v2Len, v2Sub, v2Lerp, angleNorm } from './math';

export interface BoneData {
  deltaAngle: number;
  headRest: Vec2;
  tailRest: Vec2;
  headCur: Vec2;
  tailCur: Vec2;
  scaleFactor: number;
  perpScale: number;
}

export class DeformationEngine {
  // Compute per-bone data for deformation: rotation delta + joint positions.
  // No matrix needed -- deformation works by rotating points around joints.
  static computeBoneData(skeleton: Skeleton, squashStretchEnabled: boolean): BoneData[] {
    const data: BoneData[] = [];

    for (const bone of skeleton.bones) {
      const headRest: Vec2 = skeleton.joints[bone.from].rest;
      const tailRest: Vec2 = skeleton.joints[bone.to].rest;
      const headCur: Vec2 = skeleton.joints[bone.from].current;
      const tailCur: Vec2 = skeleton.joints[bone.to].current;

      const curAngle: number = Math.atan2(tailCur.y - headCur.y, tailCur.x - headCur.x);
      const deltaAngle: number = curAngle - bone.restAngle;

      // Squash & stretch: compute scale factor along bone axis
      let scaleFactor: number = 1;
      let perpScale: number = 1;
      if (squashStretchEnabled) {
        const restLen: number = bone.restLength || v2Len(v2Sub(tailRest, headRest));
        const curLen: number = v2Len(v2Sub(tailCur, headCur));
        if (restLen > 0.001) {
          scaleFactor = Math.max(0.1, Math.min(curLen / restLen, 10));
          // Area preservation: perpendicular scale is inverse of clamped scale
          perpScale = Math.max(0.1, Math.min(1 / scaleFactor, 10));
        }
      }

      data[bone.index] = {
        deltaAngle,
        headRest, tailRest,
        headCur, tailCur,
        scaleFactor, perpScale,
      };
    }

    return data;
  }

  // Kept for API compatibility -- just calls computeBoneData
  static computeBoneMatrices(skeleton: Skeleton, squashStretchEnabled: boolean): BoneData[] {
    return DeformationEngine.computeBoneData(skeleton, squashStretchEnabled);
  }

  // Deform a point by rotating it around the appropriate joint pivot.
  //
  // For each influencing bone, we find the nearest joint (head or tail based on
  // projection t along the bone), then rotate the point around that joint's
  // rest position by the bone's delta angle, and translate by the joint's
  // rest->current displacement.
  //
  // When blending multiple bones, we interpolate the rotation angles and compute
  // a weighted pivot -- this keeps the point orbiting the joint area instead of
  // drifting outward (which standard LBS position-averaging causes).
  static deformPoint(restPos: Vec2, boneWeights: BoneWeight[], boneData: BoneData[], squashStretchEnabled: boolean): Vec2 {
    if (boneWeights.length === 0) return V2(restPos.x, restPos.y);

    // Single bone fast path
    if (boneWeights.length === 1) {
      const bw: BoneWeight = boneWeights[0];
      const bd: BoneData | undefined = boneData[bw.boneIndex];
      if (!bd) return V2(restPos.x, restPos.y);
      const t: number = bw.t || 0;
      const pivotRest: Vec2 = v2Lerp(bd.headRest, bd.tailRest, t);
      const pivotCur: Vec2 = v2Lerp(bd.headCur, bd.tailCur, t);
      const offset: Vec2 = v2Sub(restPos, pivotRest);
      const cos: number = Math.cos(bd.deltaAngle);
      const sin: number = Math.sin(bd.deltaAngle);
      let rx: number = offset.x * cos - offset.y * sin;
      let ry: number = offset.x * sin + offset.y * cos;
      // Squash & stretch: decompose into bone-axis and perpendicular, scale perpendicular
      if (squashStretchEnabled && (bd.scaleFactor !== 1 || bd.perpScale !== 1)) {
        const boneAngle: number = Math.atan2(bd.tailCur.y - bd.headCur.y, bd.tailCur.x - bd.headCur.x);
        const bc: number = Math.cos(boneAngle);
        const bs: number = Math.sin(boneAngle);
        // Project rotated offset into bone-local frame
        const along: number = rx * bc + ry * bs;
        const perp: number = -rx * bs + ry * bc;
        // Scale: along by scaleFactor, perp by perpScale
        const sAlong: number = along * bd.scaleFactor;
        const sPerp: number = perp * bd.perpScale;
        // Rotate back to world frame
        rx = sAlong * bc - sPerp * bs;
        ry = sAlong * bs + sPerp * bc;
      }
      return V2(pivotCur.x + rx, pivotCur.y + ry);
    }

    // Multi-bone: blend rotation angles and pivots
    const firstBd: BoneData | undefined = boneData[boneWeights[0].boneIndex];
    if (!firstBd) return V2(restPos.x, restPos.y);
    const refAngle: number = firstBd.deltaAngle;

    let blendedAngle: number = 0;
    let pivotRestX: number = 0;
    let pivotRestY: number = 0;
    let pivotCurX: number = 0;
    let pivotCurY: number = 0;
    let blendedScaleFactor: number = 0;
    let blendedPerpScale: number = 0;
    let blendedBoneAngle: number = 0;
    let refBoneAngle: number = 0;
    let firstBoneAngleSet: boolean = false;

    for (const { boneIndex, weight, t } of boneWeights) {
      const bd: BoneData | undefined = boneData[boneIndex];
      if (!bd) continue;
      const tt: number = t || 0;

      blendedAngle += weight * angleNorm(bd.deltaAngle - refAngle);

      const prx: number = bd.headRest.x + tt * (bd.tailRest.x - bd.headRest.x);
      const pry: number = bd.headRest.y + tt * (bd.tailRest.y - bd.headRest.y);
      const pcx: number = bd.headCur.x + tt * (bd.tailCur.x - bd.headCur.x);
      const pcy: number = bd.headCur.y + tt * (bd.tailCur.y - bd.headCur.y);
      pivotRestX += weight * prx;
      pivotRestY += weight * pry;
      pivotCurX += weight * pcx;
      pivotCurY += weight * pcy;

      if (squashStretchEnabled) {
        blendedScaleFactor += weight * bd.scaleFactor;
        blendedPerpScale += weight * bd.perpScale;
        const ba: number = Math.atan2(bd.tailCur.y - bd.headCur.y, bd.tailCur.x - bd.headCur.x);
        if (!firstBoneAngleSet) { refBoneAngle = ba; firstBoneAngleSet = true; }
        blendedBoneAngle += weight * angleNorm(ba - refBoneAngle);
      }
    }
    if (squashStretchEnabled) blendedBoneAngle += refBoneAngle;
    blendedAngle += refAngle;

    const ox: number = restPos.x - pivotRestX;
    const oy: number = restPos.y - pivotRestY;
    const cos: number = Math.cos(blendedAngle);
    const sin: number = Math.sin(blendedAngle);
    let rx: number = ox * cos - oy * sin;
    let ry: number = ox * sin + oy * cos;

    if (squashStretchEnabled && (blendedScaleFactor !== 0)) {
      const bc: number = Math.cos(blendedBoneAngle);
      const bs: number = Math.sin(blendedBoneAngle);
      const along: number = rx * bc + ry * bs;
      const perp: number = -rx * bs + ry * bc;
      const sAlong: number = along * blendedScaleFactor;
      const sPerp: number = perp * blendedPerpScale;
      rx = sAlong * bc - sPerp * bs;
      ry = sAlong * bs + sPerp * bc;
    }

    return V2(pivotCurX + rx, pivotCurY + ry);
  }

  static deformControlPoints(
    controlPoints: ControlPoint[],
    weights: BoneWeight[][],
    boneMatrices: BoneData[],
    squashStretchEnabled: boolean,
  ): Vec2[] {
    const deformed: Vec2[] = [];
    for (let i = 0; i < controlPoints.length; i++) {
      deformed.push(DeformationEngine.deformPoint(
        controlPoints[i].point,
        weights[i],
        boneMatrices,
        squashStretchEnabled,
      ));
    }
    return deformed;
  }

  // In-place deformation: writes into existing output array to avoid allocations
  static deformInPlace(
    controlPoints: ControlPoint[],
    weights: BoneWeight[][],
    boneData: BoneData[],
    out: Vec2[],
    squashStretchEnabled: boolean,
  ): void {
    for (let i = 0; i < controlPoints.length; i++) {
      const restPos: Vec2 = controlPoints[i].point;
      const boneWeights: BoneWeight[] = weights[i];

      if (!boneWeights || boneWeights.length === 0) {
        out[i].x = restPos.x;
        out[i].y = restPos.y;
        continue;
      }

      if (boneWeights.length === 1) {
        const bw: BoneWeight = boneWeights[0];
        const bd: BoneData | undefined = boneData[bw.boneIndex];
        if (!bd) { out[i].x = restPos.x; out[i].y = restPos.y; continue; }
        const t: number = bw.t || 0;
        const prx: number = bd.headRest.x + t * (bd.tailRest.x - bd.headRest.x);
        const pry: number = bd.headRest.y + t * (bd.tailRest.y - bd.headRest.y);
        const pcx: number = bd.headCur.x + t * (bd.tailCur.x - bd.headCur.x);
        const pcy: number = bd.headCur.y + t * (bd.tailCur.y - bd.headCur.y);
        const ox: number = restPos.x - prx;
        const oy: number = restPos.y - pry;
        const cos: number = Math.cos(bd.deltaAngle);
        const sin: number = Math.sin(bd.deltaAngle);
        let rx: number = ox * cos - oy * sin;
        let ry: number = ox * sin + oy * cos;
        // Squash & stretch
        if (squashStretchEnabled && (bd.scaleFactor !== 1 || bd.perpScale !== 1)) {
          const boneAngle: number = Math.atan2(bd.tailCur.y - bd.headCur.y, bd.tailCur.x - bd.headCur.x);
          const bc: number = Math.cos(boneAngle);
          const bs: number = Math.sin(boneAngle);
          const along: number = rx * bc + ry * bs;
          const perp: number = -rx * bs + ry * bc;
          const sAlong: number = along * bd.scaleFactor;
          const sPerp: number = perp * bd.perpScale;
          rx = sAlong * bc - sPerp * bs;
          ry = sAlong * bs + sPerp * bc;
        }
        out[i].x = pcx + rx;
        out[i].y = pcy + ry;
        continue;
      }

      // Multi-bone blend
      const firstBd: BoneData | undefined = boneData[boneWeights[0].boneIndex];
      if (!firstBd) { out[i].x = restPos.x; out[i].y = restPos.y; continue; }
      const refAngle: number = firstBd.deltaAngle;

      let blendedAngle: number = 0;
      let prxB: number = 0;
      let pryB: number = 0;
      let pcxB: number = 0;
      let pcyB: number = 0;
      let bsf: number = 0;
      let bps: number = 0;
      let bba: number = 0;
      let refBA: number = 0;
      let firstBA: boolean = true;

      for (let j = 0; j < boneWeights.length; j++) {
        const bw: BoneWeight = boneWeights[j];
        const bd: BoneData | undefined = boneData[bw.boneIndex];
        if (!bd) continue;
        const tt: number = bw.t || 0;
        const w: number = bw.weight;
        blendedAngle += w * angleNorm(bd.deltaAngle - refAngle);
        prxB += w * (bd.headRest.x + tt * (bd.tailRest.x - bd.headRest.x));
        pryB += w * (bd.headRest.y + tt * (bd.tailRest.y - bd.headRest.y));
        pcxB += w * (bd.headCur.x + tt * (bd.tailCur.x - bd.headCur.x));
        pcyB += w * (bd.headCur.y + tt * (bd.tailCur.y - bd.headCur.y));
        if (squashStretchEnabled) {
          bsf += w * bd.scaleFactor;
          bps += w * bd.perpScale;
          const ba2: number = Math.atan2(bd.tailCur.y - bd.headCur.y, bd.tailCur.x - bd.headCur.x);
          if (firstBA) { refBA = ba2; firstBA = false; }
          bba += w * angleNorm(ba2 - refBA);
        }
      }
      blendedAngle += refAngle;
      if (squashStretchEnabled) bba += refBA;
      const ox: number = restPos.x - prxB;
      const oy: number = restPos.y - pryB;
      const cos: number = Math.cos(blendedAngle);
      const sin: number = Math.sin(blendedAngle);
      let rx: number = ox * cos - oy * sin;
      let ry: number = ox * sin + oy * cos;
      if (squashStretchEnabled && bsf !== 0) {
        const bc: number = Math.cos(bba);
        const bs2: number = Math.sin(bba);
        const along: number = rx * bc + ry * bs2;
        const perp2: number = -rx * bs2 + ry * bc;
        rx = along * bsf * bc - perp2 * bps * bs2;
        ry = along * bsf * bs2 + perp2 * bps * bc;
      }
      out[i].x = pcxB + rx;
      out[i].y = pcyB + ry;
    }
  }
}
