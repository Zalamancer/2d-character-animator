import { createContext, useContext, useReducer } from 'react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface WeightPaintState {
  bone: number;
  radius: number;
  strength: number;
  mode: 'add' | 'subtract' | 'smooth';
  painting: boolean;
}

export interface ToolState {
  editMode: boolean;
  addJointMode: boolean;
  addJointPending: { position: { x: number; y: number } } | null;
  weightPaintMode: boolean;
  wpState: WeightPaintState;
}

const initialState: ToolState = {
  editMode: false,
  addJointMode: false,
  addJointPending: null,
  weightPaintMode: false,
  wpState: {
    bone: 0,
    radius: 30,
    strength: 0.3,
    mode: 'add',
    painting: false,
  },
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ToolAction =
  | { type: 'ENTER_EDIT_MODE' }
  | { type: 'EXIT_EDIT_MODE' }
  | { type: 'TOGGLE_ADD_JOINT'; enabled: boolean }
  | { type: 'SET_ADD_JOINT_PENDING'; pending: { position: { x: number; y: number } } | null }
  | { type: 'ENTER_WEIGHT_PAINT' }
  | { type: 'EXIT_WEIGHT_PAINT' }
  | { type: 'SET_WP_STATE'; state: Partial<WeightPaintState> }
  | { type: 'SET_WP_PAINTING'; painting: boolean };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function toolReducer(state: ToolState, action: ToolAction): ToolState {
  switch (action.type) {
    case 'ENTER_EDIT_MODE':
      return { ...state, editMode: true };

    case 'EXIT_EDIT_MODE':
      return {
        ...state,
        editMode: false,
        addJointMode: false,
        addJointPending: null,
        weightPaintMode: false,
        wpState: { ...state.wpState, painting: false },
      };

    case 'TOGGLE_ADD_JOINT':
      return {
        ...state,
        addJointMode: action.enabled,
        addJointPending: action.enabled ? state.addJointPending : null,
      };

    case 'SET_ADD_JOINT_PENDING':
      return { ...state, addJointPending: action.pending };

    case 'ENTER_WEIGHT_PAINT':
      return { ...state, weightPaintMode: true };

    case 'EXIT_WEIGHT_PAINT':
      return {
        ...state,
        weightPaintMode: false,
        wpState: { ...state.wpState, painting: false },
      };

    case 'SET_WP_STATE':
      return { ...state, wpState: { ...state.wpState, ...action.state } };

    case 'SET_WP_PAINTING':
      return { ...state, wpState: { ...state.wpState, painting: action.painting } };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ToolContextValue {
  state: ToolState;
  dispatch: React.Dispatch<ToolAction>;
}

const ToolContext = createContext<ToolContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToolProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(toolReducer, initialState);

  return (
    <ToolContext.Provider value={{ state, dispatch }}>
      {children}
    </ToolContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToolContext(): ToolContextValue {
  const ctx = useContext(ToolContext);
  if (ctx === undefined) {
    throw new Error('useToolContext must be used within a ToolProvider');
  }
  return ctx;
}
