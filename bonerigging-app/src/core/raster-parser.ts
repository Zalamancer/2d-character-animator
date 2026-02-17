import type { Vec2 } from '../types/math';
import type { ParsedCharacter, BBox, PathData, AlphaGrid } from '../types/parsed';
import { V2 } from './math';

export class RasterParser {
  static parse(img: HTMLImageElement): ParsedCharacter {
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // Scale down for analysis if image is large
    const maxAnalysis = 1024;
    const scale = Math.min(1, maxAnalysis / Math.max(w, h));
    const aw = Math.round(w * scale);
    const ah = Math.round(h * scale);

    const offscreen = document.createElement('canvas');
    offscreen.width = aw;
    offscreen.height = ah;
    const octx = offscreen.getContext('2d')!;
    octx.drawImage(img, 0, 0, aw, ah);
    const imageData = octx.getImageData(0, 0, aw, ah);
    const data = imageData.data;

    // Find tight bounding box from alpha channel
    let minX = aw, minY = ah, maxX = 0, maxY = 0;
    let hasAlpha = false;
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        if (data[(y * aw + x) * 4 + 3] > 10) {
          hasAlpha = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // If no alpha (JPEG), use full image
    if (!hasAlpha) {
      minX = 0; minY = 0; maxX = aw - 1; maxY = ah - 1;
    }

    // Scale bbox back to original image coordinates
    const bboxOrig: BBox = {
      minX: minX / scale, minY: minY / scale,
      maxX: maxX / scale, maxY: maxY / scale,
      w: (maxX - minX) / scale,
      h: (maxY - minY) / scale,
      cx: (minX + maxX) / 2 / scale,
      cy: (minY + maxY) / 2 / scale,
    };

    // Extract silhouette boundary points for AutoRigger width profile
    const sampledPoints: Vec2[] = [];
    const numRows = 200;
    const rowStep = Math.max(1, Math.floor((maxY - minY) / numRows));
    for (let y = minY; y <= maxY; y += rowStep) {
      let leftX = -1, rightX = -1;
      for (let x = minX; x <= maxX; x++) {
        if (data[(y * aw + x) * 4 + 3] > 10) {
          if (leftX === -1) leftX = x;
          rightX = x;
        }
      }
      if (leftX !== -1) {
        sampledPoints.push(V2(leftX / scale, y / scale));
        if (rightX !== leftX) sampledPoints.push(V2(rightX / scale, y / scale));
      }
    }

    // If no alpha, generate border points
    if (!hasAlpha) {
      sampledPoints.length = 0;
      for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 200))) {
        sampledPoints.push(V2(0, y));
        sampledPoints.push(V2(w - 1, y));
      }
    }

    // Build alpha grid for contour-adaptive mesh (analysis-resolution)
    // Store alpha data at analysis scale so MeshGenerator can skip transparent cells
    const alphaGrid: AlphaGrid | null = hasAlpha ? { data, width: aw, height: ah, scale } : null;

    const pathData: PathData = {
      index: 0,
      element: null,
      sampledPoints,
      controlPoints: [],
      totalLength: 0,
      d: '',
    };

    return {
      svgElement: null,
      viewBox: { x: 0, y: 0, w, h },
      paths: [pathData],
      allControlPoints: [],
      bbox: bboxOrig,
      image: img,
      isRaster: true,
      alphaGrid,
    };
  }
}
