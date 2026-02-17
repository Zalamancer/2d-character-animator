import { useState, useRef, useEffect } from 'react';
import { useViewportContext } from '../../contexts/ViewportContext';

const EyeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const items = [
  { label: 'Bones', key: 'showBones', action: 'TOGGLE_BONES' },
  { label: 'Mesh', key: 'showMesh', action: 'TOGGLE_MESH' },
  { label: 'Weights', key: 'showWeights', action: 'TOGGLE_WEIGHTS' },
  { label: 'Labels', key: 'showLabels', action: 'TOGGLE_LABELS' },
] as const;

export function DisplayToggle() {
  const { state: vpState, dispatch: vpDispatch } = useViewportContext();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="display-toggle-container">
      <button
        className="display-toggle-btn"
        onClick={() => setOpen((v) => !v)}
        title="Display options"
      >
        <EyeIcon />
      </button>

      {open && (
        <div className="display-toggle-popover">
          {items.map(({ label, key, action }) => {
            const active = vpState[key];
            return (
              <button
                key={label}
                className={`display-toggle-item ${active ? 'active' : ''}`}
                onClick={() => vpDispatch({ type: action as any, show: !active })}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
