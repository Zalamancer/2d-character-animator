// =============================================================================
// @bonerigging/editor — React-based 2D character rigging editor component
// =============================================================================

// Full-screen editor (standalone / route-based)
export { RiggingEditor } from './RiggingEditor';
export type { RiggingEditorProps, EditorContextValue } from './RiggingEditor';
export { useEditorContext } from './RiggingEditor';

// Embedded components (for 3-panel layout integration)
export { BoneRiggingProvider } from './components/embedded/BoneRiggingProvider';
export type { BoneRiggingProviderProps } from './components/embedded/BoneRiggingProvider';
export { BRToolPanel } from './components/embedded/BRToolPanel';
export { BRViewport } from './components/embedded/BRViewport';
export { BRPropertiesPanel } from './components/embedded/BRPropertiesPanel';
export { BRTimeline } from './components/embedded/BRTimeline';

// Lightweight playback viewer (for main canvas — same rendering as editor)
export { RigPlaybackViewer } from './components/embedded/RigPlaybackViewer';
export type { RigPlaybackViewerProps } from './components/embedded/RigPlaybackViewer';

// Context hooks (for host app integration — e.g. auto-save on unmount)
export { useEngineContext } from './contexts/EngineContext';
export type { BoneRiggingEngineAPI } from './hooks/useBoneRiggingEngine';

// Re-export core types for convenience
export type { SerializedRigData, SerializedAnimation } from '@bonerigging/core';
