import { useCharacterContext } from '../../contexts/CharacterContext';
import { useViewportContext } from '../../contexts/ViewportContext';

/**
 * JointPopover — a small floating "Pin" button that appears on the canvas
 * near the selected joint. Gives quick access to pin/unpin without the sidebar.
 */
export function JointPopover() {
  const { state: charState, dispatch: charDispatch } = useCharacterContext();
  const { state: vpState } = useViewportContext();

  const { selectedJoint, skeleton, pinnedJoints } = charState;

  if (!selectedJoint || !skeleton) return null;

  const joint = skeleton.joints[selectedJoint];
  if (!joint) return null;

  // Convert SVG-space position to screen position using viewport transform
  const sx = joint.current.x * vpState.scale + vpState.offsetX;
  const sy = joint.current.y * vpState.scale + vpState.offsetY;

  const isPinned = pinnedJoints.has(selectedJoint);

  const stop = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <div
      className="joint-popover"
      style={{ left: sx, top: sy }}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className={`joint-popover-btn ${isPinned ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          charDispatch({ type: 'TOGGLE_PIN', joint: selectedJoint });
        }}
        title={isPinned ? 'Unpin joint' : 'Pin joint'}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 17v5" />
          <path d="M9 11V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7" />
          <path d="M5 15h14l-1.5-4H6.5z" />
        </svg>
      </button>
    </div>
  );
}
