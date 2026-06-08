import { Container, Graphics } from 'pixi.js';
import type { Skeleton } from '@bonerigging/core';
import type { Transform, Vec2 } from '@bonerigging/core';

function svgToScreen(p: Vec2, t: Transform): Vec2 {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

// Arc configs: color, tilt rotation, and parametric angle range
const ARCS = [
  { color: 0xE53935, rotation: 0 },                // Red (bottom, X-Z plane)
  { color: 0x2979FF, rotation: -Math.PI / 3 },     // Blue (left, X-Y plane)
  { color: 0x00BFA5, rotation: Math.PI / 3 },      // Teal (right, Y-Z plane)
];

// Axis arrow configs: color and direction angle
const ARROWS = [
  { color: 0xE53935, angle: -Math.PI / 2 },                        // Red: up
  { color: 0x00BFA5, angle: -Math.PI / 2 + (2 * Math.PI / 3) },   // Teal: lower-right
  { color: 0x2979FF, angle: -Math.PI / 2 + (4 * Math.PI / 3) },   // Blue: lower-left
];

export class RotationGizmoOverlay {
  private graphics: Graphics;

  constructor(parent: Container) {
    this.graphics = new Graphics();
    parent.addChild(this.graphics);
  }

  draw(
    skeleton: Skeleton,
    transform: Transform,
    selectedJoint: string | null,
    editMode: boolean,
    uiScale: number = 1,
  ): void {
    this.graphics.clear();

    if (!selectedJoint || editMode) return;

    const joint = skeleton.joints[selectedJoint];
    if (!joint) return;

    const center = svgToScreen(joint.current, transform);
    const R = 60 * uiScale;
    const s = uiScale;

    this.drawArcs(center, R, s);
    this.drawConnectingTriangle(center, R, s);
    this.drawAxisArrows(center, R, s);
    this.drawCenterDots(center, s);
  }

  // --- Parametric ellipse helpers ---

  private ellipsePoint(
    cx: number, cy: number,
    rx: number, ry: number,
    rotation: number,
    t: number,
  ): { x: number; y: number } {
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const px = rx * Math.cos(t);
    const py = ry * Math.sin(t);
    return {
      x: cx + px * cosR - py * sinR,
      y: cy + px * sinR + py * cosR,
    };
  }

  private drawEllipticalArc(
    cx: number, cy: number,
    rx: number, ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    segments: number,
    color: number,
    lineWidth: number,
    alpha: number = 1,
  ): void {
    const step = (endAngle - startAngle) / segments;
    const start = this.ellipsePoint(cx, cy, rx, ry, rotation, startAngle);
    this.graphics.moveTo(start.x, start.y);
    for (let i = 1; i <= segments; i++) {
      const t = startAngle + step * i;
      const pt = this.ellipsePoint(cx, cy, rx, ry, rotation, t);
      this.graphics.lineTo(pt.x, pt.y);
    }
    this.graphics.stroke({ width: lineWidth, color, alpha, cap: 'round' });
  }

  // --- Drawing methods ---

  private drawArcs(center: { x: number; y: number }, R: number, s: number): void {
    const lineWidth = 3 * s;
    const segments = 48;
    const ry = R * 0.35;
    const startAngle = Math.PI * 0.15;
    const endAngle = Math.PI * 0.85;

    for (const arc of ARCS) {
      this.drawEllipticalArc(
        center.x, center.y, R, ry, arc.rotation,
        startAngle, endAngle, segments,
        arc.color, lineWidth,
      );
    }
  }

  private drawConnectingTriangle(center: { x: number; y: number }, R: number, s: number): void {
    const ry = R * 0.35;
    const startAngle = Math.PI * 0.15;
    const endAngle = Math.PI * 0.85;

    // Get endpoints of each arc
    const redStart = this.ellipsePoint(center.x, center.y, R, ry, 0, startAngle);
    const redEnd = this.ellipsePoint(center.x, center.y, R, ry, 0, endAngle);
    const blueStart = this.ellipsePoint(center.x, center.y, R, ry, -Math.PI / 3, startAngle);
    const blueEnd = this.ellipsePoint(center.x, center.y, R, ry, -Math.PI / 3, endAngle);
    const tealStart = this.ellipsePoint(center.x, center.y, R, ry, Math.PI / 3, startAngle);
    const tealEnd = this.ellipsePoint(center.x, center.y, R, ry, Math.PI / 3, endAngle);

    const color = 0xFFA726;
    const lineWidth = 2 * s;
    const alpha = 0.85;

    // Connect adjacent arc endpoints to form triangle
    this.graphics.moveTo(redEnd.x, redEnd.y);
    this.graphics.lineTo(tealStart.x, tealStart.y);
    this.graphics.stroke({ width: lineWidth, color, alpha });

    this.graphics.moveTo(tealEnd.x, tealEnd.y);
    this.graphics.lineTo(blueStart.x, blueStart.y);
    this.graphics.stroke({ width: lineWidth, color, alpha });

    this.graphics.moveTo(blueEnd.x, blueEnd.y);
    this.graphics.lineTo(redStart.x, redStart.y);
    this.graphics.stroke({ width: lineWidth, color, alpha });
  }

  private drawTeardropArrow(
    cx: number, cy: number,
    angle: number,
    length: number,
    tipSize: number,
    color: number,
    lineWidth: number,
  ): void {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const px = -dy; // perpendicular
    const py = dx;

    const tipX = cx + dx * length;
    const tipY = cy + dy * length;

    // Shaft line from near center to near the bulb
    const shaftStart = length * 0.2;
    const shaftEnd = length - tipSize * 1.3;
    this.graphics.moveTo(cx + dx * shaftStart, cy + dy * shaftStart);
    this.graphics.lineTo(cx + dx * shaftEnd, cy + dy * shaftEnd);
    this.graphics.stroke({ width: lineWidth, color, alpha: 1, cap: 'round' });

    // Teardrop bulb
    const bulbCx = tipX - dx * tipSize * 0.7;
    const bulbCy = tipY - dy * tipSize * 0.7;
    const w = tipSize * 0.5;

    this.graphics.moveTo(tipX, tipY);
    // Right side curve
    this.graphics.bezierCurveTo(
      tipX - dx * tipSize * 0.25 + px * w * 0.6,
      tipY - dy * tipSize * 0.25 + py * w * 0.6,
      bulbCx + px * w,
      bulbCy + py * w,
      bulbCx + px * w * 0.7,
      bulbCy + py * w * 0.7,
    );
    // Back curve
    this.graphics.bezierCurveTo(
      bulbCx - dx * tipSize * 0.25 + px * w * 0.3,
      bulbCy - dy * tipSize * 0.25 + py * w * 0.3,
      bulbCx - dx * tipSize * 0.25 - px * w * 0.3,
      bulbCy - dy * tipSize * 0.25 - py * w * 0.3,
      bulbCx - px * w * 0.7,
      bulbCy - py * w * 0.7,
    );
    // Left side curve back to tip
    this.graphics.bezierCurveTo(
      bulbCx - px * w,
      bulbCy - py * w,
      tipX - dx * tipSize * 0.25 - px * w * 0.6,
      tipY - dy * tipSize * 0.25 - py * w * 0.6,
      tipX, tipY,
    );
    this.graphics.fill({ color, alpha: 1 });
  }

  private drawAxisArrows(center: { x: number; y: number }, R: number, s: number): void {
    const arrowLength = R * 0.82;
    const tipSize = 9 * s;
    const lineWidth = 2 * s;

    for (const arrow of ARROWS) {
      this.drawTeardropArrow(
        center.x, center.y,
        arrow.angle, arrowLength, tipSize,
        arrow.color, lineWidth,
      );
    }
  }

  private drawCenterDots(center: { x: number; y: number }, s: number): void {
    const dotRadius = 3 * s;
    const offset = 3.5 * s;

    this.graphics.circle(center.x - offset * 0.3, center.y - offset * 0.2, dotRadius);
    this.graphics.fill({ color: 0x999999, alpha: 0.85 });

    this.graphics.circle(center.x + offset * 0.35, center.y + offset * 0.3, dotRadius);
    this.graphics.fill({ color: 0x777777, alpha: 0.7 });
  }
}
