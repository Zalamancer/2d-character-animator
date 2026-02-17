import type { Vec2, Mat2x3 } from './math';

export interface Joint {
  name: string;
  displayName?: string;
  rest: Vec2;
  current: Vec2;
  parent: string | null;
  custom?: boolean;
}

export interface Bone {
  name: string;
  from: string;
  to: string;
  index: number;
  restAngle: number;
  restLength: number;
  bindMatrix: Mat2x3;
  inverseBindMatrix: Mat2x3;
  radiusMul?: number;
}

export interface Skeleton {
  joints: Record<string, Joint>;
  bones: Bone[];
}
