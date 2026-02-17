import { useCharacterContext } from './contexts/CharacterContext';
import { useViewportContext } from './contexts/ViewportContext';
import { useToolContext } from './contexts/ToolContext';
import { useAnimationContext } from './contexts/AnimationContext';
import { useEngineContext } from './contexts/EngineContext';
import { Toolbar } from './components/layout/Toolbar';
import { Statusbar } from './components/layout/Statusbar';
import { Viewport } from './components/viewport/Viewport';
import { SVGLayer } from './components/viewport/SVGLayer';
import { UploadPrompt } from './components/viewport/UploadPrompt';
import { ZoomControls } from './components/viewport/ZoomControls';
import { DisplayToggle } from './components/viewport/DisplayToggle';
import { TimelinePanel } from './components/panels/TimelinePanel';
import { PosePanel } from './components/panels/PosePanel';
import { WeightPaintPanel } from './components/panels/WeightPaintPanel';
import { WeightPanel } from './components/panels/WeightPanel';
import './styles/global.css';
import './styles/toolbar.css';
import './styles/viewport.css';
import './styles/panels.css';
import './styles/timeline.css';

// ---------------------------------------------------------------------------
// Inner App — thin render shell that uses the EngineContext for all logic
// ---------------------------------------------------------------------------

function AppInner() {
  const { state: charState } = useCharacterContext();
  const { state: vpState } = useViewportContext();
  const { state: toolState } = useToolContext();
  const { state: animState } = useAnimationContext();
  const engine = useEngineContext();

  const hasCharacter = charState.parsed !== null;

  const svgTransform = {
    scale: vpState.scale,
    offsetX: vpState.offsetX,
    offsetY: vpState.offsetY,
  };

  return (
    <div id="app">
      <Toolbar
        onUpload={engine.loadFile}
        onResetPose={engine.handleResetPose}
        onEditRig={engine.handleEditRig}
        onApplyRig={engine.handleApplyRig}
        onAddJoint={engine.handleAddJoint}
        onDeleteJoint={engine.handleDeleteJoint}
        onMirror={engine.handleMirror}
        onUndo={engine.handleUndo}
        onRedo={engine.handleRedo}
        onToggleTimeline={engine.handleToggleTimeline}
        onTogglePoses={engine.handleTogglePoses}
        onToggleWeightPaint={engine.handleToggleWeightPaint}
        onToggleFFD={engine.handleToggleFFD}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        fps={engine.fps}
      />
      <Viewport
        ref={engine.viewportContainerRef as React.RefObject<HTMLDivElement>}
        pixiRef={engine.pixiRef as React.MutableRefObject<any>}
        svgLayerRef={engine.pixiContainerRef as React.MutableRefObject<HTMLDivElement | null>}
        onFileDrop={engine.loadFile}
        computeTransform={engine.computeTransform}
        applyDeformation={engine.applyDeformation}
        render={engine.renderScene}
        showPoses={engine.showPoses}
      >
        <UploadPrompt visible={!hasCharacter} />

        {charState.mode === 'svg' && charState.parsed && (
          <SVGLayer
            svgElement={charState.parsed.svgElement}
            transform={svgTransform}
          />
        )}

        <div
          ref={engine.pixiContainerRef as React.RefObject<HTMLDivElement>}
          className="pixi-canvas"
          style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
        />

        {/* Weight paint brush cursor */}
        <div
          ref={engine.brushCursorRef as React.RefObject<HTMLDivElement>}
          style={{
            display: toolState.weightPaintMode ? 'block' : 'none',
            position: 'absolute',
            borderRadius: '50%',
            border: '2px solid rgba(255, 200, 0, 0.7)',
            pointerEvents: 'none',
            zIndex: 3,
            width: toolState.wpState.radius * 2,
            height: toolState.wpState.radius * 2,
            transform: 'translate(0, 0)',
          }}
        />

        <ZoomControls
          zoom={vpState.zoom}
          onZoomIn={engine.handleZoomIn}
          onZoomOut={engine.handleZoomOut}
          onReset={engine.handleZoomReset}
        />

        <DisplayToggle />

        {/* Side panels — stop pointer events from reaching viewport handlers */}
        <div
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100% - 16px)', overflowY: 'auto', pointerEvents: 'auto' }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <WeightPanel onRadiusChange={engine.handleRadiusChange} />
          <WeightPaintPanel
            visible={toolState.weightPaintMode}
            onReset={engine.handleWeightPaintReset}
            onDone={engine.handleWeightPaintDone}
          />
          <PosePanel
            visible={engine.showPoses}
            poses={engine.poses}
            onSavePose={engine.handleSavePose}
            onApplyPose={engine.handleApplyPose}
            onDeletePose={engine.handleDeletePose}
            onExportPoses={engine.handleExportPoses}
            onImportPoses={engine.handleImportPoses}
          />
        </div>
      </Viewport>

      <TimelinePanel
        visible={animState.showTimeline}
        onRecord={engine.handleAnimRecord}
        onAddKeyframe={engine.handleAnimAddKeyframe}
        onPlay={engine.handleAnimPlay}
        onStop={engine.handleAnimStop}
        onSeek={engine.handleAnimSeek}
        onLoadAnimation={engine.handleAnimLoadAnimation}
        onDeleteAnimation={engine.handleAnimDeleteAnimation}
        onExportAnimations={engine.handleAnimExport}
        onImportAnimations={engine.handleAnimImport}
      />

      <Statusbar text={engine.statusText} />
    </div>
  );
}

export default AppInner;
