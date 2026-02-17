import { createContext, useContext } from 'react';
import type { BoneRiggingEngineAPI } from '../hooks/useBoneRiggingEngine';

const EngineContext = createContext<BoneRiggingEngineAPI | null>(null);

export function EngineContextProvider({ value, children }: { value: BoneRiggingEngineAPI; children: React.ReactNode }) {
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngineContext(): BoneRiggingEngineAPI {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngineContext must be used within a BoneRiggingProvider');
  return ctx;
}
