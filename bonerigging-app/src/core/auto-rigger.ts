import type { Joint, Bone, Skeleton } from '../types/skeleton';
import type { ParsedCharacter, BBox } from '../types/parsed';
import type { Vec2, Mat2x3 } from '../types/math';
import { V2, v2Dist, m2Translate, m2Rotate, m2Multiply, m2Invert } from './math';

interface WidthSlice {
  y: number;
  width: number;
  left: number;
  right: number;
  center: number;
}

interface ArmDetection {
  hasTpose: boolean;
  leftExtent: number;
  rightExtent: number;
}

interface JointDef {
  rest: Vec2;
  parent: string | null;
  name?: string;
  current?: Vec2;
}

interface BoneDef {
  name: string;
  from: string;
  to: string;
  index?: number;
  restAngle?: number;
  restLength?: number;
  bindMatrix?: Mat2x3;
  inverseBindMatrix?: Mat2x3;
}

export class AutoRigger {
  static createSkeleton(parsed: ParsedCharacter): Skeleton {
    const bb: BBox = parsed.bbox;
    const cx: number = bb.cx;
    const top: number = bb.minY;
    const h: number = bb.h;
    const w: number = bb.w;

    // Analyze horizontal width profile at different heights
    const slices: WidthSlice[] = AutoRigger._analyzeWidthProfile(parsed);

    // Detect if the character has extended arms (T-pose)
    const shoulderY: number = top + h * 0.20;
    const hipY: number = top + h * 0.47;
    const armDetection: ArmDetection = AutoRigger._detectArms(parsed, slices, shoulderY, hipY);

    // Anthropometric landmarks (fractions from top)
    const headCenter: number = top + h * 0.07;
    const neck: number = top + h * 0.15;
    const shoulderCenter: number = top + h * 0.20;
    const chest: number = top + h * 0.30;
    const spine: number = top + h * 0.38;
    const hips: number = top + h * 0.47;
    const kneeY: number = top + h * 0.72;
    const ankleY: number = top + h * 0.92;

    // Horizontal spread
    const shoulderWidth: number = AutoRigger._getWidthAt(slices, shoulderCenter) * 0.4;
    const hipWidth: number = AutoRigger._getWidthAt(slices, hips) * 0.35;
    const kneeSpread: number = hipWidth * 0.85;
    const ankleSpread: number = hipWidth * 0.75;

    const joints: Record<string, JointDef> = {};

    // Core spine
    joints.hips = { rest: V2(cx, hips), parent: null };
    joints.spine = { rest: V2(cx, spine), parent: 'hips' };
    joints.chest = { rest: V2(cx, chest), parent: 'spine' };
    joints.neck = { rest: V2(cx, neck), parent: 'chest' };
    joints.head = { rest: V2(cx, headCenter), parent: 'neck' };

    // Arms
    if (armDetection.hasTpose) {
      // T-pose: arms extend to the sides
      joints.leftShoulder = { rest: V2(cx - shoulderWidth, shoulderCenter), parent: 'chest' };
      joints.rightShoulder = { rest: V2(cx + shoulderWidth, shoulderCenter), parent: 'chest' };

      const armLen: number = armDetection.leftExtent ? (cx - armDetection.leftExtent) - shoulderWidth : w * 0.25;
      joints.leftElbow = { rest: V2(cx - shoulderWidth - armLen * 0.5, shoulderCenter), parent: 'leftShoulder' };
      joints.leftWrist = { rest: V2(cx - shoulderWidth - armLen * 0.95, shoulderCenter), parent: 'leftElbow' };
      joints.rightElbow = { rest: V2(cx + shoulderWidth + armLen * 0.5, shoulderCenter), parent: 'rightShoulder' };
      joints.rightWrist = { rest: V2(cx + shoulderWidth + armLen * 0.95, shoulderCenter), parent: 'rightElbow' };
    } else {
      // Arms down
      joints.leftShoulder = { rest: V2(cx - shoulderWidth, shoulderCenter), parent: 'chest' };
      joints.rightShoulder = { rest: V2(cx + shoulderWidth, shoulderCenter), parent: 'chest' };
      joints.leftElbow = { rest: V2(cx - shoulderWidth * 1.1, top + h * 0.38), parent: 'leftShoulder' };
      joints.leftWrist = { rest: V2(cx - shoulderWidth * 1.05, top + h * 0.52), parent: 'leftElbow' };
      joints.rightElbow = { rest: V2(cx + shoulderWidth * 1.1, top + h * 0.38), parent: 'rightShoulder' };
      joints.rightWrist = { rest: V2(cx + shoulderWidth * 1.05, top + h * 0.52), parent: 'rightElbow' };
    }

    // Legs
    joints.leftHip = { rest: V2(cx - hipWidth, hips), parent: 'hips' };
    joints.rightHip = { rest: V2(cx + hipWidth, hips), parent: 'hips' };
    joints.leftKnee = { rest: V2(cx - kneeSpread, kneeY), parent: 'leftHip' };
    joints.rightKnee = { rest: V2(cx + kneeSpread, kneeY), parent: 'rightHip' };
    joints.leftAnkle = { rest: V2(cx - ankleSpread, ankleY), parent: 'leftKnee' };
    joints.rightAnkle = { rest: V2(cx + ankleSpread, ankleY), parent: 'rightKnee' };

    // Feet
    const footLen: number = h * 0.04;
    joints.leftFoot = { rest: V2(cx - ankleSpread - footLen * 0.3, top + h * 0.97), parent: 'leftAnkle' };
    joints.rightFoot = { rest: V2(cx + ankleSpread + footLen * 0.3, top + h * 0.97), parent: 'rightAnkle' };

    // Fingers -- 3 per hand: thumb, index, pinky
    // Compute finger length based on arm detection
    const addFingers = (side: string, wristJoint: JointDef): void => {
      const wr: Vec2 = wristJoint.rest;
      const sign: number = side === 'left' ? -1 : 1;
      const fingerLen: number = h * 0.04;

      if (armDetection.hasTpose) {
        // T-pose: fingers extend horizontally outward, fanned slightly
        joints[side + 'Hand']   = { rest: V2(wr.x + sign * fingerLen * 0.6, wr.y), parent: side + 'Wrist' };
        joints[side + 'Thumb']  = { rest: V2(wr.x + sign * fingerLen * 0.4, wr.y + fingerLen * 0.7), parent: side + 'Hand' };
        joints[side + 'Index']  = { rest: V2(wr.x + sign * fingerLen * 1.35, wr.y - fingerLen * 0.3), parent: side + 'Hand' };
        joints[side + 'Middle'] = { rest: V2(wr.x + sign * fingerLen * 1.4, wr.y), parent: side + 'Hand' };
        joints[side + 'Ring']   = { rest: V2(wr.x + sign * fingerLen * 1.3, wr.y + fingerLen * 0.25), parent: side + 'Hand' };
        joints[side + 'Pinky']  = { rest: V2(wr.x + sign * fingerLen * 1.15, wr.y + fingerLen * 0.45), parent: side + 'Hand' };
      } else {
        // Arms down: fingers extend downward, fanned slightly
        joints[side + 'Hand']   = { rest: V2(wr.x, wr.y + fingerLen * 0.6), parent: side + 'Wrist' };
        joints[side + 'Thumb']  = { rest: V2(wr.x + sign * fingerLen * 0.6, wr.y + fingerLen * 0.5), parent: side + 'Hand' };
        joints[side + 'Index']  = { rest: V2(wr.x - sign * fingerLen * 0.25, wr.y + fingerLen * 1.35), parent: side + 'Hand' };
        joints[side + 'Middle'] = { rest: V2(wr.x, wr.y + fingerLen * 1.4), parent: side + 'Hand' };
        joints[side + 'Ring']   = { rest: V2(wr.x + sign * fingerLen * 0.2, wr.y + fingerLen * 1.3), parent: side + 'Hand' };
        joints[side + 'Pinky']  = { rest: V2(wr.x + sign * fingerLen * 0.35, wr.y + fingerLen * 1.15), parent: side + 'Hand' };
      }
    };

    addFingers('left', joints.leftWrist);
    addFingers('right', joints.rightWrist);

    // Build bones
    const bones: BoneDef[] = [
      { name: 'spine', from: 'hips', to: 'spine' },
      { name: 'chest', from: 'spine', to: 'chest' },
      { name: 'neck', from: 'chest', to: 'neck' },
      { name: 'head', from: 'neck', to: 'head' },
      { name: 'leftCollar', from: 'chest', to: 'leftShoulder' },
      { name: 'rightCollar', from: 'chest', to: 'rightShoulder' },
      { name: 'leftUpperArm', from: 'leftShoulder', to: 'leftElbow' },
      { name: 'leftForearm', from: 'leftElbow', to: 'leftWrist' },
      { name: 'rightUpperArm', from: 'rightShoulder', to: 'rightElbow' },
      { name: 'rightForearm', from: 'rightElbow', to: 'rightWrist' },
      // Hands & fingers
      { name: 'leftHand', from: 'leftWrist', to: 'leftHand' },
      { name: 'leftThumb', from: 'leftHand', to: 'leftThumb' },
      { name: 'leftIndex', from: 'leftHand', to: 'leftIndex' },
      { name: 'leftMiddle', from: 'leftHand', to: 'leftMiddle' },
      { name: 'leftRing', from: 'leftHand', to: 'leftRing' },
      { name: 'leftPinky', from: 'leftHand', to: 'leftPinky' },
      { name: 'rightHand', from: 'rightWrist', to: 'rightHand' },
      { name: 'rightThumb', from: 'rightHand', to: 'rightThumb' },
      { name: 'rightIndex', from: 'rightHand', to: 'rightIndex' },
      { name: 'rightMiddle', from: 'rightHand', to: 'rightMiddle' },
      { name: 'rightRing', from: 'rightHand', to: 'rightRing' },
      { name: 'rightPinky', from: 'rightHand', to: 'rightPinky' },
      // Hips & legs
      { name: 'leftHipBone', from: 'hips', to: 'leftHip' },
      { name: 'rightHipBone', from: 'hips', to: 'rightHip' },
      { name: 'leftThigh', from: 'leftHip', to: 'leftKnee' },
      { name: 'leftShin', from: 'leftKnee', to: 'leftAnkle' },
      { name: 'rightThigh', from: 'rightHip', to: 'rightKnee' },
      { name: 'rightShin', from: 'rightKnee', to: 'rightAnkle' },
      // Feet
      { name: 'leftFoot', from: 'leftAnkle', to: 'leftFoot' },
      { name: 'rightFoot', from: 'rightAnkle', to: 'rightFoot' },
    ];

    // Initialize current positions and compute rest data
    for (const [name, joint] of Object.entries(joints)) {
      joint.name = name;
      joint.current = V2(joint.rest.x, joint.rest.y);
    }

    bones.forEach((bone: BoneDef, i: number) => {
      bone.index = i;
      const head: Vec2 = joints[bone.from].rest;
      const tail: Vec2 = joints[bone.to].rest;
      bone.restAngle = Math.atan2(tail.y - head.y, tail.x - head.x);
      bone.restLength = v2Dist(head, tail);

      // Bind matrix: world -> bone local
      const T: Mat2x3 = m2Translate(-head.x, -head.y);
      const R: Mat2x3 = m2Rotate(-bone.restAngle);
      bone.bindMatrix = m2Multiply(R, T);
      bone.inverseBindMatrix = m2Invert(bone.bindMatrix);
    });

    return { joints: joints as Record<string, Joint>, bones: bones as Bone[] };
  }

