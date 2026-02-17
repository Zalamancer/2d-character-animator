import { createContext, useContext, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { ParsedCharacter } from '../types/parsed';
import type { Skeleton } from '../types/skeleton';
import type { BoneWeight } from '../types/weights';
import type { MeshData } from '../types/mesh';
import type { Vec2 } from '../types/math';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CharacterState {
  parsed: ParsedCharacter | null;
  skeleton: Skeleton | null;
  weights: BoneWeight[][] | null;
  mesh: MeshData | null;
  mode: 'svg' | 'raster' | null;
  rasterImage: HTMLImageElement | null;
  selectedJoint: string | null;
  hoveredJoint: string | null;
  pinnedJoints: Set<string>;
  deformMode: 'stretch' | 'rigid';
  squashStretchEnabled: boolean;
  springChains: any[];
  ffdMode: boolean;
  ffdOffsets: Vec2[] | null;
  ffdSelectedVertex: number;
  statusText: string;
}

const initialState: CharacterState = {
  parsed: null,
  skeleton: null,
  weights: null,
  mesh: null,
  mode: null,
  rasterImage: null,
  selectedJoint: null,
  hoveredJoint: null,
  pinnedJoints: new Set<string>(),
  deformMode: 'rigid',
  squashStretchEnabled: false,
  springChains: [],
  ffdMode: false,
  ffdOffsets: null,
  ffdSelectedVertex: -1,
  statusText: '',
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type CharacterAction =
  | {
      type: 'SET_CHARACTER';
      parsed: ParsedCharacter;
      skeleton: Skeleton;
      weights: BoneWeight[][];
      mesh: MeshData | null;
      mode: 'svg' | 'raster';
      rasterImage: HTMLImageElement | null;
    }
  | { type: 'UPDATE_SKELETON'; skeleton: Skeleton }
  | { type: 'UPDATE_WEIGHTS'; weights: BoneWeight[][] }
  | { type: 'UPDATE_MESH'; mesh: MeshData }
  | { type: 'SELECT_JOINT'; name: string | null }
  | { type: 'HOVER_JOINT'; name: string | null }
  | { type: 'TOGGLE_PIN'; joint: string }
  | { type: 'SET_PINNED'; pinned: Set<string> }
  | { type: 'SET_DEFORM_MODE'; mode: 'stretch' | 'rigid' }
  | { type: 'TOGGLE_SQUASH_STRETCH'; enabled: boolean }
  | { type: 'SET_SPRING_CHAINS'; chains: any[] }
  | { type: 'SET_FFD_MODE'; enabled: boolean }
  | { type: 'SET_FFD_OFFSETS'; offsets: Vec2[] | null }
  | { type: 'SET_FFD_SELECTED'; index: number }
  | { type: 'SET_STATUS'; text: string }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function characterReducer(state: CharacterState, action: CharacterAction): CharacterState {
  switch (action.type) {
    case 'SET_CHARACTER':
      return {
        ...initialState,
        parsed: action.parsed,
        skeleton: action.skeleton,
        weights: action.weights,
        mesh: action.mesh,
        mode: action.mode,
        rasterImage: action.rasterImage,
      };

    case 'UPDATE_SKELETON':
      return { ...state, skeleton: action.skeleton };

    case 'UPDATE_WEIGHTS':
      return { ...state, weights: action.weights };

    case 'UPDATE_MESH':
      return { ...state, mesh: action.mesh };

    case 'SELECT_JOINT':
      return { ...state, selectedJoint: action.name };

    case 'HOVER_JOINT':
      return { ...state, hoveredJoint: action.name };

    case 'TOGGLE_PIN': {
      const next = new Set(state.pinnedJoints);
      if (next.has(action.joint)) {
        next.delete(action.joint);
      } else {
        next.add(action.joint);
      }
      return { ...state, pinnedJoints: next };
    }

    case 'SET_PINNED':
      return { ...state, pinnedJoints: action.pinned };

    case 'SET_DEFORM_MODE':
      return { ...state, deformMode: action.mode };

    case 'TOGGLE_SQUASH_STRETCH':
      return { ...state, squashStretchEnabled: action.enabled };

    case 'SET_SPRING_CHAINS':
      return { ...state, springChains: action.chains };

    case 'SET_FFD_MODE':
      return { ...state, ffdMode: action.enabled };

    case 'SET_FFD_OFFSETS':
      return { ...state, ffdOffsets: action.offsets };

    case 'SET_FFD_SELECTED':
      return { ...state, ffdSelectedVertex: action.index };

    case 'SET_STATUS':
      return { ...state, statusText: action.text };

    case 'RESET':
      return { ...initialState };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface CharacterContextValue {
  state: CharacterState;
  dispatch: React.Dispatch<CharacterAction>;
}

const CharacterContext = createContext<CharacterContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CharacterProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(characterReducer, initialState);

  return (
    <CharacterContext.Provider value={{ state, dispatch }}>
      {children}
    </CharacterContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCharacterContext(): CharacterContextValue {
  const ctx = useContext(CharacterContext);
  if (ctx === undefined) {
    throw new Error('useCharacterContext must be used within a CharacterProvider');
  }
  return ctx;
}
