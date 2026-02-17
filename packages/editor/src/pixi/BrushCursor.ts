import { Container, Graphics } from 'pixi.js';

export class BrushCursor {
  private graphics: Graphics;

  constructor(parent: Container) {
    this.graphics = new Graphics();
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  show(x: number, y: number, radius: number): void {
    this.graphics.clear();
    this.graphics.circle(x, y, radius);
    this.graphics.stroke({ width: 1.5, color: 0xffffff, alpha: 0.6 });
    this.graphics.circle(x, y, 1);
    this.graphics.fill({ color: 0xffffff, alpha: 0.8 });
    this.graphics.visible = true;
  }

  hide(): void {
    this.graphics.visible = false;
  }
}
