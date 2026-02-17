import { useCallback, useRef, type Dispatch } from 'react';
import type { ParsedCharacter } from '@bonerigging/core';
import type { Transform } from '@bonerigging/core';
import type { ViewportAction } from '../contexts/ViewportContext';

/**
 * Hook that manages viewport zoom, pan, and the computed SVG-to-screen
 * transform.
 *
 * Zoom and pan are stored in mutable refs so they can be read during
 * high-frequency pointer-move events without triggering React re-renders.
 * State changes are flushed to the ViewportContext reducer at the end of
 * each interaction.
 */
export function useViewport(viewportDispatch: Dispatch<ViewportAction>) {
  const zoomRef = useRef(1.0);
  const panRef = useRef({ x: 0, y: 0 });

  // ---------------------------------------------------------------------------
  // Compute the base fit-to-viewport transform, then apply zoom + pan.
  // Returns the final transform and dispatches SET_TRANSFORM.
  // ---------------------------------------------------------------------------
  const computeTransform = useCallback(
    (parsed: ParsedCharacter, containerWidth: number, containerHeight: number): Transform => {
      const vb = parsed.viewBox;
      const padding = 40;
      const availW = containerWidth - padding * 2;
      const availH = containerHeight - padding * 2;
      const scaleX = availW / vb.w;
      const scaleY = availH / vb.h;
      const baseScale = Math.min(scaleX, scaleY);
      const baseOffsetX = (containerWidth - vb.w * baseScale) / 2 - vb.x * baseScale;
      const baseOffsetY = (containerHeight - vb.h * baseScale) / 2 - vb.y * baseScale;

      const zoom = zoomRef.current;
      const pan = panRef.current;
      const finalScale = baseScale * zoom;
      const finalOffsetX = baseOffsetX * zoom + pan.x;
      const finalOffsetY = baseOffsetY * zoom + pan.y;

      viewportDispatch({
        type: 'SET_TRANSFORM',
        scale: finalScale,
        offsetX: finalOffsetX,
        offsetY: finalOffsetY,
      });

      return { scale: finalScale, offsetX: finalOffsetX, offsetY: finalOffsetY };
    },
    [viewportDispatch],
  );

  // ---------------------------------------------------------------------------
  // Zoom by a multiplicative factor, optionally toward a cursor position.
  // ---------------------------------------------------------------------------
  const zoomBy = useCallback(
    (
      factor: number,
      cursorX?: number,
      cursorY?: number,
      parsed?: ParsedCharacter,
      containerW?: number,
      containerH?: number,
    ) => {
      const newZoom = Math.max(0.1, Math.min(20, zoomRef.current * factor));

      // Zoom toward cursor when all necessary info is provided
      if (
        cursorX !== undefined &&
        cursorY !== undefined &&
        parsed &&
        containerW &&
        containerH
      ) {
        const vb = parsed.viewBox;
        const padding = 40;
        const availW = containerW - padding * 2;
        const availH = containerH - padding * 2;
        const scaleX = availW / vb.w;
        const scaleY = availH / vb.h;
        const baseScale = Math.min(scaleX, scaleY);
        const baseOffsetX =
          (containerW - vb.w * baseScale) / 2 - vb.x * baseScale;
        const baseOffsetY =
          (containerH - vb.h * baseScale) / 2 - vb.y * baseScale;

        const oldZoom = zoomRef.current;
        const svgX =
          (cursorX - baseOffsetX * oldZoom - panRef.current.x) /
          (baseScale * oldZoom);
        const svgY =
          (cursorY - baseOffsetY * oldZoom - panRef.current.y) /
          (baseScale * oldZoom);

        panRef.current.x =
          cursorX - svgX * baseScale * newZoom - baseOffsetX * newZoom;
        panRef.current.y =
          cursorY - svgY * baseScale * newZoom - baseOffsetY * newZoom;
      }

      zoomRef.current = newZoom;

      viewportDispatch({
        type: 'SET_ZOOM',
        zoom: newZoom,
        panX: panRef.current.x,
        panY: panRef.current.y,
      });
    },
    [viewportDispatch],
  );

  // ---------------------------------------------------------------------------
  // Reset zoom and pan to defaults
  // ---------------------------------------------------------------------------
  const resetView = useCallback(() => {
    zoomRef.current = 1.0;
    panRef.current = { x: 0, y: 0 };
    viewportDispatch({ type: 'RESET_VIEW' });
  }, [viewportDispatch]);

  // ---------------------------------------------------------------------------
  // Pan helpers -- startPan captures initial positions, updatePan applies delta
  // ---------------------------------------------------------------------------
  interface PanStart {
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  }

  const startPan = useCallback(
    (clientX: number, clientY: number): PanStart => ({
      startX: clientX,
      startY: clientY,
      startPanX: panRef.current.x,
      startPanY: panRef.current.y,
    }),
    [],
  );

  const updatePan = useCallback(
    (clientX: number, clientY: number, panStart: PanStart) => {
      panRef.current.x = panStart.startPanX + (clientX - panStart.startX);
      panRef.current.y = panStart.startPanY + (clientY - panStart.startY);
      viewportDispatch({
        type: 'SET_PAN',
        panX: panRef.current.x,
        panY: panRef.current.y,
      });
    },
    [viewportDispatch],
  );

  return {
    computeTransform,
    zoomBy,
    resetView,
    startPan,
    updatePan,
    zoomRef,
    panRef,
  };
}
