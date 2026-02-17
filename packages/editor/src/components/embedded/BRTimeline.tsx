import { useEngineContext } from '../../contexts/EngineContext';
import { TimelinePanel } from '../panels/TimelinePanel';
import '../../styles/timeline.css';

/**
 * BRTimeline — the animation timeline for embedded use in AutoStudio's bottom area.
 * Wraps the existing TimelinePanel with engine callbacks.
 * Always visible in embedded mode (no toggle needed).
 */
export function BRTimeline() {
  const engine = useEngineContext();

  return (
    <div className="br-root">
      <TimelinePanel
        visible={true}
        onRecord={engine.handleAnimRecord}
        onAddKeyframe={engine.handleAnimAddKeyframe}
        onPlay={engine.handleAnimPlay}
        onStop={engine.handleAnimStop}
        onSeek={engine.handleAnimSeek}
        onLoadAnimation={engine.handleAnimLoadAnimation}
        onDeleteAnimation={engine.handleAnimDeleteAnimation}
        onExportAnimations={engine.handleAnimExport}
        onImportAnimations={engine.handleAnimImport}
      />
    </div>
  );
}
