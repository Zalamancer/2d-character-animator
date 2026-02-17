import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Skeleton } from '@bonerigging/core';
import type { Transform, Vec2 } from '@bonerigging/core';

function svgToScreen(p: Vec2, t: Transform): Vec2 {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

function v2Sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function v2Len(v: Vec2): number { return Math.sqrt(v.x * v.x + v.y * v.y); }
function v2Norm(v: Vec2): Vec2 { const l = v2Len(v); return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }; }
function v2Lerp(a: Vec2, b: Vec2, t: number): Vec2 { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function v2Dist(a: Vec2, b: Vec2): number { return v2Len(v2Sub(a, b)); }

const JOINT_COLORS: Record<string, number> = {
  selected: 0xffdd44,
  hovered: 0x88ccff,
  pinned: 0xcc66ee,
  custom: 0x44ddaa,
  hips: 0xff6644,
  default: 0x4488ff,
};

const labelStyle = new TextStyle({
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: 10,
  fill: '#cccccc',
});

export class BoneOverlay {
  private graphics: Graphics;
  private labelContainer: Container;

  constructor(parent: Container) {
    this.graphics = new Graphics();
    this.labelContainer = new Container();
    parent.addChild(this.graphics);
    parent.addChild(this.labelContainer);
  }

  /**
   * @param uiScale — multiplier for all UI element sizes (joint radii, line
   *   widths, diamond widths). Pass 1/cssScale when the canvas is rendered at
   *   a higher resolution than the display size so that bones appear at the
   *   correct on-screen size. Default 1 (no compensation).
   */
  draw(
    skeleton: Skeleton,
    transform: Transform,
    selectedJoint: string | null,
    hoveredJoint: string | null,
    pinnedJoints: Set<string>,
    editMode: boolean,
    showLabels: boolean,
    uiScale: number = 1,
  ): void {
    this.graphics.clear();
    this.labelContainer.removeChildren();

    const s = uiScale; // shorthand

    // Draw bones
    for (const bone of skeleton.bones) {
      const headJoint = skeleton.joints[bone.from];
      const tailJoint = skeleton.joints[bone.to];
      if (!headJoint || !tailJoint) continue;

      const head = svgToScreen(headJoint.current, transform);
      const tail = svgToScreen(tailJoint.current, transform);

      // Bone line
      this.graphics.moveTo(head.x, head.y);
      this.graphics.lineTo(tail.x, tail.y);
      this.graphics.stroke({ width: 2 * s, color: 0xffffff, alpha: 0.4 });

      // Diamond shape
      const mid = v2Lerp(head, tail, 0.5);
      const dir = v2Norm(v2Sub(tail, head));
      const perp = { x: -dir.y, y: dir.x };
      const boneWidth = Math.min(8 * s, v2Dist(head, tail) * 0.15);

      this.graphics.poly([
        head.x, head.y,
        mid.x + perp.x * boneWidth, mid.y + perp.y * boneWidth,
        tail.x, tail.y,
        mid.x - perp.x * boneWidth, mid.y - perp.y * boneWidth,
      ]);
      this.graphics.fill({ color: 0x78b4ff, alpha: 0.15 });
      this.graphics.stroke({ width: 1 * s, color: 0x78b4ff, alpha: 0.5 });
    }

    // Draw joints
    for (const [name, joint] of Object.entries(skeleton.joints)) {
      const sp = svgToScreen(joint.current, transform);
      const isSelected = name === selectedJoint;
      const isHovered = name === hoveredJoint;
      const isPinned = pinnedJoints.has(name);
      const isCustom = joint.custom === true;
      const isHips = name === 'hips';

      let color = JOINT_COLORS.default;
      let radius = 5 * s;
      let strokeWidth = 1.5 * s;

      if (isSelected) {
        color = JOINT_COLORS.selected;
        radius = 7 * s;
        strokeWidth = 2 * s;
      } else if (isHovered) {
        color = JOINT_COLORS.hovered;
        radius = 6 * s;
      } else if (isPinned) {
        color = JOINT_COLORS.pinned;
      } else if (isCustom) {
        color = JOINT_COLORS.custom;
      } else if (isHips) {
        color = JOINT_COLORS.hips;
      }

      // Pinned indicator ring
      if (isPinned) {
        this.graphics.circle(sp.x, sp.y, radius + 3 * s);
        this.graphics.stroke({ width: 1.5 * s, color: 0xcc66ee, alpha: 0.6 });
      }

      // Joint circle
      this.graphics.circle(sp.x, sp.y, radius);
      this.graphics.fill({ color, alpha: 0.8 });
      this.graphics.stroke({ width: strokeWidth, color: 0xffffff });

      // Edit mode dotted ring
      if (editMode) {
        this.graphics.circle(sp.x, sp.y, radius + 2 * s);
        this.graphics.stroke({ width: 1 * s, color: 0x5a5, alpha: 0.5 });
      }

      // Labels
      if (showLabels && (isSelected || isHovered || editMode)) {
        const displayName = joint.displayName || name;
        const label = new Text({ text: displayName, style: labelStyle });
        label.position.set(sp.x + radius + 5 * s, sp.y - 5 * s);
        this.labelContainer.addChild(label);
      }
    }
  }
}
