import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { PixiViewport } from '../../pixi/PixiViewport';

export interface PixiCanvasProps {
  width?: number;
  height?: number;
}

export interface PixiCanvasHandle {
  viewport: PixiViewport | null;
}

export const PixiCanvas = forwardRef<PixiCanvasHandle, PixiCanvasProps>(
  function PixiCanvas({ width, height }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<PixiViewport | null>(null);

    useImperativeHandle(ref, () => ({
      get viewport() {
        return viewportRef.current;
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const vp = new PixiViewport();
      viewportRef.current = vp;

      let destroyed = false;

      vp.init(container).then(() => {
        if (destroyed) {
          vp.destroy();
          return;
        }
        // Resize canvas if explicit dimensions are provided
        if (width !== undefined && height !== undefined) {
          vp.app.renderer.resize(width, height);
        }
      });

      return () => {
        destroyed = true;
        if (viewportRef.current) {
          viewportRef.current.destroy();
          viewportRef.current = null;
        }
      };
    }, []); // Only mount/unmount once

    // Handle resize changes
    useEffect(() => {
      const vp = viewportRef.current;
      if (vp && width !== undefined && height !== undefined) {
        try {
          vp.app.renderer.resize(width, height);
        } catch (_e) {
          // Renderer may not be ready yet
        }
      }
    }, [width, height]);

    return (
      <div
        ref={containerRef}
        className="pixi-canvas"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
        }}
      />
    );
  }
);
