import { createContext, useContext, useReducer } from 'react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  /** Computed transform: SVG/image coords -> screen coords */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Display toggles */
  showBones: boolean;
  showMesh: boolean;
  showWeights: boolean;
  showLabels: boolean;
  meshDensity: number;
}

const initialState: ViewportState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  showBones: true,
  showMesh: false,
  showWeights: false,
  showLabels: true,
  meshDensity: 8,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ViewportAction =
  | { type: 'SET_ZOOM'; zoom: number; panX: number; panY: number }
  | { type: 'ZOOM'; zoom: number }
  | { type: 'SET_PAN'; panX: number; panY: number }
  | { type: 'PAN'; panX: number; panY: number }
  | { type: 'SET_TRANSFORM'; scale: number; offsetX: number; offsetY: number }
  | { type: 'TOGGLE_BONES'; show: boolean }
  | { type: 'TOGGLE_MESH'; show: boolean }
  | { type: 'TOGGLE_WEIGHTS'; show: boolean }
  | { type: 'TOGGLE_LABELS'; show: boolean }
  | { type: 'SET_MESH_DENSITY'; density: number }
  | { type: 'RESET_VIEW' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function viewportReducer(state: ViewportState, action: ViewportAction): ViewportState {
  switch (action.type) {
    case 'SET_ZOOM':
      return { ...state, zoom: action.zoom, panX: action.panX, panY: action.panY };

    case 'ZOOM':
      return { ...state, zoom: action.zoom };

    case 'SET_PAN':
    case 'PAN':
      return { ...state, panX: action.panX, panY: action.panY };

    case 'SET_TRANSFORM':
      return { ...state, scale: action.scale, offsetX: action.offsetX, offsetY: action.offsetY };

    case 'TOGGLE_BONES':
      return { ...state, showBones: action.show };

    case 'TOGGLE_MESH':
      return { ...state, showMesh: action.show };

    case 'TOGGLE_WEIGHTS':
      return { ...state, showWeights: action.show };

    case 'TOGGLE_LABELS':
      return { ...state, showLabels: action.show };

    case 'SET_MESH_DENSITY':
      return { ...state, meshDensity: action.density };

    case 'RESET_VIEW':
      return {
        ...state,
        zoom: initialState.zoom,
        panX: initialState.panX,
        panY: initialState.panY,
      };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ViewportContextValue {
  state: ViewportState;
  dispatch: React.Dispatch<ViewportAction>;
}

const ViewportContext = createContext<ViewportContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ViewportProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(viewportReducer, initialState);

  return (
    <ViewportContext.Provider value={{ state, dispatch }}>
      {children}
    </ViewportContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useViewportContext(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (ctx === undefined) {
    throw new Error('useViewportContext must be used within a ViewportProvider');
  }
  return ctx;
}
