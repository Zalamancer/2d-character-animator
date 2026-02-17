import { Container, Graphics } from 'pixi.js';
import type { MeshData } from '@bonerigging/core';
import type { ParsedCharacter } from '@bonerigging/core';
import type { Skeleton } from '@bonerigging/core';
import type { BoneWeight } from '@bonerigging/core';
import type { Transform, Vec2 } from '@bonerigging/core';

function svgToScreen(p: Vec2, t: Transform): Vec2 {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

// Color palette for bones
const BONE_COLORS = [
  0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff,
  0xff8800, 0x8800ff, 0x00ff88, 0xff0088, 0x0088ff, 0x88ff00,
  0xff6666, 0x66ff66, 0x6666ff, 0xffaa44, 0xaa44ff, 0x44ffaa,
];

function getBoneColor(boneIndex: number): number {
  return BONE_COLORS[boneIndex % BONE_COLORS.length];
}

export class WeightOverlay {
  private graphics: Graphics;

  constructor(parent: Container) {
    this.graphics = new Graphics();
    parent.addChild(this.graphics);
  }

  drawSVG(parsed: ParsedCharacter, weights: BoneWeight[][], _skeleton: Skeleton, transform: Transform): void {
    this.graphics.clear();

    let ptIdx = 0;
    for (const path of parsed.paths) {
      for (const cp of path.controlPoints) {
        if (ptIdx >= weights.length) break;
        const boneWeights = weights[ptIdx];
        if (boneWeights && boneWeights.length > 0) {
          const sp = svgToScreen(cp.point, transform);
          const dominantBone = boneWeights[0];
          const color = getBoneColor(dominantBone.boneIndex);
          this.graphics.circle(sp.x, sp.y, 3);
          this.graphics.fill({ color, alpha: dominantBone.weight * 0.8 });
        }
        ptIdx++;
      }
    }
  }

  drawRaster(mesh: MeshData, deformedPositions: Vec2[], weights: BoneWeight[][], _skeleton: Skeleton, transform: Transform): void {
    this.graphics.clear();

    for (let i = 0; i < mesh.vertices.length && i < weights.length; i++) {
      const boneWeights = weights[i];
      if (!boneWeights || boneWeights.length === 0) continue;
      const sp = svgToScreen(deformedPositions[i], transform);
      const dominantBone = boneWeights[0];
      const color = getBoneColor(dominantBone.boneIndex);
      this.graphics.circle(sp.x, sp.y, 3);
      this.graphics.fill({ color, alpha: dominantBone.weight * 0.8 });
    }
  }
}
