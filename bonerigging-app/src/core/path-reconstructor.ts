import type { Vec2 } from '../types/math';
import type { ParsedCharacter } from '../types/parsed';

export interface ReconstructedPath {
  pathIndex: number;
  d: string;
  element: SVGElement | null;
}

export class PathReconstructor {
  static reconstructPaths(parsed: ParsedCharacter, deformedControlPoints: Vec2[]): ReconstructedPath[] {
    let globalCpIdx = 0;
    const result: ReconstructedPath[] = [];

    for (const path of parsed.paths) {
      const numCps = path.controlPoints.length;
      const deformed = deformedControlPoints.slice(globalCpIdx, globalCpIdx + numCps);
      globalCpIdx += numCps;

      // Rebuild d string by replacing coordinates
      const newD = PathReconstructor._rebuildD(path.d, deformed);
      result.push({ pathIndex: path.index, d: newD, element: path.element });
    }

    return result;
  }

  static _rebuildD(originalD: string, deformedPoints: Vec2[]): string {
    const commands = originalD.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];
    let cpIdx = 0;
    let result = '';
    // Track current position and subpath start for Z command
    let cx = 0, cy = 0, startX = 0, startY = 0;

    for (const cmd of commands) {
      const type = cmd[0];
      const nums = (cmd.slice(1).match(/-?[\d]*\.?\d+(?:e[+-]?\d+)?/gi) || []).map(Number);
      const T = type.toUpperCase();
      const isRel = type !== T;
      void isRel; // may be used in future for relative commands

      if (T === 'M') {
        for (let i = 0; i < nums.length; i += 2) {
          const dp = deformedPoints[cpIdx++];
          if (!dp) continue;
          if (i === 0) {
            result += `M${dp.x.toFixed(2)},${dp.y.toFixed(2)} `;
            startX = dp.x; startY = dp.y;
          } else {
            result += `L${dp.x.toFixed(2)},${dp.y.toFixed(2)} `;
          }
          cx = dp.x; cy = dp.y;
        }
      } else if (T === 'L') {
        for (let i = 0; i < nums.length; i += 2) {
          const dp = deformedPoints[cpIdx++];
          if (!dp) continue;
          result += `L${dp.x.toFixed(2)},${dp.y.toFixed(2)} `;
          cx = dp.x; cy = dp.y;
        }
      } else if (T === 'H') {
        for (let i = 0; i < nums.length; i++) {
          const dp = deformedPoints[cpIdx++];
          if (!dp) continue;
          result += `L${dp.x.toFixed(2)},${dp.y.toFixed(2)} `;
          cx = dp.x; cy = dp.y;
        }
      } else if (T === 'V') {
        for (let i = 0; i < nums.length; i++) {
          const dp = deformedPoints[cpIdx++];
          if (!dp) continue;
          result += `L${dp.x.toFixed(2)},${dp.y.toFixed(2)} `;
          cx = dp.x; cy = dp.y;
        }
      } else if (T === 'C') {
        for (let i = 0; i < nums.length; i += 6) {
          const cp1 = deformedPoints[cpIdx++];
          const cp2 = deformedPoints[cpIdx++];
          const ep = deformedPoints[cpIdx++];
          if (!cp1 || !cp2 || !ep) continue;
          result += `C${cp1.x.toFixed(2)},${cp1.y.toFixed(2)} ${cp2.x.toFixed(2)},${cp2.y.toFixed(2)} ${ep.x.toFixed(2)},${ep.y.toFixed(2)} `;
          cx = ep.x; cy = ep.y;
        }
      } else if (T === 'S') {
        for (let i = 0; i < nums.length; i += 4) {
          const cp2 = deformedPoints[cpIdx++];
          const ep = deformedPoints[cpIdx++];
          if (!cp2 || !ep) continue;
          result += `S${cp2.x.toFixed(2)},${cp2.y.toFixed(2)} ${ep.x.toFixed(2)},${ep.y.toFixed(2)} `;
          cx = ep.x; cy = ep.y;
        }
      } else if (T === 'Q') {
        for (let i = 0; i < nums.length; i += 4) {
          const cp1 = deformedPoints[cpIdx++];
          const ep = deformedPoints[cpIdx++];
          if (!cp1 || !ep) continue;
          result += `Q${cp1.x.toFixed(2)},${cp1.y.toFixed(2)} ${ep.x.toFixed(2)},${ep.y.toFixed(2)} `;
          cx = ep.x; cy = ep.y;
        }
      } else if (T === 'T') {
        for (let i = 0; i < nums.length; i += 2) {
          const ep = deformedPoints[cpIdx++];
          if (!ep) continue;
          result += `T${ep.x.toFixed(2)},${ep.y.toFixed(2)} `;
          cx = ep.x; cy = ep.y;
        }
      } else if (T === 'A') {
        for (let i = 0; i < nums.length; i += 7) {
          const ep = deformedPoints[cpIdx++];
          if (!ep) continue;
          // Keep original arc params but update endpoint
          result += `A${nums[i]},${nums[i + 1]} ${nums[i + 2]} ${nums[i + 3]},${nums[i + 4]} ${ep.x.toFixed(2)},${ep.y.toFixed(2)} `;
          cx = ep.x; cy = ep.y;
        }
      } else if (T === 'Z') {
        result += 'Z ';
        cx = startX; cy = startY;
      }
    }

    // Suppress TS6199 — cx/cy track position state for Z commands
    void cx; void cy;

    return result.trim();
  }
}
