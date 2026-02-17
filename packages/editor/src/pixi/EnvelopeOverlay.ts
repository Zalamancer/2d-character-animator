import { Container, Graphics } from 'pixi.js';
import type { Skeleton } from '@bonerigging/core';
import type { ParsedCharacter } from '@bonerigging/core';
import type { Transform, Vec2 } from '@bonerigging/core';

function svgToScreen(p: Vec2, t: Transform): Vec2 {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

function v2Dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Per-bone colors matching the original HTML
const BONE_COLORS = [
  0xff4444, 0x44ff44, 0x4444ff, 0xffff44,
  0xff44ff, 0x44ffff, 0xff8844, 0x88ff44,
];

export class EnvelopeOverlay {
  private graphics: Graphics;

  constructor(parent: Container) {
    this.graphics = new Graphics();
    parent.addChild(this.graphics);
  }

  draw(skeleton: Skeleton, parsed: ParsedCharacter, transform: Transform, selectedJoint: string | null): void {
    this.graphics.clear();

    const minEnvelope = (parsed?.bbox?.h ?? 100) * 0.03;

    for (const bone of skeleton.bones) {
      const headJoint = skeleton.joints[bone.from];
      const tailJoint = skeleton.joints[bone.to];
      if (!headJoint || !tailJoint) continue;

      // Use current positions so envelopes follow the pose
      const head = svgToScreen(headJoint.current, transform);
      const tail = svgToScreen(tailJoint.current, transform);

      const restLength = v2Dist(headJoint.rest, tailJoint.rest);
      const radiusMul = bone.radiusMul ?? 1.0;
      const envelope = Math.max(restLength * radiusMul, minEnvelope);
      const envelopeRadius = envelope * transform.scale;

      const isSelected = bone.from === selectedJoint || bone.to === selectedJoint;
      const color = BONE_COLORS[bone.index % BONE_COLORS.length];
      const alpha = isSelected ? 0.18 : 0.06;

      // Draw capsule as circles at head/tail + thick connecting stroke
      this.graphics.circle(head.x, head.y, envelopeRadius);
      this.graphics.fill({ color, alpha });

      this.graphics.circle(tail.x, tail.y, envelopeRadius);
      this.graphics.fill({ color, alpha });

      // Thick connecting line for the capsule body
      const dx = tail.x - head.x;
      const dy = tail.y - head.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.5) {
        this.graphics.moveTo(head.x, head.y);
        this.graphics.lineTo(tail.x, tail.y);
        this.graphics.stroke({ width: envelopeRadius * 2, color, alpha, cap: 'round' });
      }

      // Draw outline for selected bone
      if (isSelected) {
        this.graphics.circle(head.x, head.y, envelopeRadius);
        this.graphics.stroke({ width: 1.5, color: 0xffdd44, alpha: 0.5 });
        this.graphics.circle(tail.x, tail.y, envelopeRadius);
        this.graphics.stroke({ width: 1.5, color: 0xffdd44, alpha: 0.5 });
      }
    }
  }
}
