import type { ReactNode } from 'react';
import { CharacterProvider, useCharacterContext } from '../../contexts/CharacterContext';
import { ViewportProvider } from '../../contexts/ViewportContext';
import { ToolProvider } from '../../contexts/ToolContext';
import { AnimationProvider } from '../../contexts/AnimationContext';
import { EngineContextProvider } from '../../contexts/EngineContext';
import { useBoneRiggingEngine } from '../../hooks/useBoneRiggingEngine';
import type { SerializedRigData, CharacterLibraryEntry } from '@bonerigging/core';

// Re-use the editor context from RiggingEditor for onSave/onCancel/initialData
import { createContext, useContext, useEffect } from 'react';

export interface BoneRiggingProviderProps {
  children: ReactNode;
  onSave?: (data: SerializedRigData) => void;
  onCancel?: () => void;
  initialData?: SerializedRigData | null;
  initialImageUrl?: string;
  characterLibrary?: CharacterLibraryEntry[];
}

// Editor-level context (passes props down to engine)
interface EditorPropsContextValue {
  onSave?: (data: SerializedRigData) => void;
  onCancel?: () => void;
  initialData?: SerializedRigData | null;
  initialImageUrl?: string;
}

const EditorPropsContext = createContext<EditorPropsContextValue>({});
export function useEditorPropsContext() {
  return useContext(EditorPropsContext);
}

/**
 * Internal: Syncs the characterLibrary prop into CharacterContext.
 * Must be rendered INSIDE CharacterProvider.
 */
function CharacterLibrarySync({ library }: { library?: CharacterLibraryEntry[] }) {
  const { dispatch } = useCharacterContext();
  useEffect(() => {
    if (library && library.length > 0) {
      dispatch({ type: 'SET_CHARACTER_LIBRARY', library });
    }
  }, [library, dispatch]);
  return null;
}

/**
 * Internal: Initializes the engine and provides it via EngineContext.
 * Must be rendered INSIDE all 4 context providers.
 */
function EngineBootstrap({ children }: { children: ReactNode }) {
  const engine = useBoneRiggingEngine();
  return (
    <EngineContextProvider value={engine}>
      {children}
    </EngineContextProvider>
  );
}

/**
 * BoneRiggingProvider — wraps children with all bonerigging context providers + engine.
 * Used by AutoStudio's EditorLayout to provide shared state across all 3 panels.
 */
export function BoneRiggingProvider({
  children,
  onSave,
  onCancel,
  initialData,
  initialImageUrl,
  characterLibrary,
}: BoneRiggingProviderProps) {
  return (
    <EditorPropsContext.Provider value={{ onSave, onCancel, initialData, initialImageUrl }}>
      <CharacterProvider>
        <CharacterLibrarySync library={characterLibrary} />
        <ViewportProvider>
          <ToolProvider>
            <AnimationProvider>
              <EngineBootstrap>
                {children}
              </EngineBootstrap>
            </AnimationProvider>
          </ToolProvider>
        </ViewportProvider>
      </CharacterProvider>
    </EditorPropsContext.Provider>
  );
}
