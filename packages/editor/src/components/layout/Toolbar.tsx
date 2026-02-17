import React, { useRef } from 'react';
import { useCharacterContext } from '../../contexts/CharacterContext';
import { useViewportContext } from '../../contexts/ViewportContext';
import { useToolContext } from '../../contexts/ToolContext';
import { useAnimationContext } from '../../contexts/AnimationContext';
import '../../styles/toolbar.css';

export interface ToolbarProps {
  onUpload: (file: File) => void;
  onResetPose: () => void;
  onEditRig: () => void;
  onApplyRig: () => void;
  onAddJoint: () => void;
  onDeleteJoint: () => void;
  onMirror: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleTimeline: () => void;
  onTogglePoses: () => void;
  onToggleWeightPaint: () => void;
  onToggleFFD: () => void;
  canUndo: boolean;
  canRedo: boolean;
  fps: number;
}

export function Toolbar({
  onUpload,
  onResetPose,
  onEditRig,
  onApplyRig,
  onAddJoint,
  onDeleteJoint,
  onMirror,
  onUndo,
  onRedo,
  onToggleTimeline,
  onTogglePoses,
  onToggleWeightPaint,
  onToggleFFD,
  canUndo,
  canRedo,
  fps,
}: ToolbarProps) {
  const { state: charState, dispatch: charDispatch } = useCharacterContext();
  const { state: vpState, dispatch: vpDispatch } = useViewportContext();
  const { state: toolState } = useToolContext();
  const { state: animState } = useAnimationContext();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasCharacter = charState.parsed !== null;
  const isEditMode = toolState.editMode;

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      // Reset input so the same file can be re-uploaded
      e.target.value = '';
    }
  };

  const handleDeformModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    charDispatch({
      type: 'SET_DEFORM_MODE',
      mode: e.target.value as 'stretch' | 'rigid',
    });
  };

  const handlePinJoint = () => {
    if (charState.selectedJoint) {
      charDispatch({ type: 'TOGGLE_PIN', joint: charState.selectedJoint });
    }
  };

  const handleSquashStretchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    charDispatch({ type: 'TOGGLE_SQUASH_STRETCH', enabled: e.target.checked });
  };

  const handleShowBonesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    vpDispatch({ type: 'TOGGLE_BONES', show: e.target.checked });
  };

  const handleShowMeshChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    vpDispatch({ type: 'TOGGLE_MESH', show: e.target.checked });
  };

  const handleShowWeightsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    vpDispatch({ type: 'TOGGLE_WEIGHTS', show: e.target.checked });
  };

  const handleShowLabelsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    vpDispatch({ type: 'TOGGLE_LABELS', show: e.target.checked });
  };

  const handleMeshDensityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    vpDispatch({ type: 'SET_MESH_DENSITY', density: Number(e.target.value) });
  };

  const isPinned = charState.selectedJoint
    ? charState.pinnedJoints.has(charState.selectedJoint)
    : false;

  const modeLabel = charState.mode === 'svg'
    ? 'SVG'
    : charState.mode === 'raster'
      ? 'Raster'
      : '';

  return (
    <div className="toolbar">
      {/* Upload */}
      <button onClick={handleUploadClick}>Upload File</button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.webp,.gif,.bmp"
        hidden
        onChange={handleFileChange}
      />

      {/* Reset Pose */}
      <button onClick={onResetPose} disabled={!hasCharacter}>
        Reset Pose
      </button>

      <span className="separator" />

      {/* Deform mode */}
      <select value={charState.deformMode} onChange={handleDeformModeChange}>
        <option value="stretch">Stretch</option>
        <option value="rigid">Rigid</option>
      </select>

      {/* Pin Joint */}
      <button
        onClick={handlePinJoint}
        disabled={!charState.selectedJoint}
        className={isPinned ? 'pin-active' : ''}
        title="Pin/unpin selected joint (right-click also works)"
      >
        Pin Joint
      </button>

      <span className="separator" />

      {/* Edit Rig group */}
      {!isEditMode && (
        <button onClick={onEditRig} disabled={!hasCharacter}>
          Edit Rig
        </button>
      )}
      {isEditMode && (
        <>
          <button onClick={onApplyRig}>Apply Rig</button>
          <button onClick={onAddJoint}>+ Add Joint</button>
          <button className="danger" onClick={onDeleteJoint}>
            - Delete Joint
          </button>
          <button onClick={onMirror}>Mirror L-&gt;R</button>
        </>
      )}

      <span className="separator" />

      {/* Undo / Redo */}
      <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        Redo
      </button>

      {/* Feature panels */}
      <button onClick={onTogglePoses} disabled={!hasCharacter} title="Save/load poses">
        Poses
      </button>
      <button
        onClick={onToggleTimeline}
        disabled={!hasCharacter}
        className={animState.showTimeline ? 'active' : ''}
        title="Animation timeline"
      >
        Timeline
      </button>
      <button
        onClick={onToggleWeightPaint}
        disabled={!hasCharacter}
        title="Paint bone weights manually"
      >
        Weight Paint
      </button>
      <button
        onClick={onToggleFFD}
        disabled={!hasCharacter}
        className={charState.ffdMode ? 'active' : ''}
        title="Free-Form Deformation"
      >
        FFD
      </button>

      {/* Squash & Stretch */}
      <label>
        <input
          type="checkbox"
          checked={charState.squashStretchEnabled}
          onChange={handleSquashStretchChange}
        />
        S&amp;S
      </label>

      <span className="separator" />

      {/* Show toggles */}
      <label>
        <input
          type="checkbox"
          checked={vpState.showBones}
          onChange={handleShowBonesChange}
        />
        Bones
      </label>
      <label>
        <input
          type="checkbox"
          checked={vpState.showMesh}
          onChange={handleShowMeshChange}
        />
        Mesh
      </label>
      <label>
        <input
          type="checkbox"
          checked={vpState.showWeights}
          onChange={handleShowWeightsChange}
        />
        Weights
      </label>
      <label>
        <input
          type="checkbox"
          checked={vpState.showLabels}
          onChange={handleShowLabelsChange}
        />
        Labels
      </label>

      {/* Mesh density (raster mode only) */}
      {charState.mode === 'raster' && (
        <label style={{ fontSize: 12, color: '#aaa' }}>
          Mesh:
          <select value={vpState.meshDensity} onChange={handleMeshDensityChange}>
            <option value={8}>Low</option>
            <option value={16}>Medium</option>
            <option value={30}>High</option>
            <option value={50}>Ultra</option>
          </select>
        </label>
      )}

      {/* Flex spacer */}
      <span style={{ flex: 1 }} />

      {/* Mode indicator */}
      {modeLabel && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: isEditMode ? '#5a5' : '#666',
          }}
        >
          {modeLabel}{isEditMode ? ' [Edit]' : ''}
        </span>
      )}

      {/* FPS counter */}
      <span style={{ fontSize: 12, color: '#666' }}>
        {fps > 0 ? `${fps} fps` : ''}
      </span>
    </div>
  );
}
