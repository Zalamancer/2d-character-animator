import type { Vec2 } from './math';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface ControlPoint {
  point: Vec2;
  type: string; // 'anchor' | 'control' | 'control1' | 'control2'
}

export interface PathData {
  index: number;
  element: SVGElement | null;
  sampledPoints: Vec2[];
  controlPoints: ControlPoint[];
  totalLength: number;
  d: string;
}

export interface AlphaGrid {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  scale: number;
}

export interface ParsedCharacter {
  svgElement: SVGSVGElement | null;
  viewBox: ViewBox;
  paths: PathData[];
  allControlPoints: ControlPoint[];
  bbox: BBox;
  image?: HTMLImageElement;
  isRaster?: boolean;
  alphaGrid?: AlphaGrid | null;
}
