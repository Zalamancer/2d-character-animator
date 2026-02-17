import { Application, Container } from 'pixi.js';
import { BoneOverlay } from './BoneOverlay';
import { RasterMesh } from './RasterMesh';
import { MeshOverlay } from './MeshOverlay';
import { WeightOverlay } from './WeightOverlay';
import { EnvelopeOverlay } from './EnvelopeOverlay';
import type { Skeleton } from '../types/skeleton';
import type { ParsedCharacter } from '../types/parsed';
import type { MeshData } from '../types/mesh';
import type { BoneWeight } from '../types/weights';
import type { Transform, Vec2 } from '../types/math';

export interface RenderState {
  skeleton: Skeleton | null;
  parsed: ParsedCharacter | null;
  transform: Transform | null;
  weights: BoneWeight[][] | null;
  selectedJoint: string | null;
  hoveredJoint: string | null;
  pinnedJoints: Set<string>;
  showBones: boolean;
  showMesh: boolean;
  showWeights: boolean;
  showLabels: boolean;
  editMode: boolean;
  mode: 'svg' | 'raster' | null;
  mesh: MeshData | null;
  rasterDeformed: Vec2[] | null;
  rasterImage: HTMLImageElement | null;
}

export class PixiViewport {
  app: Application;
  private initialized = false;

  // Layer containers (bottom to top)
  private rasterMeshLayer!: Container;
  private envelopeLayer!: Container;
  private meshDebugLayer!: Container;
  private weightLayer!: Container;
  private boneLayer!: Container;

  // Sub-renderers
  rasterMesh!: RasterMesh;
  boneOverlay!: BoneOverlay;
  meshOverlay!: MeshOverlay;
  weightOverlay!: WeightOverlay;
  envelopeOverlay!: EnvelopeOverlay;

  constructor() {
    this.app = new Application();
  }

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: container,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    container.appendChild(this.app.canvas);
    this.app.canvas.style.position = 'absolute';
    this.app.canvas.style.inset = '0';
    this.app.canvas.style.zIndex = '1';

    // Create layer containers
    this.rasterMeshLayer = new Container();
    this.envelopeLayer = new Container();
    this.meshDebugLayer = new Container();
    this.weightLayer = new Container();
    this.boneLayer = new Container();

    this.app.stage.addChild(this.rasterMeshLayer);
    this.app.stage.addChild(this.envelopeLayer);
    this.app.stage.addChild(this.meshDebugLayer);
    this.app.stage.addChild(this.weightLayer);
    this.app.stage.addChild(this.boneLayer);

    // Create sub-renderers
    this.rasterMesh = new RasterMesh(this.rasterMeshLayer);
    this.boneOverlay = new BoneOverlay(this.boneLayer);
    this.meshOverlay = new MeshOverlay(this.meshDebugLayer);
    this.weightOverlay = new WeightOverlay(this.weightLayer);
    this.envelopeOverlay = new EnvelopeOverlay(this.envelopeLayer);

    this.initialized = true;
  }

  render(state: RenderState): void {
    if (!this.initialized) return;

    const {
      skeleton, parsed, transform, weights,
      selectedJoint, hoveredJoint, pinnedJoints,
      showBones, showMesh, showWeights, showLabels,
      editMode, mode, mesh, rasterDeformed, rasterImage,
    } = state;

    // Raster mesh
    if (mode === 'raster' && mesh && rasterDeformed && transform && rasterImage) {
      this.rasterMeshLayer.visible = true;
      this.rasterMesh.render(mesh, rasterDeformed, transform, rasterImage);
    } else {
      this.rasterMeshLayer.visible = false;
    }

    // Envelopes (edit mode only)
    if (editMode && skeleton && parsed && transform) {
      this.envelopeLayer.visible = true;
      this.envelopeOverlay.draw(skeleton, parsed, transform, selectedJoint);
    } else {
      this.envelopeLayer.visible = false;
    }

    // Mesh debug
    if (showMesh && transform) {
      this.meshDebugLayer.visible = true;
      if (mode === 'raster' && mesh && rasterDeformed) {
        this.meshOverlay.drawWireframe(mesh, rasterDeformed, transform);
      } else if (parsed) {
        this.meshOverlay.drawSVGPoints(parsed, transform);
      }
    } else {
      this.meshDebugLayer.visible = false;
    }

    // Weights
    if (showWeights && skeleton && transform && weights) {
      this.weightLayer.visible = true;
      if (mode === 'raster' && mesh && rasterDeformed) {
        this.weightOverlay.drawRaster(mesh, rasterDeformed, weights, skeleton, transform);
      } else if (parsed) {
        this.weightOverlay.drawSVG(parsed, weights, skeleton, transform);
      }
    } else {
      this.weightLayer.visible = false;
    }

    // Bones
    if (showBones && skeleton && transform) {
      this.boneLayer.visible = true;
      this.boneOverlay.draw(skeleton, transform, selectedJoint, hoveredJoint, pinnedJoints, editMode, showLabels);
    } else {
      this.boneLayer.visible = false;
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
