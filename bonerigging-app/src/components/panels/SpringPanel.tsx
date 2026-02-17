import { useState } from 'react';
import { useCharacterContext } from '../../contexts/CharacterContext';
import '../../styles/panels.css';

export interface SpringPanelProps {
  visible: boolean;
  onMakeSpring: (stiffness: number, damping: number, gravity: number) => void;
  onRemoveSpring: () => void;
}

export function SpringPanel({ visible, onMakeSpring, onRemoveSpring }: SpringPanelProps) {
  const { state: charState } = useCharacterContext();
  const [stiffness, setStiffness] = useState(15);
  const [damping, setDamping] = useState(85);
  const [gravity, setGravity] = useState(50);

  if (!visible) return null;

  const hasSelection = charState.selectedJoint !== null;

  const handleMakeSpring = () => {
    onMakeSpring(stiffness, damping / 100, gravity);
  };

  return (
    <div className="panel">
      <h3>Spring Settings</h3>

      {/* Stiffness */}
      <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
        Stiffness: <span>{stiffness}</span>
        <input
          type="range"
          min={1}
          max={80}
          value={stiffness}
          onChange={(e) => setStiffness(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </label>

      {/* Damping */}
      <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
        Damping: <span>{(damping / 100).toFixed(2)}</span>
        <input
          type="range"
          min={50}
          max={99}
          value={damping}
          onChange={(e) => setDamping(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </label>

      {/* Gravity */}
      <label style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
        Gravity: <span>{gravity}</span>
        <input
          type="range"
          min={0}
          max={300}
          value={gravity}
          onChange={(e) => setGravity(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </label>

      {/* Action buttons */}
      <button
        onClick={handleMakeSpring}
        disabled={!hasSelection}
        style={{ width: '100%', padding: 4, fontSize: 12, marginBottom: 4 }}
      >
        Make Spring Chain
      </button>
      <button
        onClick={onRemoveSpring}
        disabled={!hasSelection}
        style={{ width: '100%', padding: 4, fontSize: 12 }}
      >
        Remove Spring
      </button>
    </div>
  );
}
