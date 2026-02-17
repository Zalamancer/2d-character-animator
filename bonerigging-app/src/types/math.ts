export interface Vec2 {
  x: number;
  y: number;
}

// 2D affine matrix as [a, b, c, d, tx, ty]
// | a  b  tx |
// | c  d  ty |
// | 0  0   1 |
export type Mat2x3 = [number, number, number, number, number, number];

export interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface DistToSegmentResult {
  dist: number;
  t: number;
}
