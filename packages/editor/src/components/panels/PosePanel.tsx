import { useState, useRef } from 'react';
import { useCharacterContext } from '../../contexts/CharacterContext';
import type { Pose } from '../../types/animation';

export interface PosePanelProps {
  visible: boolean;
  poses: Pose[];
  onSavePose: (name: string) => void;
  onApplyPose: (index: number) => void;
  onDeletePose: (index: number) => void;
  onExportPoses: () => void;
  onImportPoses: (jsonString: string) => void;
  onClose?: () => void;
}

export function PosePanel({
  visible,
  poses,
  onSavePose,
  onApplyPose,
  onDeletePose,
  onExportPoses,
  onImportPoses,
  onClose: _onClose,
}: PosePanelProps) {
  const { state: charState } = useCharacterContext();
  const [poseName, setPoseName] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);

  if (!visible) return null;

  const handleSave = () => {
    const name = poseName.trim() || `Pose ${poses.length + 1}`;
    onSavePose(name);
    setPoseName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  const handleImportClick = () => {
    importFileRef.current?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        onImportPoses(text);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="p-4 border-b border-white/5">
      <h2 className="text-white text-base font-semibold mb-4">Saved Poses</h2>

      {/* Pose list */}
      <div style={{ maxHeight: 200, overflowY: 'auto' }} className="mb-3">
        {poses.length === 0 && (
          <div className="text-gray-400 text-xs py-1">
            No poses saved yet
          </div>
        )}
        {poses.map((pose, idx) => (
          <div key={`${pose.name}-${pose.ts}`} className="flex items-center gap-2 mb-1.5">
            <span className="text-gray-400 text-sm flex-1 truncate" title={pose.name}>
              {pose.name}
            </span>
            <button
              onClick={() => onApplyPose(idx)}
              disabled={!charState.skeleton}
              className="bg-[#2a2a2a] text-white text-xs px-2.5 py-1.5 rounded-lg hover:bg-[#3a3a3a] transition-colors disabled:opacity-40"
            >
              Apply
            </button>
            <button
              onClick={() => onDeletePose(idx)}
              className="bg-[#2a2a2a] text-gray-400 text-xs px-2.5 py-1.5 rounded-lg hover:text-white hover:bg-[#3a3a3a] transition-colors"
            >
              Del
            </button>
          </div>
        ))}
      </div>

      {/* Save new pose — same row style as Font select */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Pose name..."
          value={poseName}
          onChange={(e) => setPoseName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-[#2a2a2a] text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#4a7eff]"
        />
        <button
          onClick={handleSave}
          disabled={!charState.skeleton}
          className="bg-[#4a7eff] text-white text-sm px-3 py-2 rounded-lg hover:bg-[#3a6eef] transition-colors disabled:opacity-40"
        >
          Save
        </button>
      </div>

      {/* Export / Import */}
      <div className="flex items-center gap-2">
        <button
          onClick={onExportPoses}
          disabled={poses.length === 0}
          className="flex-1 bg-[#2a2a2a] text-gray-400 text-sm px-3 py-2 rounded-lg hover:text-white transition-colors disabled:opacity-40"
        >
          Export JSON
        </button>
        <button
          onClick={handleImportClick}
          className="flex-1 bg-[#2a2a2a] text-gray-400 text-sm px-3 py-2 rounded-lg hover:text-white transition-colors"
        >
          Import JSON
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".json"
          hidden
          onChange={handleImportFile}
        />
      </div>
    </div>
  );
}
