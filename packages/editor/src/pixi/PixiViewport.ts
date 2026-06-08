import { Application, Container } from 'pixi.js';
import { BoneOverlay } from './BoneOverlay';
import { RasterMesh } from './RasterMesh';
import { MeshOverlay } from './MeshOverlay';
import { WeightOverlay } from './WeightOverlay';
import { EnvelopeOverlay } from './EnvelopeOverlay';
import { RotationGizmoOverlay } from './RotationGizmoOverlay';
import type { Skeleton } from '@bonerigging/core';
import type { ParsedCharacter } from '@bonerigging/core';
import type { MeshData } from '@bonerigging/core';
import type { BoneWeight } from '@bonerigging/core';
import type { Transform, Vec2 } from '@bonerigging/core';

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
  /** Multiplier for bone UI element sizes (joint radii, line widths).
   *  Use 1/cssScale when the canvas renders at higher resolution than display. */
  uiScale?: number;
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
  private gizmoLayer!: Container;

  // Sub-renderers
  rasterMesh!: RasterMesh;
  boneOverlay!: BoneOverlay;
  meshOverlay!: MeshOverlay;
  weightOverlay!: WeightOverlay;
  envelopeOverlay!: EnvelopeOverlay;
  rotationGizmo!: RotationGizmoOverlay;

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
    this.gizmoLayer = new Container();
    this.app.stage.addChild(this.gizmoLayer);

    // Create sub-renderers
    this.rasterMesh = new RasterMesh(this.rasterMeshLayer);
    this.boneOverlay = new BoneOverlay(this.boneLayer);
    this.meshOverlay = new MeshOverlay(this.meshDebugLayer);
    this.weightOverlay = new WeightOverlay(this.weightLayer);
    this.envelopeOverlay = new EnvelopeOverlay(this.envelopeLayer);
    this.rotationGizmo = new RotationGizmoOverlay(this.gizmoLayer);

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
      this.boneOverlay.draw(skeleton, transform, selectedJoint, hoveredJoint, pinnedJoints, editMode, showLabels, state.uiScale ?? 1);
    } else {
      this.boneLayer.visible = false;
    }

    // Rotation gizmo
    if (showBones && skeleton && transform && selectedJoint && !editMode) {
      this.gizmoLayer.visible = true;
      this.rotationGizmo.draw(skeleton, transform, selectedJoint, editMode, state.uiScale ?? 1);
    } else {
      this.gizmoLayer.visible = false;
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  destroy(): void {
    if (!this.initialized) {
      // init() hasn't finished — nothing to clean up yet.
      // The PixiCanvas cleanup handler already guards against
      // calling destroy() after a late-resolving init via the
      // `destroyed` flag, so this is safe.
      return;
    }
    // Prevent double-destroy
    this.initialized = false;
    try {
      this.app.destroy(true);
    } catch (_e) {
      // Swallow PixiJS internal errors during teardown
      // (e.g. _cancelResize race in some browser environments)
    }
  }
}
