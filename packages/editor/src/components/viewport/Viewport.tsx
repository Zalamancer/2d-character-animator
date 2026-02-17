import React, { useState, useCallback, useRef, forwardRef } from 'react';
import { useToolContext } from '../../contexts/ToolContext';
import type { PixiViewport as PixiViewportType } from '../../pixi/PixiViewport';
import '../../styles/viewport.css';

export interface ViewportProps {
  onFileDrop: (file: File) => void;
  pixiRef: React.MutableRefObject<PixiViewportType | null>;
  svgLayerRef: React.MutableRefObject<HTMLDivElement | null>;
  computeTransform: () => { scale: number; offsetX: number; offsetY: number };
  applyDeformation: () => void;
  render: () => void;
  showPoses: boolean;
  children?: React.ReactNode;
}

export const Viewport = forwardRef<HTMLDivElement, ViewportProps>(function Viewport(
  { onFileDrop, pixiRef: _pixiRef, svgLayerRef: _svgLayerRef, computeTransform: _computeTransform, applyDeformation: _applyDeformation, render: _render, showPoses: _showPoses, children },
  ref,
) {
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
      if (file) {
        onFileDrop(file);
      }
    },
    [onFileDrop]
  );

  const classNames = [
    'viewport',
    dragOver ? 'drag-over' : '',
    toolState.editMode ? 'edit-mode' : '',
    toolState.weightPaintMode ? 'weight-paint-mode' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={classNames}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}

      {/* Add Joint helper tooltip */}
      {toolState.addJointMode && (
        <div className="add-joint-help">
          Click on character to place joint, then click a parent joint
        </div>
      )}
    </div>
  );
});
