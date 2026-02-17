import type { Joint, Bone, Skeleton } from '../types/skeleton';
import type { ParsedCharacter, BBox } from '../types/parsed';
import type { Vec2, Mat2x3 } from '../types/math';
import { V2, v2Dist, m2Translate, m2Rotate, m2Multiply, m2Invert } from './math';
import { SilhouetteAnalyzer, type BodyLandmarks } from './silhouette-analyzer';

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
    // If we have an alpha grid (raster image), use precise silhouette analysis
    if (parsed.alphaGrid) {
      const landmarks = SilhouetteAnalyzer.analyze(parsed.alphaGrid, parsed.bbox);
      return AutoRigger._createFromLandmarks(parsed.bbox, landmarks);
    }

    // SVG fallback: use legacy width-profile approach
    return AutoRigger._createLegacy(parsed);
  }

  /**
   * Create skeleton from precise alpha-grid landmarks.
   */
  static _createFromLandmarks(bb: BBox, lm: BodyLandmarks): Skeleton {
    const cx = bb.cx;
    const joints: Record<string, JointDef> = {};

    // Helper: lerp between two Y values
    const lerpY = (a: number, b: number, t: number): number => a + (b - a) * t;

    // Core spine — hip at waist/belt, chest horizontally aligned with shoulders,
    // spine exactly between chest and hips.
    // Neck at the very top of the character (since characters may not have a head),
    // head placed slightly above.
    joints.hips   = { rest: V2(cx, lm.hipY), parent: null };
    joints.spine  = { rest: V2(cx, lerpY(lm.hipY, lm.shoulderY, 0.50)), parent: 'hips' };
    joints.chest  = { rest: V2(cx, lm.shoulderY), parent: 'spine' };
    joints.neck   = { rest: V2(cx, lm.topY), parent: 'chest' };
    joints.head   = { rest: V2(cx, lm.topY - (lm.shoulderY - lm.topY) * 0.3), parent: 'neck' };

    // Shoulders
    joints.leftShoulder  = { rest: V2(lm.shoulderLeftX, lm.shoulderY), parent: 'chest' };
    joints.rightShoulder = { rest: V2(lm.shoulderRightX, lm.shoulderY), parent: 'chest' };

    // Arms — use detected elbow and wrist positions
    joints.leftElbow  = { rest: V2(lm.leftElbow.x, lm.leftElbow.y), parent: 'leftShoulder' };
    joints.leftWrist  = { rest: V2(lm.leftWrist.x, lm.leftWrist.y), parent: 'leftElbow' };
    joints.rightElbow = { rest: V2(lm.rightElbow.x, lm.rightElbow.y), parent: 'rightShoulder' };
    joints.rightWrist = { rest: V2(lm.rightWrist.x, lm.rightWrist.y), parent: 'rightElbow' };

    // Hands — midpoint between wrist and average finger position
    const avgFingerPos = (fingers: Vec2[]): Vec2 => {
      if (fingers.length === 0) return V2(0, 0);
      let sx = 0, sy = 0;
      for (const f of fingers) { sx += f.x; sy += f.y; }
      return V2(sx / fingers.length, sy / fingers.length);
    };
    const leftHandPos = avgFingerPos(lm.leftFingers);
    const rightHandPos = avgFingerPos(lm.rightFingers);
    joints.leftHand  = { rest: V2(
      (lm.leftWrist.x + leftHandPos.x) / 2,
      (lm.leftWrist.y + leftHandPos.y) / 2
    ), parent: 'leftWrist' };
    joints.rightHand = { rest: V2(
      (lm.rightWrist.x + rightHandPos.x) / 2,
      (lm.rightWrist.y + rightHandPos.y) / 2
    ), parent: 'rightWrist' };

    // Fingers — use detected finger tip positions
    // Order: [thumb, index, middle, ring, pinky]
    const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    for (let i = 0; i < 5; i++) {
      const name = fingerNames[i];
      if (i < lm.leftFingers.length) {
        joints['left' + name] = { rest: V2(lm.leftFingers[i].x, lm.leftFingers[i].y), parent: 'leftHand' };
      }
      if (i < lm.rightFingers.length) {
        joints['right' + name] = { rest: V2(lm.rightFingers[i].x, lm.rightFingers[i].y), parent: 'rightHand' };
      }
    }

    // Hips
    joints.leftHip  = { rest: V2(lm.hipLeftX, lm.hipY), parent: 'hips' };
    joints.rightHip = { rest: V2(lm.hipRightX, lm.hipY), parent: 'hips' };

    // Legs — use detected knee and ankle positions
    joints.leftKnee   = { rest: V2(lm.leftKnee.x, lm.leftKnee.y), parent: 'leftHip' };
    joints.rightKnee  = { rest: V2(lm.rightKnee.x, lm.rightKnee.y), parent: 'rightHip' };
    joints.leftAnkle  = { rest: V2(lm.leftAnkle.x, lm.leftAnkle.y), parent: 'leftKnee' };
    joints.rightAnkle = { rest: V2(lm.rightAnkle.x, lm.rightAnkle.y), parent: 'rightKnee' };

    // Feet
    joints.leftFoot  = { rest: V2(lm.leftFootTip.x, lm.leftFootTip.y), parent: 'leftAnkle' };
    joints.rightFoot = { rest: V2(lm.rightFootTip.x, lm.rightFootTip.y), parent: 'rightAnkle' };

    return AutoRigger._finalize(joints);
  }

  /**
   * Legacy skeleton creation using width-profile heuristics (for SVG / no alpha grid).
   */
  static _createLegacy(parsed: ParsedCharacter): Skeleton {
    const bb: BBox = parsed.bbox;
    const cx: number = bb.cx;
    const top: number = bb.minY;
    const h: number = bb.h;
    const w: number = bb.w;

    const slices: WidthSlice[] = AutoRigger._analyzeWidthProfile(parsed);

    const shoulderY: number = top + h * 0.20;
    const hipY: number = top + h * 0.47;
    const armDetection: ArmDetection = AutoRigger._detectArms(parsed, slices, shoulderY, hipY);

    const headCenter: number = top + h * 0.07;
    const neck: number = top + h * 0.15;
    const shoulderCenter: number = top + h * 0.20;
    const chest: number = top + h * 0.30;
    const spine: number = top + h * 0.38;
    const hips: number = top + h * 0.47;
    const kneeY: number = top + h * 0.72;
    const ankleY: number = top + h * 0.92;

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
      joints.leftShoulder = { rest: V2(cx - shoulderWidth, shoulderCenter), parent: 'chest' };
      joints.rightShoulder = { rest: V2(cx + shoulderWidth, shoulderCenter), parent: 'chest' };

      const armLen: number = armDetection.leftExtent ? (cx - armDetection.leftExtent) - shoulderWidth : w * 0.25;
      joints.leftElbow = { rest: V2(cx - shoulderWidth - armLen * 0.5, shoulderCenter), parent: 'leftShoulder' };
      joints.leftWrist = { rest: V2(cx - shoulderWidth - armLen * 0.95, shoulderCenter), parent: 'leftElbow' };
      joints.rightElbow = { rest: V2(cx + shoulderWidth + armLen * 0.5, shoulderCenter), parent: 'rightShoulder' };
      joints.rightWrist = { rest: V2(cx + shoulderWidth + armLen * 0.95, shoulderCenter), parent: 'rightElbow' };
    } else {
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

    // Fingers
    const addFingers = (side: string, wristJoint: JointDef): void => {
      const wr: Vec2 = wristJoint.rest;
      const sign: number = side === 'left' ? -1 : 1;
      const fingerLen: number = h * 0.04;

      if (armDetection.hasTpose) {
        joints[side + 'Hand']   = { rest: V2(wr.x + sign * fingerLen * 0.6, wr.y), parent: side + 'Wrist' };
        joints[side + 'Thumb']  = { rest: V2(wr.x + sign * fingerLen * 0.4, wr.y + fingerLen * 0.7), parent: side + 'Hand' };
        joints[side + 'Index']  = { rest: V2(wr.x + sign * fingerLen * 1.35, wr.y - fingerLen * 0.3), parent: side + 'Hand' };
        joints[side + 'Middle'] = { rest: V2(wr.x + sign * fingerLen * 1.4, wr.y), parent: side + 'Hand' };
        joints[side + 'Ring']   = { rest: V2(wr.x + sign * fingerLen * 1.3, wr.y + fingerLen * 0.25), parent: side + 'Hand' };
        joints[side + 'Pinky']  = { rest: V2(wr.x + sign * fingerLen * 1.15, wr.y + fingerLen * 0.45), parent: side + 'Hand' };
      } else {
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

    return AutoRigger._finalize(joints);
  }

  /**
   * Shared finalization: set current = rest, build bones, compute bind matrices.
   */
  static _finalize(joints: Record<string, JointDef>): Skeleton {
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
      { name: 'leftHipBone', from: 'hips', to: 'leftHip' },
      { name: 'rightHipBone', from: 'hips', to: 'rightHip' },
      { name: 'leftThigh', from: 'leftHip', to: 'leftKnee' },
      { name: 'leftShin', from: 'leftKnee', to: 'leftAnkle' },
      { name: 'rightThigh', from: 'rightHip', to: 'rightKnee' },
      { name: 'rightShin', from: 'rightKnee', to: 'rightAnkle' },
      { name: 'leftFoot', from: 'leftAnkle', to: 'leftFoot' },
      { name: 'rightFoot', from: 'rightAnkle', to: 'rightFoot' },
    ];

    // Initialize current positions
    for (const [name, joint] of Object.entries(joints)) {
      joint.name = name;
      joint.current = V2(joint.rest.x, joint.rest.y);
    }

    // Per-body-part influence radius multipliers.
    // Larger body parts get bigger envelopes, smaller ones get smaller.
    const radiusMap: Record<string, number> = {
      // Torso — large
      spine: 1.2,
      chest: 1.2,
      // Neck / head — medium
      neck: 0.6,
      head: 0.8,
      // Shoulder collars — small
      leftCollar: 0.5,
      rightCollar: 0.5,
      // Upper arms — medium-large
      leftUpperArm: 0.9,
      rightUpperArm: 0.9,
      // Forearms — medium
      leftForearm: 0.7,
      rightForearm: 0.7,
      // Hands — small
      leftHand: 0.4,
      rightHand: 0.4,
      // Fingers — very small
      leftThumb: 0.15,
      leftIndex: 0.12,
      leftMiddle: 0.12,
      leftRing: 0.10,
      leftPinky: 0.08,
      rightThumb: 0.15,
      rightIndex: 0.12,
      rightMiddle: 0.12,
      rightRing: 0.10,
      rightPinky: 0.08,
      // Hip bones — small
      leftHipBone: 0.5,
      rightHipBone: 0.5,
      // Thighs — large
      leftThigh: 1.0,
      rightThigh: 1.0,
      // Shins — medium
      leftShin: 0.8,
      rightShin: 0.8,
      // Feet — small-medium
      leftFoot: 0.5,
      rightFoot: 0.5,
    };

    // Compute bone rest data, bind matrices, and assign radiusMul
    bones.forEach((bone: BoneDef, i: number) => {
      bone.index = i;
      const head: Vec2 = joints[bone.from].rest;
      const tail: Vec2 = joints[bone.to].rest;
      bone.restAngle = Math.atan2(tail.y - head.y, tail.x - head.x);
      bone.restLength = v2Dist(head, tail);

      const T: Mat2x3 = m2Translate(-head.x, -head.y);
      const R: Mat2x3 = m2Rotate(-bone.restAngle);
      bone.bindMatrix = m2Multiply(R, T);
      bone.inverseBindMatrix = m2Invert(bone.bindMatrix);

      // Assign per-body-part influence radius
      if (radiusMap[bone.name] !== undefined) {
        (bone as BoneDef & { radiusMul?: number }).radiusMul = radiusMap[bone.name];
      }
    });

    return { joints: joints as Record<string, Joint>, bones: bones as Bone[] };
  }

  // ---- Legacy helpers (used by _createLegacy for SVG) ----

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
