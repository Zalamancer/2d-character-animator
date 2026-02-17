import { useState } from 'react';
import { useCharacterContext } from '../../contexts/CharacterContext';
import { useToolContext } from '../../contexts/ToolContext';
import '../../styles/panels.css';

export interface WeightPanelProps {
  /** Called when the user adjusts a bone radius multiplier */
  onRadiusChange?: (boneIndex: number, radius: number) => void;
}

export function WeightPanel({ onRadiusChange }: WeightPanelProps) {
  const { state: charState } = useCharacterContext();
  const { state: toolState } = useToolContext();
  const [allBonesExpanded, setAllBonesExpanded] = useState(false);

  const { skeleton, selectedJoint } = charState;
  const isEditMode = toolState.editMode;

  if (!skeleton || !selectedJoint || !isEditMode) return null;

  const connectedBones = skeleton.bones.filter(
    (b) => b.from === selectedJoint || b.to === selectedJoint
  );

  if (connectedBones.length === 0) return null;

  const handleSliderChange = (boneIndex: number, value: number) => {
    onRadiusChange?.(boneIndex, value);
  };

  return (
    <div className="weight-panel">
      <div className="weight-panel-header">
        <span className="weight-panel-title">Bone Influence</span>
        <span className="weight-panel-joint">{selectedJoint}</span>
      </div>

      <div className="weight-panel-section">
        <div className="weight-panel-section-label">Connected</div>
        <div className="weight-panel-list">
          {connectedBones.map((bone) => {
            const radius = bone.radiusMul ?? 1.0;
            const pct = ((radius - 0.1) / (3.0 - 0.1)) * 100;
            return (
              <div className="weight-row" key={bone.name}>
                <span className="weight-row-name" title={bone.name}>{bone.name}</span>
                <div className="weight-slider-wrap">
                  <input
                    type="range"
                    min={0.1}
                    max={3.0}
                    step={0.05}
                    value={radius}
                    className="weight-slider"
                    style={{ '--fill': `${pct}%` } as React.CSSProperties}
                    onChange={(e) =>
                      handleSliderChange(bone.index, parseFloat(e.target.value))
                    }
                  />
                </div>
                <span className="weight-row-val">{radius.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="weight-panel-section">
        <button
          className="weight-panel-section-toggle"
          onClick={() => setAllBonesExpanded(!allBonesExpanded)}
        >
          <svg
            className={`weight-chevron ${allBonesExpanded ? 'expanded' : ''}`}
            width="10"
            height="10"
            viewBox="0 0 10 10"
          >
            <path d="M3 2L7 5L3 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>All Bones</span>
          <span className="weight-panel-count">{skeleton.bones.length}</span>
        </button>

        {allBonesExpanded && (
          <div className="weight-panel-list">
            {skeleton.bones.map((bone) => {
              const radius = bone.radiusMul ?? 1.0;
              const pct = ((radius - 0.1) / (3.0 - 0.1)) * 100;
              const isConnected = bone.from === selectedJoint || bone.to === selectedJoint;
              return (
                <div
                  className={`weight-row ${isConnected ? 'weight-row--dimmed' : ''}`}
                  key={bone.name}
                >
                  <span className="weight-row-name" title={bone.name}>{bone.name}</span>
                  <div className="weight-slider-wrap">
                    <input
                      type="range"
                      min={0.1}
                      max={3.0}
                      step={0.05}
                      value={radius}
                      className="weight-slider"
                      style={{ '--fill': `${pct}%` } as React.CSSProperties}
                      onChange={(e) =>
                        handleSliderChange(bone.index, parseFloat(e.target.value))
                      }
                    />
                  </div>
                  <span className="weight-row-val">{radius.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="weight-panel-hint">
        Adjust radius to control bone envelope size
      </div>
    </div>
  );
}
