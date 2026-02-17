import { useState, useCallback, useRef } from 'react';
import { useCharacterContext } from '../../contexts/CharacterContext';
import { useViewportContext } from '../../contexts/ViewportContext';
import { useToolContext } from '../../contexts/ToolContext';
import { useEngineContext } from '../../contexts/EngineContext';
import { SVGLayer } from '../viewport/SVGLayer';
import { UploadPrompt } from '../viewport/UploadPrompt';
import { ZoomControls } from '../viewport/ZoomControls';
import { DisplayToggle } from '../viewport/DisplayToggle';
import { JointPopover } from '../viewport/JointPopover';
import '../../styles/viewport.css';

/**
 * BRViewport — the canvas area for embedded use in AutoStudio's center panel.
 * Renders PixiJS canvas + SVG layer + zoom controls + brush cursor.
 * Does NOT include side panels or timeline.
 */
export function BRViewport() {
  const engine = useEngineContext();
  const { state: charState } = useCharacterContext();
  const { state: vpState } = useViewportContext();
  const { state: toolState } = useToolContext();

  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      dragCounterRef.current = 0;
      const file = e.dataTransfer.files[0];
      if (file) engine.loadFile(file);
    },
    [engine]
  );

  const hasCharacter = charState.parsed !== null;

  const classNames = [
    'viewport',
    dragOver ? 'drag-over' : '',
    toolState.editMode ? 'edit-mode' : '',
    toolState.weightPaintMode ? 'weight-paint-mode' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const svgTransform = {
    scale: vpState.scale,
    offsetX: vpState.offsetX,
    offsetY: vpState.offsetY,
  };

  return (
    <div className="br-root" style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
      <div
        ref={engine.viewportContainerRef as React.RefObject<HTMLDivElement>}
        className={classNames}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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

        <JointPopover />

        {/* Add Joint helper tooltip */}
        {toolState.addJointMode && (
          <div className="add-joint-help">
            Click on character to place joint, then click a parent joint
          </div>
        )}
      </div>
    </div>
  );
}
