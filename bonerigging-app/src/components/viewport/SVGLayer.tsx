import React, { useRef, useEffect } from 'react';

export interface SVGLayerProps {
  svgElement: SVGSVGElement | null;
  transform: { scale: number; offsetX: number; offsetY: number };
}

export function SVGLayer({ svgElement, transform }: SVGLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Append the SVG element directly (not a clone, so deformation updates are visible)
    if (svgElement) {
      // Set width/height to match viewBox so the SVG has intrinsic size.
      // The parent container's CSS transform handles zoom/pan.
      const vb = svgElement.viewBox?.baseVal;
      if (vb && vb.width > 0 && vb.height > 0) {
        svgElement.setAttribute('width', String(vb.width));
        svgElement.setAttribute('height', String(vb.height));
      }
      // Ensure overflow visible so deformed paths outside bounds still render
      svgElement.style.overflow = 'visible';
      container.appendChild(svgElement);
    }
  }, [svgElement]);

  if (!svgElement) return null;

  const transformStyle: React.CSSProperties = {
    transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
    transformOrigin: '0 0',
  };

  return (
    <div className="svg-container" style={transformStyle}>
      <div ref={containerRef} />
    </div>
  );
}
