import type { Vec2, Mat2x3, DistToSegmentResult } from '../types/math';

export const V2 = (x: number = 0, y: number = 0): Vec2 => ({ x, y });

export const v2Add = (a: Vec2, b: Vec2): Vec2 => V2(a.x + b.x, a.y + b.y);

export const v2Sub = (a: Vec2, b: Vec2): Vec2 => V2(a.x - b.x, a.y - b.y);

export const v2Scale = (v: Vec2, s: number): Vec2 => V2(v.x * s, v.y * s);

export const v2Dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const v2Cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const v2Len = (v: Vec2): number => Math.sqrt(v.x * v.x + v.y * v.y);

export const v2Dist = (a: Vec2, b: Vec2): number => v2Len(v2Sub(a, b));

export const v2Norm = (v: Vec2): Vec2 => {
  const l = v2Len(v);
  return l > 0 ? v2Scale(v, 1 / l) : V2();
};

export const v2Lerp = (a: Vec2, b: Vec2, t: number): Vec2 =>
  V2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

export const v2Rot = (v: Vec2, a: number): Vec2 => {
  const c = Math.cos(a), s = Math.sin(a);
  return V2(v.x * c - v.y * s, v.x * s + v.y * c);
};

export const v2RotAround = (point: Vec2, pivot: Vec2, angle: number): Vec2 => {
  const d = v2Sub(point, pivot);
  const r = v2Rot(d, angle);
  return v2Add(pivot, r);
};

// Normalize angle to [-PI, PI]
export const angleNorm = (a: number): number => {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Clamp value
export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): DistToSegmentResult {
  const ab = v2Sub(b, a);
  const ap = v2Sub(p, a);
  const lenSq = v2Dot(ab, ab);
  if (lenSq < 1e-10) return { dist: v2Dist(p, a), t: 0 };
  let t = v2Dot(ap, ab) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = v2Add(a, v2Scale(ab, t));
  return { dist: v2Dist(p, proj), t };
}

// 2D affine matrix as [a, b, c, d, tx, ty]
// | a  b  tx |
// | c  d  ty |
// | 0  0   1 |
export const m2Identity = (): Mat2x3 => [1, 0, 0, 1, 0, 0];

export function m2Multiply(A: Mat2x3, B: Mat2x3): Mat2x3 {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4],
    A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}

export function m2Transform(M: Mat2x3, p: Vec2): Vec2 {
  return V2(M[0] * p.x + M[1] * p.y + M[4], M[2] * p.x + M[3] * p.y + M[5]);
}

export function m2Rotate(angle: number): Mat2x3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, -s, s, c, 0, 0];
}

export function m2Translate(tx: number, ty: number): Mat2x3 {
  return [1, 0, 0, 1, tx, ty];
}

export function m2Invert(M: Mat2x3): Mat2x3 {
  const det = M[0] * M[3] - M[1] * M[2];
  if (Math.abs(det) < 1e-12) return m2Identity();
  const id = 1 / det;
  return [
    M[3] * id, -M[1] * id,
    -M[2] * id, M[0] * id,
    (M[2] * M[5] - M[3] * M[4]) * id,
    (M[1] * M[4] - M[0] * M[5]) * id,
  ];
}

export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
