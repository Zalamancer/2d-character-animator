import { useToolContext } from '../../contexts/ToolContext';
import { useEngineContext } from '../../contexts/EngineContext';
import { WeightPanel } from '../panels/WeightPanel';
import { WeightPaintPanel } from '../panels/WeightPaintPanel';
import { PosePanel } from '../panels/PosePanel';

/**
 * BRPropertiesPanel — right panel content for embedded use in AutoStudio.
 * Contains WeightPanel + WeightPaintPanel + PosePanel stacked vertically.
 * Uses exact same layout patterns as AutoStudio's RightPanel sections.
 */
export function BRPropertiesPanel() {
  const engine = useEngineContext();
  const { state: toolState } = useToolContext();

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Status info — same section style as RightPanel */}
      <div className="p-4 border-b border-white/5">
        <span className="text-gray-400 text-xs">{engine.statusText}</span>
      </div>

      {/* Weight Panel (bone influence sliders) — visible in edit mode when joint selected */}
      <WeightPanel onRadiusChange={engine.handleRadiusChange} />

      {/* Weight Paint Panel — visible when weight paint mode active */}
      <WeightPaintPanel
        visible={toolState.weightPaintMode}
        onReset={engine.handleWeightPaintReset}
        onDone={engine.handleWeightPaintDone}
      />

      {/* Pose Panel — visible when poses toggled */}
      <PosePanel
        visible={engine.showPoses}
        poses={engine.poses}
        onSavePose={engine.handleSavePose}
        onApplyPose={engine.handleApplyPose}
        onDeletePose={engine.handleDeletePose}
        onExportPoses={engine.handleExportPoses}
        onImportPoses={engine.handleImportPoses}
      />
    </div>
  );
}
