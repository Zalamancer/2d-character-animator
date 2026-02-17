import type { ControlPoint } from './parsed';

export interface Triangle {
  v0: number;
  v1: number;
  v2: number;
}

export interface UV {
  u: number;
  v: number;
}

export interface MeshData {
  vertices: ControlPoint[];
  triangles: Triangle[];
  uvs: UV[];
  gridCols: number;
  gridRows: number;
}