  static _analyzeWidthProfile(parsed: ParsedCharacter): WidthSlice[] {
    const bb: BBox = parsed.bbox;
    const numSlices: number = 50;
    const slices: WidthSlice[] = [];

    for (let i = 0; i <= numSlices; i++) {
      const y: number = bb.minY + (i / numSlices) * bb.h;
      let minX: number = Infinity;
      let maxX: number = -Infinity;
      let found: boolean = false;

      for (const path of parsed.paths) {
        for (const pt of path.sampledPoints) {
          if (Math.abs(pt.y - y) < bb.h / numSlices) {
            minX = Math.min(minX, pt.x);
            maxX = Math.max(maxX, pt.x);
            found = true;
          }
        }
      }

      slices.push({
        y,
        width: found ? maxX - minX : 0,
        left: found ? minX : bb.cx,
        right: found ? maxX : bb.cx,
        center: found ? (minX + maxX) / 2 : bb.cx,
      });
    }

    return slices;
  }

  static _getWidthAt(slices: WidthSlice[], y: number): number {
    let closest: WidthSlice = slices[0];
    let minDist: number = Infinity;
    for (const s of slices) {
      const d: number = Math.abs(s.y - y);
      if (d < minDist) {
        minDist = d;
        closest = s;
      }
    }
    return closest.width;
  }

  static _detectArms(_parsed: ParsedCharacter, slices: WidthSlice[], shoulderY: number, hipY: number): ArmDetection {
    // Check if width at shoulder level is significantly wider than at hip level
    const shoulderSlice: WidthSlice = slices.reduce((best: WidthSlice, s: WidthSlice) =>
      Math.abs(s.y - shoulderY) < Math.abs(best.y - shoulderY) ? s : best, slices[0]);
    const hipSlice: WidthSlice = slices.reduce((best: WidthSlice, s: WidthSlice) =>
      Math.abs(s.y - hipY) < Math.abs(best.y - hipY) ? s : best, slices[0]);

    const ratio: number = shoulderSlice.width / (hipSlice.width || 1);
    const hasTpose: boolean = ratio > 1.8;

    return {
      hasTpose,
      leftExtent: shoulderSlice.left,
      rightExtent: shoulderSlice.right,
    };
  }
}
