import { useState, useRef } from 'react';
import { useCharacterContext } from '../../contexts/CharacterContext';
import type { Pose } from '../../types/animation';
import '../../styles/panels.css';

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
    <div className="panel">
      <h3>Saved Poses</h3>

      {/* Pose list */}
      <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
        {poses.length === 0 && (
          <div style={{ color: '#555', fontSize: 11, padding: '4px 0' }}>
            No poses saved yet
          </div>
        )}
        {poses.map((pose, idx) => (
          <div className="pose-item" key={`${pose.name}-${pose.ts}`}>
            <span className="pose-name" title={pose.name}>
              {pose.name}
            </span>
            <button
              onClick={() => onApplyPose(idx)}
              disabled={!charState.skeleton}
              title="Apply this pose"
            >
              Apply
            </button>
            <button
              onClick={() => onDeletePose(idx)}
              title="Delete this pose"
            >
              Del
            </button>
          </div>
        ))}
      </div>

      {/* Save new pose */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <input
          type="text"
          placeholder="Pose name..."
          value={poseName}
          onChange={(e) => setPoseName(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            padding: '4px 6px',
            background: '#333',
            border: '1px solid #555',
            color: '#eee',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
        <button
          onClick={handleSave}
          disabled={!charState.skeleton}
          style={{ padding: '4px 8px', fontSize: 12 }}
        >
          Save
        </button>
      </div>

      {/* Export / Import */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={onExportPoses}
          disabled={poses.length === 0}
          style={{ flex: 1, padding: 3, fontSize: 11 }}
        >
          Export JSON
        </button>
        <button
          onClick={handleImportClick}
          style={{ flex: 1, padding: 3, fontSize: 11 }}
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
