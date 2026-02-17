interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  bottomOffset?: number;
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset, bottomOffset = 12 }: ZoomControlsProps) {
  return (
    <div className="zoom-controls" style={{ bottom: bottomOffset }}>
      <button onClick={onZoomIn} title="Zoom In">+</button>
      <button onClick={onReset} title="Reset View">⟲</button>
      <button onClick={onZoomOut} title="Zoom Out">−</button>
      <span className="zoom-level">{Math.round(zoom * 100)}%</span>
    </div>
  );
}
