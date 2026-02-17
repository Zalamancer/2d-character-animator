import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useCharacterContext } from '../../contexts/CharacterContext';
import { useAnimationContext } from '../../contexts/AnimationContext';
import '../../styles/timeline.css';

export interface TimelinePanelProps {
  visible: boolean;
  onRecord: () => void;
  onAddKeyframe: () => void;
  onPlay: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onLoadAnimation: (index: number) => void;
  onDeleteAnimation: (index: number) => void;
  onExportAnimations: () => void;
  onImportAnimations: (jsonString: string) => void;
}

export function TimelinePanel({
  visible,
  onRecord,
  onAddKeyframe,
  onPlay,
  onStop,
  onSeek,
  onLoadAnimation,
  onDeleteAnimation,
  onExportAnimations,
  onImportAnimations,
}: TimelinePanelProps) {
  const { state: charState } = useCharacterContext();
  const { state: animState, dispatch: animDispatch, managerRef } = useAnimationContext();

  const [showBoneFilter, setShowBoneFilter] = useState(false);
  const [selectedAnimIndex, setSelectedAnimIndex] = useState(0);
  const importFileRef = useRef<HTMLInputElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

  // ALL hooks must be called before any conditional return!
  const manager = managerRef.current;
  const {
    isRecording,
    isPlaying,
    currentTime,
    duration,
    loop,
    playbackSpeed,
    recordBoneFilter,
    autoFilterRecord,
  } = animState;

  const skeleton = charState.skeleton;
  const bones = skeleton?.bones ?? [];

  // Compute keyframe positions for scrubber markers
  const keyframes = manager.currentAnimation?.keyframes ?? [];
  const effectiveDuration = duration > 0 ? duration : 1;

  const fillPct = (currentTime / effectiveDuration) * 100;
  const handlePct = Math.min(fillPct, 100);

  const handleScrubberClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = scrubberRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      const time = pct * effectiveDuration;
      onSeek(time);
    },
    [effectiveDuration, onSeek]
  );

  const handleScrubberMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      handleScrubberClick(e);

      const handleMouseMove = (ev: MouseEvent) => {
        const rect = scrubberRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = ev.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        const time = pct * effectiveDuration;
        onSeek(time);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [effectiveDuration, onSeek, handleScrubberClick]
  );

  // --- Early return AFTER all hooks ---
  if (!visible) return null;

  // --- Handlers (plain functions, not hooks) ---

  const handleLoopChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    animDispatch({ type: 'SET_LOOP', loop: e.target.checked });
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    animDispatch({ type: 'SET_SPEED', speed: parseFloat(e.target.value) });
  };

  const handleAutoFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    animDispatch({ type: 'SET_AUTO_FILTER', enabled: e.target.checked });
  };

  const handleToggleBoneFilter = () => {
    setShowBoneFilter((prev) => !prev);
  };

  // Bone filter toggles
  const handleBoneFilterToggle = (boneName: string) => {
    const next = new Set(recordBoneFilter);
    if (next.has(boneName)) {
      next.delete(boneName);
    } else {
      next.add(boneName);
    }
    animDispatch({ type: 'SET_BONE_FILTER', filter: next });
  };

  const handleFilterAll = () => {
    const all = new Set(bones.map((b) => b.name));
    // Also add all joint names
    if (skeleton) {
      for (const jn of Object.keys(skeleton.joints)) {
        all.add(jn);
      }
    }
    animDispatch({ type: 'SET_BONE_FILTER', filter: all });
  };

  const handleFilterNone = () => {
    animDispatch({ type: 'SET_BONE_FILTER', filter: new Set<string>() });
  };

  const handleLoadAnim = () => {
    onLoadAnimation(selectedAnimIndex);
  };

  const handleDeleteAnim = () => {
    onDeleteAnimation(selectedAnimIndex);
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
        onImportAnimations(text);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const timeDisplay = `${currentTime.toFixed(2)}s / ${effectiveDuration.toFixed(2)}s`;

  return (
    <div className="timeline-panel">
      {/* Controls row */}
      <div className="tl-controls">
        <button
          onClick={onRecord}
          className={isRecording ? 'rec-active' : ''}
          title="Start/stop recording"
        >
          {'\u25CF'} Record
        </button>
        <button
          onClick={onAddKeyframe}
          disabled={!isRecording}
          title="Capture current pose as keyframe"
        >
          + Key
        </button>
        <button
          onClick={onPlay}
          className={isPlaying ? 'active' : ''}
          disabled={!manager.currentAnimation && manager.animations.length === 0}
          title="Play/pause animation"
        >
          {isPlaying ? '\u275A\u275A Pause' : '\u25B6 Play'}
        </button>
        <button
          onClick={onStop}
          disabled={!isPlaying && !isRecording}
          title="Stop and reset"
        >
          {'\u25A0'} Stop
        </button>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          <input type="checkbox" checked={loop} onChange={handleLoopChange} />
          Loop
        </label>

        <select
          value={playbackSpeed}
          onChange={handleSpeedChange}
          style={{
            padding: '3px 6px',
            background: '#333',
            border: '1px solid #555',
            color: '#eee',
            borderRadius: 3,
            fontSize: 12,
          }}
        >
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>

        <span className="tl-time">{timeDisplay}</span>

        <label
          title="Only record the joint being dragged"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 11,
            color: '#ccc',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={autoFilterRecord}
            onChange={handleAutoFilterChange}
            style={{ margin: 0, cursor: 'pointer' }}
          />
          Auto-filter
        </label>

        <button
          onClick={handleToggleBoneFilter}
          title="Select which bones to record"
          style={{
            padding: '4px 8px',
            fontSize: 11,
            border: '1px solid #555',
            borderRadius: 3,
            background: '#2a2a2a',
            color: '#eee',
            cursor: 'pointer',
          }}
        >
          {'\u2630'} Filter
        </button>
      </div>

      {/* Bone filter panel (collapsible) */}
      {showBoneFilter && (
        <div
          style={{
            marginBottom: 8,
            padding: '6px 8px',
            background: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: 4,
            maxHeight: 100,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 11, color: '#999' }}>Record bones:</span>
            <button
              onClick={handleFilterAll}
              style={{
                padding: '1px 6px',
                fontSize: 10,
                border: '1px solid #555',
                borderRadius: 2,
                background: '#2a2a2a',
                color: '#ccc',
                cursor: 'pointer',
              }}
            >
              All
            </button>
            <button
              onClick={handleFilterNone}
              style={{
                padding: '1px 6px',
                fontSize: 10,
                border: '1px solid #555',
                borderRadius: 2,
                background: '#2a2a2a',
                color: '#ccc',
                cursor: 'pointer',
              }}
            >
              None
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            {bones.map((bone) => (
              <label
                key={bone.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 11,
                  color: '#ccc',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={recordBoneFilter.has(bone.name)}
                  onChange={() => handleBoneFilterToggle(bone.name)}
                  style={{ margin: 0, cursor: 'pointer' }}
                />
                {bone.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Scrubber */}
      <div
        className="tl-scrubber-wrap"
        ref={scrubberRef}
        onMouseDown={handleScrubberMouseDown}
      >
        <div className="tl-scrubber-track">
          <div
            className="tl-scrubber-fill"
            style={{ width: `${Math.min(fillPct, 100)}%` }}
          />
        </div>

        {/* Keyframe markers */}
        <div>
          {keyframes.map((kf, idx) => {
            const pct = effectiveDuration > 0 ? (kf.time / effectiveDuration) * 100 : 0;
            return (
              <div
                key={idx}
                className="tl-keyframe-marker"
                style={{ left: `${pct}%` }}
                title={`Keyframe at ${kf.time.toFixed(2)}s`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(kf.time);
                }}
              />
            );
          })}
        </div>

        <div
          className="tl-scrubber-handle"
          style={{ left: `${handlePct}%` }}
        />
      </div>

      {/* Animation library */}
      <div className="tl-library">
        <span style={{ color: '#888' }}>Library:</span>
        <select
          value={selectedAnimIndex}
          onChange={(e) => setSelectedAnimIndex(Number(e.target.value))}
        >
          {manager.animations.length === 0 && (
            <option value={0}>(no animations)</option>
          )}
          {manager.animations.map((anim, idx) => (
            <option key={`${anim.name}-${anim.ts}`} value={idx}>
              {anim.name}
            </option>
          ))}
        </select>
        <button onClick={handleLoadAnim} disabled={manager.animations.length === 0}>
          Load
        </button>
        <button onClick={handleDeleteAnim} disabled={manager.animations.length === 0}>
          Delete
        </button>

        <span style={{ flex: 1 }} />

        <button onClick={onExportAnimations} disabled={manager.animations.length === 0}>
          Export
        </button>
        <button onClick={handleImportClick}>Import</button>
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
