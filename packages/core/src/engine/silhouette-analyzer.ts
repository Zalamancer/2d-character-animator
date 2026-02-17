import type { Vec2 } from '../types/math';
import type { AlphaGrid, BBox } from '../types/parsed';
import { V2, clamp } from './math';

/**
 * Body landmarks detected from the alpha-grid silhouette of a T-pose humanoid.
 * All coordinates are in original image space (NOT analysis-scale).
 */
export interface BodyLandmarks {
  topY: number;
  shoulderY: number;
  shoulderLeftX: number;
  shoulderRightX: number;
  waistY: number;        // narrowest torso point (belt / navel area)
  hipY: number;
  hipLeftX: number;
  hipRightX: number;
  crotchY: number;

  leftArmTip: Vec2;
  rightArmTip: Vec2;
  leftElbow: Vec2;
  rightElbow: Vec2;
  leftWrist: Vec2;
  rightWrist: Vec2;

  leftFingers: Vec2[];  // [thumb, index, middle, ring, pinky]
  rightFingers: Vec2[];

  leftKnee: Vec2;
  rightKnee: Vec2;
  leftAnkle: Vec2;
  rightAnkle: Vec2;
  leftFootTip: Vec2;
  rightFootTip: Vec2;
}

/** Row span data at a given row */
interface RowSpan {
  y: number;       // row in analysis coords
  left: number;    // leftmost opaque x
  right: number;   // rightmost opaque x
  width: number;
  center: number;
}

/** A vertical column profile entry (for arm analysis) */
interface ColProfile {
  x: number;
  topY: number;
  bottomY: number;
  height: number;
}

const ALPHA_THRESH = 10;

