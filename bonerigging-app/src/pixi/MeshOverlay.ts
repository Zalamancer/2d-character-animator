import { Container, Graphics } from 'pixi.js';
import type { MeshData } from '../types/mesh';
import type { ParsedCharacter } from '../types/parsed';
import type { Transform, Vec2 } from '../types/math';

function svgToScreen(p: Vec2, t: Transform): Vec2 {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

export class MeshOverlay {
  private graphics: Graphics;

  constructor(parent: Container) {
    this.graphics = new Graphics();
    parent.addChild(this.graphics);
  }

  drawWireframe(mesh: MeshData, deformedPositions: Vec2[], transform: Transform): void {
    this.graphics.clear();

    for (const tri of mesh.triangles) {
      const p0 = svgToScreen(deformedPositions[tri.v0], transform);
      const p1 = svgToScreen(deformedPositions[tri.v1], transform);
      const p2 = svgToScreen(deformedPositions[tri.v2], transform);

      this.graphics.moveTo(p0.x, p0.y);
      this.graphics.lineTo(p1.x, p1.y);
      this.graphics.lineTo(p2.x, p2.y);
      this.graphics.closePath();
      this.graphics.stroke({ width: 0.5, color: 0x00ff64, alpha: 0.25 });
    }
  }

  drawSVGPoints(parsed: ParsedCharacter, transform: Transform): void {
    this.graphics.clear();

    for (const path of parsed.paths) {
      for (const pt of path.sampledPoints) {
        const sp = svgToScreen(pt, transform);
        this.graphics.circle(sp.x, sp.y, 1.5);
        this.graphics.fill({ color: 0x00ff64, alpha: 0.4 });
      }
    }
  }
}
