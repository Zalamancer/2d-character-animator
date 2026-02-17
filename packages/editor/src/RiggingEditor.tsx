import { createContext, useContext } from 'react';
import { BoneRiggingProvider } from './components/embedded/BoneRiggingProvider';
import type { SerializedRigData } from '@bonerigging/core';

// ---------------------------------------------------------------------------
// Editor Props
// ---------------------------------------------------------------------------

export interface RiggingEditorProps {
  /** Callback when user clicks Save. Receives serialized rig data. */
  onSave?: (data: SerializedRigData) => void;

  /** Callback when user clicks Cancel/Close. */
  onCancel?: () => void;

  /** Initial rig data to load (for editing existing rigs). */
  initialData?: SerializedRigData | null;

  /** Initial image URL to load (for creating new rigs). */
  initialImageUrl?: string;

  /** Container height. Defaults to '100vh'. */
  height?: string | number;
}

// ---------------------------------------------------------------------------
// Editor Context (passes props down to AppInner) — kept for backward compat
// ---------------------------------------------------------------------------

export interface EditorContextValue {
  onSave?: (data: SerializedRigData) => void;
  onCancel?: () => void;
  initialData?: SerializedRigData | null;
  initialImageUrl?: string;
}

const EditorContext = createContext<EditorContextValue>({});

export function useEditorContext(): EditorContextValue {
  return useContext(EditorContext);
}

// ---------------------------------------------------------------------------
// Lazy import of the heavy AppInner component
// ---------------------------------------------------------------------------

import EditorInnerApp from './EditorInner';

// ---------------------------------------------------------------------------
// RiggingEditor — The top-level public component
// ---------------------------------------------------------------------------

export function RiggingEditor({
  onSave,
  onCancel,
  initialData,
  initialImageUrl,
  height = '100vh',
}: RiggingEditorProps) {
  return (
    <EditorContext.Provider
      value={{ onSave, onCancel, initialData, initialImageUrl }}
    >
      <div
        className="br-root"
        style={{
          height: typeof height === 'number' ? `${height}px` : height,
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
          isolation: 'isolate', // Prevent CSS bleed from host app
        }}
      >
        <BoneRiggingProvider
          onSave={onSave}
          onCancel={onCancel}
          initialData={initialData}
          initialImageUrl={initialImageUrl}
        >
          <EditorInnerApp />
        </BoneRiggingProvider>
      </div>
    </EditorContext.Provider>
  );
}