export class SilhouetteAnalyzer {
  /**
   * Analyze an alpha grid to detect body landmarks for a T-pose humanoid.
   * Returns landmarks in original image coordinates.
   */
  static analyze(grid: AlphaGrid, bbox: BBox): BodyLandmarks {
    const { data, width: gw, height: gh, scale } = grid;
    const toOrig = (x: number, y: number): Vec2 => V2(x / scale, y / scale);

    // Helper: is pixel opaque?
    const opaque = (x: number, y: number): boolean => {
      if (x < 0 || x >= gw || y < 0 || y >= gh) return false;
      return data[(y * gw + x) * 4 + 3] > ALPHA_THRESH;
    };

    // Compute row spans for every row in the bbox (analysis coords)
    const minAY = Math.max(0, Math.round(bbox.minY * scale));
    const maxAY = Math.min(gh - 1, Math.round(bbox.maxY * scale));
    const minAX = Math.max(0, Math.round(bbox.minX * scale));
    const maxAX = Math.min(gw - 1, Math.round(bbox.maxX * scale));
    const cx = Math.round(bbox.cx * scale);

    const rows: RowSpan[] = [];
    for (let y = minAY; y <= maxAY; y++) {
      let left = -1, right = -1;
      for (let x = minAX; x <= maxAX; x++) {
        if (opaque(x, y)) {
          if (left === -1) left = x;
          right = x;
        }
      }
      if (left !== -1) {
        rows.push({ y, left, right, width: right - left, center: (left + right) / 2 });
      } else {
        rows.push({ y, left: cx, right: cx, width: 0, center: cx });
      }
    }

    if (rows.length === 0) {
      return SilhouetteAnalyzer._fallback(bbox);
    }

    // ------- 1. TOP OF CHARACTER -------
    const topRow = rows.find(r => r.width > 0) || rows[0];
    const topAY = topRow.y;
    const totalH = maxAY - topAY;

    // ------- 2. SHOULDER DETECTION -------
    // Strategy: Shoulder is where horizontal extent dramatically increases,
    // indicating arms extending outward from the torso.
    // We look at the derivative of width to find the biggest jump.

    // Get smoothed widths
    const smoothedWidths = SilhouetteAnalyzer._smooth(rows.map(r => r.width), 7);

    // Head region: top 12% of character height
    const headEndY = topAY + Math.round(totalH * 0.12);

    // Measure average head width
    let headWidth = 0;
    let headCount = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].y >= topAY && rows[i].y <= headEndY && rows[i].width > 0) {
        headWidth += rows[i].width;
        headCount++;
      }
    }
    headWidth = headCount > 0 ? headWidth / headCount : (maxAX - minAX) * 0.15;

    // Find shoulder Y: scan from head downward looking for where width exceeds
    // 2.5× head width. This catches the T-pose arm extension.
    // Also require the width to be a significant fraction of total width.
    let shoulderAY = topAY + Math.round(totalH * 0.18);
    const minShoulderSearch = topAY + Math.round(totalH * 0.10);
    const maxShoulderSearch = topAY + Math.round(totalH * 0.35);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.y < minShoulderSearch || r.y > maxShoulderSearch) continue;
      const sw = smoothedWidths[i];
      if (sw > headWidth * 2.5 && sw > (maxAX - minAX) * 0.55) {
        shoulderAY = r.y;
        break;
      }
    }

    // ------- 3. TORSO BODY WIDTH AT SHOULDER -------
    // The actual shoulder joint X is where the torso meets the arm.
    // Below shoulder height, the torso has a narrower width than the full extent (which includes arms).
    // We measure the "torso core" width by looking at rows just below the armpit area,
    // where only the torso is visible (between the armpits).

    // Find the torso width by looking for the region below shoulders where
    // the width significantly narrows (armpit area).
    // The torso width is the width at the narrowest point near the armpits.
    const armpitSearchStart = shoulderAY;
    const armpitSearchEnd = shoulderAY + Math.round(totalH * 0.15);
    let minTorsoWidth = Infinity;
    let torsoWidthAtArmpit = (maxAX - minAX) * 0.25;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.y < armpitSearchStart || r.y > armpitSearchEnd) continue;
      // Measure "core" width: ignore the arm regions on the sides
      // Look for the inner boundaries by scanning from the center outward
      // and also from edges inward — find where there might be narrowing
      const coreWidth = SilhouetteAnalyzer._measureTorsoCore(data, gw, gh, r.y, cx, minAX, maxAX);
      if (coreWidth > 0 && coreWidth < minTorsoWidth) {
        minTorsoWidth = coreWidth;
        torsoWidthAtArmpit = coreWidth;
      }
    }

    // If we couldn't detect armpit narrowing, use a percentage of the overall width at shoulder
    if (minTorsoWidth === Infinity) {
      const shRow = SilhouetteAnalyzer._rowAt(rows, shoulderAY);
      torsoWidthAtArmpit = shRow ? shRow.width * 0.3 : (maxAX - minAX) * 0.25;
    }

    const shoulderLeftAX = cx - torsoWidthAtArmpit / 2;
    const shoulderRightAX = cx + torsoWidthAtArmpit / 2;

    // ------- 4. HIP / CROTCH DETECTION -------
    // The crotch is the topmost row where there's a transparent gap between two opaque
    // regions in the center. Search from 35% to 70% of character height below shoulder.
    const crotchSearchStart = shoulderAY + Math.round((maxAY - shoulderAY) * 0.30);
    const crotchSearchEnd = shoulderAY + Math.round((maxAY - shoulderAY) * 0.65);
    let crotchAY = shoulderAY + Math.round((maxAY - shoulderAY) * 0.50);

    for (let y = crotchSearchStart; y <= crotchSearchEnd; y++) {
      if (SilhouetteAnalyzer._hasCenterGap(data, gw, gh, y, cx, minAX, maxAX)) {
        crotchAY = y;
        break;
      }
    }

    // WAIST detection: The waist (navel / belt area) is the narrowest horizontal
    // extent of the torso between the chest and the crotch.
    // This is where the hip joint should go.
    const waistSearchStart = shoulderAY + Math.round((crotchAY - shoulderAY) * 0.3);
    const waistSearchEnd = shoulderAY + Math.round((crotchAY - shoulderAY) * 0.8);
    let waistAY = shoulderAY + Math.round((crotchAY - shoulderAY) * 0.5);
    let waistMinWidth = Infinity;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.y < waistSearchStart || r.y > waistSearchEnd) continue;
      if (r.width > 0 && r.width < waistMinWidth) {
        waistMinWidth = r.width;
        waistAY = r.y;
      }
    }

    // Hip Y is at the waist (belt/navel area)
    const hipAY = waistAY;
    const hipRow = SilhouetteAnalyzer._rowAt(rows, hipAY);

    // Hip joint X: detect where each leg starts based on regions below crotch
    const crotchRow = SilhouetteAnalyzer._rowAt(rows, crotchAY + 3);
    let hipLeftAX = cx - (hipRow ? hipRow.width * 0.2 : 20);
    let hipRightAX = cx + (hipRow ? hipRow.width * 0.2 : 20);

    if (crotchRow) {
      const leftLeg = SilhouetteAnalyzer._findLeftRegion(data, gw, gh, crotchAY + 5, minAX, cx);
      const rightLeg = SilhouetteAnalyzer._findRightRegion(data, gw, gh, crotchAY + 5, cx, maxAX);
      if (leftLeg) hipLeftAX = (leftLeg.left + leftLeg.right) / 2;
      if (rightLeg) hipRightAX = (rightLeg.left + rightLeg.right) / 2;
    }

    // ------- 5. ARM ANALYSIS -------
    const leftArm = SilhouetteAnalyzer._analyzeArm(
      data, gw, gh, shoulderLeftAX, shoulderAY, minAX, 'left'
    );
    const rightArm = SilhouetteAnalyzer._analyzeArm(
      data, gw, gh, shoulderRightAX, shoulderAY, maxAX, 'right'
    );

    // ------- 6. FINGER DETECTION -------
    const leftFingers = SilhouetteAnalyzer._detectFingers(
      data, gw, gh, leftArm.wristX, leftArm.tipX, shoulderAY, 'left'
    );
    const rightFingers = SilhouetteAnalyzer._detectFingers(
      data, gw, gh, rightArm.wristX, rightArm.tipX, shoulderAY, 'right'
    );

    // ------- 7. LEG ANALYSIS -------
    const leftLeg = SilhouetteAnalyzer._analyzeLeg(
      data, gw, gh, rows, hipLeftAX, hipAY, crotchAY, maxAY, minAX, cx, 'left'
    );
    const rightLeg = SilhouetteAnalyzer._analyzeLeg(
      data, gw, gh, rows, hipRightAX, hipAY, crotchAY, maxAY, cx, maxAX, 'right'
    );

    // ------- Convert all to original coords and return -------
    return {
      topY: topAY / scale,
      shoulderY: shoulderAY / scale,
      shoulderLeftX: shoulderLeftAX / scale,
      shoulderRightX: shoulderRightAX / scale,
      waistY: waistAY / scale,
      hipY: hipAY / scale,
      hipLeftX: hipLeftAX / scale,
      hipRightX: hipRightAX / scale,
      crotchY: crotchAY / scale,

      leftArmTip: toOrig(leftArm.tipX, leftArm.tipY),
      rightArmTip: toOrig(rightArm.tipX, rightArm.tipY),
      leftElbow: toOrig(leftArm.elbowX, leftArm.elbowY),
      rightElbow: toOrig(rightArm.elbowX, rightArm.elbowY),
      leftWrist: toOrig(leftArm.wristX, leftArm.wristY),
      rightWrist: toOrig(rightArm.wristX, rightArm.wristY),

      leftFingers: leftFingers.map(f => toOrig(f.x, f.y)),
      rightFingers: rightFingers.map(f => toOrig(f.x, f.y)),

      leftKnee: toOrig(leftLeg.kneeX, leftLeg.kneeY),
      rightKnee: toOrig(rightLeg.kneeX, rightLeg.kneeY),
      leftAnkle: toOrig(leftLeg.ankleX, leftLeg.ankleY),
      rightAnkle: toOrig(rightLeg.ankleX, rightLeg.ankleY),
      leftFootTip: toOrig(leftLeg.footX, leftLeg.footY),
      rightFootTip: toOrig(rightLeg.footX, rightLeg.footY),
    };
  }

  // ---- Row helpers ----

  static _rowAt(rows: RowSpan[], y: number): RowSpan | null {
    let best: RowSpan | null = null;
    let bestD = Infinity;
    for (const r of rows) {
      const d = Math.abs(r.y - y);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }

  /**
   * Measure the "torso core" width at a given row by looking for narrow
   * regions between the arm and the torso (armpits).
   * Scans from the left and right edges inward looking for brief transparent gaps
   * that indicate where the arm separates from the torso.
   */
  static _measureTorsoCore(
    data: Uint8ClampedArray, gw: number, gh: number,
    y: number, cx: number, minX: number, maxX: number
  ): number {
    if (y < 0 || y >= gh) return 0;

    // Scan from left edge inward: find where there's a brief gap or narrowing
    // which indicates the armpit
    let leftArmpit = minX;
    let rightArmpit = maxX;

    // From left: find first gap (or significant narrowing) moving right from edge
    let inOpaque = false;
    let gapFound = false;
    for (let x = minX; x < cx; x++) {
      const a = data[(y * gw + x) * 4 + 3] > ALPHA_THRESH;
      if (a && !inOpaque) {
        if (gapFound) {
          // We passed through a gap and found opaque again — this is the torso start
          leftArmpit = x;
          break;
        }
        inOpaque = true;
      } else if (!a && inOpaque) {
        // Left the arm region, entering gap
        inOpaque = false;
        gapFound = true;
      }
    }

    // From right: same thing
    inOpaque = false;
    gapFound = false;
    for (let x = maxX; x > cx; x--) {
      const a = data[(y * gw + x) * 4 + 3] > ALPHA_THRESH;
      if (a && !inOpaque) {
        if (gapFound) {
          rightArmpit = x;
          break;
        }
        inOpaque = true;
      } else if (!a && inOpaque) {
        inOpaque = false;
        gapFound = true;
      }
    }

    // If no gaps found (arm connected to torso), measure the continuous region
    // around the center
    if (leftArmpit === minX && rightArmpit === maxX) {
      // No armpit gaps detected — the arms and torso are connected.
      // Use width of contiguous region around center
      let coreLeft = cx, coreRight = cx;
      for (let x = cx; x >= minX; x--) {
        if (data[(y * gw + x) * 4 + 3] > ALPHA_THRESH) {
          coreLeft = x;
        } else break;
      }
      for (let x = cx; x <= maxX; x++) {
        if (data[(y * gw + x) * 4 + 3] > ALPHA_THRESH) {
          coreRight = x;
        } else break;
      }
      return coreRight - coreLeft;
    }

    return rightArmpit - leftArmpit;
  }

  static _hasCenterGap(
    data: Uint8ClampedArray, gw: number, gh: number,
    y: number, cx: number, minX: number, maxX: number
  ): boolean {
    if (y < 0 || y >= gh) return false;
    // Check if there's a transparent gap in the center region
    const thirdW = Math.round((maxX - minX) / 3);
    const checkLeft = cx - Math.round(thirdW * 0.25);
    const checkRight = cx + Math.round(thirdW * 0.25);

    // Must have opaque on both sides and transparent in center
    let hasLeft = false, hasRight = false, hasGap = false;
    for (let x = minX; x <= maxX; x++) {
      const a = data[(y * gw + x) * 4 + 3] > ALPHA_THRESH;
      if (a && x < cx - 5) hasLeft = true;
      if (a && x > cx + 5) hasRight = true;
      if (!a && x >= checkLeft && x <= checkRight) hasGap = true;
    }
    return hasLeft && hasRight && hasGap;
  }

  static _findLeftRegion(
    data: Uint8ClampedArray, gw: number, gh: number,
    y: number, minX: number, cx: number
  ): { left: number; right: number } | null {
    if (y < 0 || y >= gh) return null;
    let left = -1, right = -1;
    for (let x = minX; x < cx; x++) {
      if (data[(y * gw + x) * 4 + 3] > ALPHA_THRESH) {
        if (left === -1) left = x;
        right = x;
      }
    }
    return left !== -1 ? { left, right } : null;
  }

  static _findRightRegion(
    data: Uint8ClampedArray, gw: number, gh: number,
    y: number, cx: number, maxX: number
  ): { left: number; right: number } | null {
    if (y < 0 || y >= gh) return null;
    let left = -1, right = -1;
    for (let x = cx; x <= maxX; x++) {
      if (data[(y * gw + x) * 4 + 3] > ALPHA_THRESH) {
        if (left === -1) left = x;
        right = x;
      }
    }
    return left !== -1 ? { left, right } : null;
  }

  // ---- Arm analysis ----

  /**
   * Scan columns from the shoulder outward (left arm goes left, right arm goes right).
   * For each column, measure the vertical extent of opaque pixels near shoulder height.
   * Elbow = narrowest column in first half. Wrist = narrowest after elbow (hand transition).
   */
  static _analyzeArm(
    data: Uint8ClampedArray, gw: number, gh: number,
    shoulderX: number, shoulderY: number, edgeX: number, side: 'left' | 'right'
  ): { elbowX: number; elbowY: number; wristX: number; wristY: number; tipX: number; tipY: number } {
    const dir = side === 'left' ? -1 : 1;
    const startX = Math.round(shoulderX);
    const endX = Math.round(edgeX);

    // Build column profile: for each x column, measure vertical extent of opaque pixels
    // near the shoulder band
    const scanRadius = Math.round(gh * 0.15);
    const scanMinY = Math.max(0, shoulderY - scanRadius);
    const scanMaxY = Math.min(gh - 1, shoulderY + scanRadius);

    const profiles: ColProfile[] = [];
    const step = dir;
    for (let x = startX; x !== endX + step; x += step) {
      if (x < 0 || x >= gw) break;
      let topP = -1, bottomP = -1;
      for (let y = scanMinY; y <= scanMaxY; y++) {
        if (data[(y * gw + x) * 4 + 3] > ALPHA_THRESH) {
          if (topP === -1) topP = y;
          bottomP = y;
        }
      }
      if (topP !== -1) {
        profiles.push({ x, topY: topP, bottomY: bottomP, height: bottomP - topP });
      }
    }

    if (profiles.length < 3) {
      const armLen = Math.abs(edgeX - shoulderX);
      return {
        elbowX: shoulderX + dir * armLen * 0.5,
        elbowY: shoulderY,
        wristX: shoulderX + dir * armLen * 0.85,
        wristY: shoulderY,
        tipX: edgeX,
        tipY: shoulderY,
      };
    }

    // Smooth the height profile to reduce noise
    const smoothed = SilhouetteAnalyzer._smooth(profiles.map(p => p.height), 7);

    // Find the arm tip (last column with opaque pixels)
    const tipProfile = profiles[profiles.length - 1];
    const tipX = tipProfile.x;
    const tipY = (tipProfile.topY + tipProfile.bottomY) / 2;

    // Elbow: narrowest point in 25%-65% of the arm length
    // (skip first 25% which is near shoulder and might be noisy)
    const elbowSearchStart = Math.floor(profiles.length * 0.25);
    const elbowSearchEnd = Math.floor(profiles.length * 0.65);
    let elbowIdx = elbowSearchStart;
    let minHeight = Infinity;
    for (let i = elbowSearchStart; i < elbowSearchEnd; i++) {
      if (smoothed[i] < minHeight) {
        minHeight = smoothed[i];
        elbowIdx = i;
      }
    }
    const elbowP = profiles[elbowIdx];
    const elbowX = elbowP.x;
    const elbowY = (elbowP.topY + elbowP.bottomY) / 2;

    // Wrist: After the elbow region, find the narrowest point in 70%-90% range.
    // This should be where the forearm meets the hand (hand widens from the wrist).
    const wristSearchStart = Math.max(elbowIdx + Math.floor(profiles.length * 0.1), Math.floor(profiles.length * 0.65));
    const wristSearchEnd = Math.floor(profiles.length * 0.90);
    let wristIdx = wristSearchStart;
    let wristMinH = Infinity;
    for (let i = wristSearchStart; i < wristSearchEnd && i < smoothed.length; i++) {
      if (smoothed[i] < wristMinH) {
        wristMinH = smoothed[i];
        wristIdx = i;
      }
    }
    const wristP = profiles[wristIdx];
    const wristX = wristP.x;
    const wristY = (wristP.topY + wristP.bottomY) / 2;

    return { elbowX, elbowY, wristX, wristY, tipX, tipY };
  }

  // ---- Finger detection ----

  /**
   * Detect individual finger tips at the hand area of an arm.
   * For T-pose with palms facing viewer and spread fingers:
   * - Fingers extend horizontally outward from the wrist
   * - Each finger is a separate vertical blob at the arm tip
   *
   * Improved algorithm: Scan multiple columns near the arm tip.
   * At each column, find separate vertical opaque runs (fingers).
   * Track runs across columns to identify connected finger blobs,
   * then find the outermost point (tip) of each blob.
   */
  /**
   * Detect finger tip positions for a T-pose hand.
   *
   * Measures the hand's actual vertical extent from the alpha grid,
   * then places 5 fingers in a fan pattern within that bounding box.
   * Order: [thumb, index, middle, ring, pinky] from top (lowest Y) to bottom (highest Y).
   *
   * Thumb is shorter and closer to the wrist; middle is the longest finger.
   */
  static _detectFingers(
    data: Uint8ClampedArray, gw: number, gh: number,
    wristX: number, tipX: number, shoulderY: number,
    side: 'left' | 'right'
  ): Vec2[] {
    const dir = side === 'left' ? -1 : 1;
    const handLen = Math.abs(tipX - wristX);

    if (handLen < 5) {
      return SilhouetteAnalyzer._fallbackFingers(wristX, shoulderY, tipX, side);
    }

    // Measure the hand's vertical extent at the fingertip region.
    // Scan several columns near the tip to find the topmost and bottommost opaque pixels.
    const scanRadius = Math.round(gh * 0.20);
    const scanMinY = Math.max(0, shoulderY - scanRadius);
    const scanMaxY = Math.min(gh - 1, shoulderY + scanRadius);

    let handTopY = shoulderY;
    let handBottomY = shoulderY;
    let foundExtent = false;

    // Scan the outer 60% of the hand region to get the finger spread extent
    const measureStart = Math.round(wristX + dir * handLen * 0.4);
    const measureEnd = Math.round(tipX);
    const measureStep = dir === -1 ? -1 : 1;

    for (let x = measureStart; (dir === -1 ? x >= measureEnd : x <= measureEnd); x += measureStep) {
      if (x < 0 || x >= gw) continue;
      for (let y = scanMinY; y <= scanMaxY; y++) {
        if (data[(y * gw + x) * 4 + 3] > ALPHA_THRESH) {
          if (!foundExtent) {
            handTopY = y;
            handBottomY = y;
            foundExtent = true;
          } else {
            if (y < handTopY) handTopY = y;
            if (y > handBottomY) handBottomY = y;
          }
        }
      }
    }

    if (!foundExtent) {
      return SilhouetteAnalyzer._fallbackFingers(wristX, shoulderY, tipX, side);
    }

    // Now place 5 fingers within the detected hand bounding box.
    // From top to bottom: thumb, index, middle, ring, pinky
    // Thumb is shorter (closer to wrist), middle is longest (closest to tipX).
    const handHeight = handBottomY - handTopY;
    const fingerSpacing = handHeight / 4; // 5 fingers, 4 gaps

    // Finger lengths as fraction of handLen (from wrist outward)
    // Thumb is short, middle is longest
    const fingerLengths = [0.55, 0.85, 1.0, 0.90, 0.70]; // thumb, index, middle, ring, pinky

    const fingers: Vec2[] = [];
    for (let i = 0; i < 5; i++) {
      const fy = handTopY + fingerSpacing * i;
      const fx = wristX + dir * handLen * fingerLengths[i];
      fingers.push(V2(fx, fy));
    }

    return fingers;
  }

  static _findVerticalRuns(
    data: Uint8ClampedArray, gw: number, _gh: number,
    x: number, minY: number, maxY: number
  ): Array<{ top: number; bottom: number }> {
    const runs: Array<{ top: number; bottom: number }> = [];
    let inRun = false;
    let runTop = 0;

    x = clamp(Math.round(x), 0, gw - 1);

    for (let y = minY; y <= maxY; y++) {
      const isOpaque = data[(y * gw + x) * 4 + 3] > ALPHA_THRESH;
      if (isOpaque && !inRun) {
        inRun = true;
        runTop = y;
      } else if (!isOpaque && inRun) {
        inRun = false;
        runs.push({ top: runTop, bottom: y - 1 });
      }
    }
    if (inRun) runs.push({ top: runTop, bottom: maxY });

    // Filter out very small runs (noise) — keep runs > 2px tall
    return runs.filter(r => (r.bottom - r.top) >= 2);
  }

  static _fallbackFingers(
    wristX: number, shoulderY: number, tipX: number, side: 'left' | 'right'
  ): Vec2[] {
    const sign = side === 'left' ? -1 : 1;
    const handLen = Math.abs(tipX - wristX);
    const spread = handLen * 0.6; // vertical spread of fingers
    // Order: [thumb, index, middle, ring, pinky] from top (lowest Y) to bottom (highest Y)
    return [
      V2(wristX + sign * handLen * 0.55, shoulderY - spread * 0.40),  // thumb (top, short)
      V2(wristX + sign * handLen * 0.85, shoulderY - spread * 0.20),  // index
      V2(wristX + sign * handLen * 1.00, shoulderY),                   // middle (longest)
      V2(wristX + sign * handLen * 0.90, shoulderY + spread * 0.20),  // ring
      V2(wristX + sign * handLen * 0.70, shoulderY + spread * 0.40),  // pinky (bottom, short)
    ];
  }

  // ---- Leg analysis ----

  /**
   * Analyze a single leg. Scan rows from crotch to bottom within the leg's X range.
   * Knee = narrowest point in upper-middle portion. Ankle = narrowest point in lower portion.
   *
   * Improved: better search ranges and smoothing, plus uses the actual detected leg region
   * per-row rather than the full region bounds.
   */
  static _analyzeLeg(
    data: Uint8ClampedArray, gw: number, gh: number,
    _rows: RowSpan[],
    legCenterX: number, hipY: number, crotchY: number, bottomY: number,
    regionMinX: number, regionMaxX: number,
    _side: 'left' | 'right'
  ): { kneeX: number; kneeY: number; ankleX: number; ankleY: number; footX: number; footY: number } {
    // Full leg length from hip to bottom of character (not from crotch, which may
    // be garment hem rather than actual body crotch).
    const fullLegLen = bottomY - hipY;
    if (fullLegLen < 10) {
      return {
        kneeX: legCenterX, kneeY: hipY + fullLegLen * 0.5,
        ankleX: legCenterX, ankleY: hipY + fullLegLen * 0.85,
        footX: legCenterX, footY: bottomY,
      };
    }

    // For each row in the leg, measure the width within the leg's region.
    // Scan from crotch (where legs separate) to bottom.
    interface LegRow { y: number; left: number; right: number; width: number; cx: number }
    const legRows: LegRow[] = [];

    for (let y = crotchY; y <= bottomY; y++) {
      if (y < 0 || y >= gh) continue;
      let left = -1, right = -1;
      const scanL = Math.max(0, Math.round(regionMinX));
      const scanR = Math.min(gw - 1, Math.round(regionMaxX));
      for (let x = scanL; x <= scanR; x++) {
        if (data[(y * gw + x) * 4 + 3] > ALPHA_THRESH) {
          if (left === -1) left = x;
          right = x;
        }
      }
      if (left !== -1) {
        legRows.push({ y, left, right, width: right - left, cx: (left + right) / 2 });
      }
    }

    // Place knee and ankle using anatomical fractions of full leg (hip to bottom).
    // Knee is approximately 50% down from hip, ankle at ~85%.
    const kneeTargetY = hipY + fullLegLen * 0.50;
    const ankleTargetY = hipY + fullLegLen * 0.85;

    // Find the legRow closest to the knee target Y to get its X center.
    // If we have legRows, use the nearest one; otherwise use legCenterX.
    let kneeX = legCenterX;
    let ankleX = legCenterX;
    let footX = legCenterX;
    let footY = bottomY;

    if (legRows.length >= 3) {
      // Find row nearest kneeTargetY
      let bestKneeDist = Infinity;
      for (const r of legRows) {
        const d = Math.abs(r.y - kneeTargetY);
        if (d < bestKneeDist) { bestKneeDist = d; kneeX = r.cx; }
      }
      // Find row nearest ankleTargetY
      let bestAnkleDist = Infinity;
      for (const r of legRows) {
        const d = Math.abs(r.y - ankleTargetY);
        if (d < bestAnkleDist) { bestAnkleDist = d; ankleX = r.cx; }
      }
      // Foot tip: last row
      const footRow = legRows[legRows.length - 1];
      footX = footRow.cx;
      footY = footRow.y;
    }

    return {
      kneeX,
      kneeY: kneeTargetY,
      ankleX,
      ankleY: ankleTargetY,
      footX,
      footY,
    };
  }

  // ---- Utilities ----

  static _smooth(arr: number[], windowSize: number): number[] {
    const half = Math.floor(windowSize / 2);
    return arr.map((_, i) => {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
        sum += arr[j];
        count++;
      }
      return sum / count;
    });
  }

  /** Fallback landmarks when analysis fails (use bbox fractions) */
  static _fallback(bbox: BBox): BodyLandmarks {
    const { cx } = bbox;
    const top = bbox.minY;
    const h = bbox.h;
    const w = bbox.w;
    return {
      topY: top + h * 0.07,
      shoulderY: top + h * 0.20,
      shoulderLeftX: cx - w * 0.15,
      shoulderRightX: cx + w * 0.15,
      waistY: top + h * 0.42,
      hipY: top + h * 0.42,
      hipLeftX: cx - w * 0.08,
      hipRightX: cx + w * 0.08,
      crotchY: top + h * 0.52,
      leftArmTip: V2(bbox.minX + w * 0.02, top + h * 0.20),
      rightArmTip: V2(bbox.maxX - w * 0.02, top + h * 0.20),
      leftElbow: V2(cx - w * 0.28, top + h * 0.20),
      rightElbow: V2(cx + w * 0.28, top + h * 0.20),
      leftWrist: V2(cx - w * 0.40, top + h * 0.20),
      rightWrist: V2(cx + w * 0.40, top + h * 0.20),
      leftFingers: [
        V2(cx - w * 0.44, top + h * 0.23),
        V2(cx - w * 0.47, top + h * 0.18),
        V2(cx - w * 0.48, top + h * 0.20),
        V2(cx - w * 0.47, top + h * 0.21),
        V2(cx - w * 0.45, top + h * 0.22),
      ],
      rightFingers: [
        V2(cx + w * 0.44, top + h * 0.23),
        V2(cx + w * 0.47, top + h * 0.18),
        V2(cx + w * 0.48, top + h * 0.20),
        V2(cx + w * 0.47, top + h * 0.21),
        V2(cx + w * 0.45, top + h * 0.22),
      ],
      leftKnee: V2(cx - w * 0.08, top + h * 0.72),
      rightKnee: V2(cx + w * 0.08, top + h * 0.72),
      leftAnkle: V2(cx - w * 0.07, top + h * 0.92),
      rightAnkle: V2(cx + w * 0.07, top + h * 0.92),
      leftFootTip: V2(cx - w * 0.08, top + h * 0.97),
      rightFootTip: V2(cx + w * 0.08, top + h * 0.97),
    };
  }
}
