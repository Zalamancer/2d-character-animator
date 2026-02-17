import { useCallback, type Dispatch } from 'react';
import type { ToolAction, WeightPaintState } from '../contexts/ToolContext';

/**
 * Hook that wraps the ToolContext reducer dispatch with semantically named
 * callbacks for each tool mode transition.
 *
 * Manages:
 *  - Edit mode (skeleton editing: moving rest poses, adding/deleting joints)
 *  - Add-joint mode toggle
 *  - Weight paint mode entry/exit and brush parameter updates
 */
export function useTools(toolDispatch: Dispatch<ToolAction>) {
  const enterEditMode = useCallback(() => {
    toolDispatch({ type: 'ENTER_EDIT_MODE' });
  }, [toolDispatch]);

  const exitEditMode = useCallback(() => {
    toolDispatch({ type: 'EXIT_EDIT_MODE' });
  }, [toolDispatch]);

  const toggleAddJoint = useCallback(
    (enabled: boolean) => {
      toolDispatch({ type: 'TOGGLE_ADD_JOINT', enabled });
    },
    [toolDispatch],
  );

  const setAddJointPending = useCallback(
    (pending: { position: { x: number; y: number } } | null) => {
      toolDispatch({ type: 'SET_ADD_JOINT_PENDING', pending });
    },
    [toolDispatch],
  );

  const enterWeightPaint = useCallback(() => {
    toolDispatch({ type: 'ENTER_WEIGHT_PAINT' });
  }, [toolDispatch]);

  const exitWeightPaint = useCallback(() => {
    toolDispatch({ type: 'EXIT_WEIGHT_PAINT' });
  }, [toolDispatch]);

  const setWpState = useCallback(
    (state: Partial<WeightPaintState>) => {
      toolDispatch({ type: 'SET_WP_STATE', state });
    },
    [toolDispatch],
  );

  const setWpPainting = useCallback(
    (painting: boolean) => {
      toolDispatch({ type: 'SET_WP_PAINTING', painting });
    },
    [toolDispatch],
  );

  return {
    enterEditMode,
    exitEditMode,
    toggleAddJoint,
    setAddJointPending,
    enterWeightPaint,
    exitWeightPaint,
    setWpState,
    setWpPainting,
  };
}
