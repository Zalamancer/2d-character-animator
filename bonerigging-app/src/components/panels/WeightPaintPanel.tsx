import React from 'react';
import { useCharacterContext } from '../../contexts/CharacterContext';
import { useToolContext } from '../../contexts/ToolContext';
import type { WeightPaintState } from '../../contexts/ToolContext';
import '../../styles/panels.css';

export interface WeightPaintPanelProps {
  visible: boolean;
  onReset: () => void;
  onDone: () => void;
}

export function WeightPaintPanel({ visible, onReset, onDone }: WeightPaintPanelProps) {
  const { state: charState } = useCharacterContext();
  const { state: toolState, dispatch: toolDispatch } = useToolContext();

  if (!visible) return null;

  const { skeleton } = charState;
  const { wpState } = toolState;

  const bones = skeleton?.bones ?? [];

  const handleBoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    toolDispatch({ type: 'SET_WP_STATE', state: { bone: Number(e.target.value) } });
  };

  const handleBrushSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    toolDispatch({ type: 'SET_WP_STATE', state: { radius: Number(e.target.value) } });
  };

  const handleStrengthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    toolDispatch({
      type: 'SET_WP_STATE',
      state: { strength: Number(e.target.value) / 100 },
    });
  };

  const setMode = (mode: WeightPaintState['mode']) => {
    toolDispatch({ type: 'SET_WP_STATE', state: { mode } });
  };

  return (
    <div className="panel">
      <h3>Weight Paint</h3>

      {/* Bone selector */}
      <label style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
        Bone:
        <select
          value={wpState.bone}
          onChange={handleBoneChange}
          style={{
            width: '100%',
            padding: 3,
            background: '#333',
            border: '1px solid #555',
            color: '#eee',
            borderRadius: 3,
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {bones.map((b, i) => (
            <option key={b.name} value={i}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      {/* Brush size */}
      <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
        Brush Size: <span>{wpState.radius}</span>
        <input
          type="range"
          min={5}
          max={100}
          value={wpState.radius}
          onChange={handleBrushSizeChange}
          style={{ width: '100%' }}
        />
      </label>

      {/* Strength */}
      <label style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
        Strength: <span>{wpState.strength.toFixed(2)}</span>
        <input
          type="range"
          min={1}
          max={50}
          value={Math.round(wpState.strength * 100)}
          onChange={handleStrengthChange}
          style={{ width: '100%' }}
        />
      </label>

      {/* Mode buttons */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
        <button
          className={`wp-mode${wpState.mode === 'add' ? ' active' : ''}`}
          onClick={() => setMode('add')}
          style={{ flex: 1, padding: 3, fontSize: 11 }}
        >
          Add
        </button>
        <button
          className={`wp-mode${wpState.mode === 'subtract' ? ' active' : ''}`}
          onClick={() => setMode('subtract')}
          style={{ flex: 1, padding: 3, fontSize: 11 }}
        >
          Subtract
        </button>
        <button
          className={`wp-mode${wpState.mode === 'smooth' ? ' active' : ''}`}
          onClick={() => setMode('smooth')}
          style={{ flex: 1, padding: 3, fontSize: 11 }}
        >
          Smooth
        </button>
      </div>

      {/* Reset / Done */}
      <button
        onClick={onReset}
        style={{ width: '100%', padding: 4, fontSize: 12, marginBottom: 4 }}
      >
        Reset to Auto
      </button>
      <button
        onClick={onDone}
        style={{ width: '100%', padding: 4, fontSize: 12 }}
      >
        Done
      </button>
    </div>
  );
}
