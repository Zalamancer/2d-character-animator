import type { BBox, AlphaGrid } from '../types/parsed';
import type { MeshData, Triangle, UV } from '../types/mesh';
import type { ControlPoint } from '../types/parsed';
import { V2 } from './math';

export class MeshGenerator {
  static generate(
    bbox: BBox,
    gridCols: number = 20,
    gridRows: number = 30,
    imgW: number = 0,
    imgH: number = 0,
    alphaGrid: AlphaGrid | null = null,
  ): MeshData {
    const vertices: ControlPoint[] = [];
    const triangles: Triangle[] = [];
    const uvs: UV[] = [];
    const cols = gridCols;
    const rows = gridRows;

    // Use image dimensions for UV mapping; fall back to bbox if not provided
    const uvW = imgW || (bbox.minX + bbox.w);
    const uvH = imgH || (bbox.minY + bbox.h);

    // Create grid vertices
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const t_c = c / cols;
        const t_r = r / rows;
        const x = bbox.minX + t_c * bbox.w;
        const y = bbox.minY + t_r * bbox.h;
        vertices.push({ point: V2(x, y), type: 'anchor' });
        // UVs map vertex position to full image pixel coordinates
        uvs.push({ u: x / uvW, v: y / uvH });
      }
    }

    // Helper: sample alpha at an image-space coordinate using the alpha grid
    const alphaThreshold = 10;
    function sampleAlpha(imgX: number, imgY: number): number {
      if (!alphaGrid) return 255; // No alpha data -> fully opaque
      // Convert image-space coords to analysis-scale coords
      const ax = Math.round(imgX * alphaGrid.scale);
      const ay = Math.round(imgY * alphaGrid.scale);
      if (ax < 0 || ax >= alphaGrid.width || ay < 0 || ay >= alphaGrid.height) return 0;
      return alphaGrid.data[(ay * alphaGrid.width + ax) * 4 + 3];
    }

    // Create triangles (2 per grid cell), skipping fully transparent cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tl = r * (cols + 1) + c;
        const tr = tl + 1;
        const bl = (r + 1) * (cols + 1) + c;
        const br = bl + 1;

        // If we have alpha data, check if this cell has any visible pixels
        if (alphaGrid) {
          const v_tl = vertices[tl].point;
          const v_tr = vertices[tr].point;
          const v_bl = vertices[bl].point;
          const v_br = vertices[br].point;
          const cx = (v_tl.x + v_br.x) / 2;
          const cy = (v_tl.y + v_br.y) / 2;

          // Sample alpha at 4 corners + center
          const a0 = sampleAlpha(v_tl.x, v_tl.y);
          const a1 = sampleAlpha(v_tr.x, v_tr.y);
          const a2 = sampleAlpha(v_bl.x, v_bl.y);
          const a3 = sampleAlpha(v_br.x, v_br.y);
          const a4 = sampleAlpha(cx, cy);

          // Skip cell only if ALL samples are below threshold (fully transparent)
          if (a0 < alphaThreshold && a1 < alphaThreshold &&
              a2 < alphaThreshold && a3 < alphaThreshold &&
              a4 < alphaThreshold) {
            continue;
          }
        }

        triangles.push({ v0: tl, v1: bl, v2: tr });
        triangles.push({ v0: tr, v1: bl, v2: br });
      }
    }

    return { vertices, triangles, uvs, gridCols: cols, gridRows: rows };
  }
}
