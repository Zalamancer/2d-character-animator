import { createContext, useContext, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { AnimationManager } from '../core/animation-manager';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AnimationState {
  isRecording: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loop: boolean;
  playbackSpeed: number;
  showTimeline: boolean;
  recordBoneFilter: Set<string>;
  autoFilterRecord: boolean;
  lastDraggedJoint: string | null;
}

const initialState: AnimationState = {
  isRecording: false,
  isPlaying: false,
  currentTime: 0,
  duration: 2,
  loop: false,
  playbackSpeed: 1.0,
  showTimeline: false,
  recordBoneFilter: new Set<string>(),
  autoFilterRecord: false,
  lastDraggedJoint: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AnimationAction =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'SET_TIME'; time: number }
  | { type: 'SET_DURATION'; duration: number }
  | { type: 'SET_LOOP'; loop: boolean }
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'TOGGLE_TIMELINE'; show: boolean }
  | { type: 'SET_BONE_FILTER'; filter: Set<string> }
  | { type: 'SET_AUTO_FILTER'; enabled: boolean }
  | { type: 'SET_LAST_DRAGGED'; joint: string | null };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function animationReducer(state: AnimationState, action: AnimationAction): AnimationState {
  switch (action.type) {
    case 'START_RECORDING':
      return { ...state, isRecording: true };

    case 'STOP_RECORDING':
      return { ...state, isRecording: false };

    case 'PLAY':
      return { ...state, isPlaying: true };

    case 'PAUSE':
      return { ...state, isPlaying: false };

    case 'STOP':
      return { ...state, isPlaying: false, currentTime: 0 };

    case 'SET_TIME':
      return { ...state, currentTime: action.time };

    case 'SET_DURATION':
      return { ...state, duration: action.duration };

    case 'SET_LOOP':
      return { ...state, loop: action.loop };

    case 'SET_SPEED':
      return { ...state, playbackSpeed: action.speed };

    case 'TOGGLE_TIMELINE':
      return { ...state, showTimeline: action.show };

    case 'SET_BONE_FILTER':
      return { ...state, recordBoneFilter: action.filter };

    case 'SET_AUTO_FILTER':
      return { ...state, autoFilterRecord: action.enabled };

    case 'SET_LAST_DRAGGED':
      return { ...state, lastDraggedJoint: action.joint };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AnimationContextValue {
  state: AnimationState;
  dispatch: React.Dispatch<AnimationAction>;
  managerRef: React.MutableRefObject<AnimationManager>;
}

const AnimationContext = createContext<AnimationContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AnimationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(animationReducer, initialState);
  const managerRef = useRef<AnimationManager>(new AnimationManager());

  return (
    <AnimationContext.Provider value={{ state, dispatch, managerRef }}>
      {children}
    </AnimationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAnimationContext(): AnimationContextValue {
  const ctx = useContext(AnimationContext);
  if (ctx === undefined) {
    throw new Error('useAnimationContext must be used within an AnimationProvider');
  }
  return ctx;
}
