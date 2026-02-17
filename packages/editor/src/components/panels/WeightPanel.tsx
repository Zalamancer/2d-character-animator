import { useCharacterContext } from '../../contexts/CharacterContext';
import { useToolContext } from '../../contexts/ToolContext';
import { RPSlider } from '../ui/RPSlider';

export interface WeightPanelProps {
  onRadiusChange?: (boneIndex: number, radius: number) => void;
}

export function WeightPanel({ onRadiusChange }: WeightPanelProps) {
  const { state: charState } = useCharacterContext();
  const { state: toolState } = useToolContext();

  const { skeleton, selectedJoint } = charState;
  const isEditMode = toolState.editMode;

  if (!skeleton || !selectedJoint || !isEditMode) return null;

  const connectedBones = skeleton.bones.filter(
    (b) => b.from === selectedJoint || b.to === selectedJoint
  );

  if (connectedBones.length === 0) return null;

  return (
    <div className="p-4 border-b border-white/5">
      <h2 className="text-white text-base font-semibold mb-4">
        Bone Influence — {selectedJoint}
      </h2>

      {connectedBones.map((bone) => {
        const radius = bone.radiusMul ?? 1.0;
        return (
          <RPSlider
            key={bone.name}
            label={bone.name}
            value={radius}
            onChange={(v) => onRadiusChange?.(bone.index, v)}
            min={0.01}
            max={3.0}
            step={0.01}
            precision={2}
          />
        );
      })}

      <div className="text-gray-400 text-sm font-semibold mb-3 mt-4 pt-3 border-t border-white/5">
        All Bones
      </div>
      {skeleton.bones.map((bone) => {
        const radius = bone.radiusMul ?? 1.0;
        const isConnected = bone.from === selectedJoint || bone.to === selectedJoint;
        return (
          <div key={bone.name} style={isConnected ? { opacity: 0.4 } : undefined}>
            <RPSlider
              label={bone.name}
              value={radius}
              onChange={(v) => onRadiusChange?.(bone.index, v)}
              min={0.1}
              max={3.0}
              step={0.05}
              precision={2}
            />
          </div>
        );
      })}

      <p className="text-gray-400 text-xs mt-3 leading-relaxed">
        Adjust radius to control bone envelope size. Envelopes are shown as capsules on the character.
      </p>
    </div>
  );
}
