import { useCallback, useRef, type Dispatch } from 'react';
import { AnimationManager } from '@bonerigging/core';
import type { Animation } from '@bonerigging/core';
import type { Skeleton } from '@bonerigging/core';
import type { AnimationAction } from '../contexts/AnimationContext';

/**
 * Hook that encapsulates animation recording, playback, and timeline
 * scrubbing.
 *
 * Owns an AnimationManager instance (via ref) and keeps the
 * AnimationContext state in sync via dispatched actions.
 */
export function useAnimation(animDispatch: Dispatch<AnimationAction>) {
  const managerRef = useRef<AnimationManager>(new AnimationManager());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  const startRecording = useCallback(
    (name?: string, fps?: number, startTime?: number) => {
      const mgr = managerRef.current;
      mgr.startRecording(
        name || 'Animation ' + (mgr.animations.length + 1),
        fps,
        startTime,
      );
      animDispatch({ type: 'START_RECORDING' });
    },
    [animDispatch],
  );

  /**
   * Start recording a new layer on top of an existing animation.
   * Returns `true` if the animation index was valid and recording started.
   */
  const startLayerRecording = useCallback(
    (animIndex: number, startTime?: number): boolean => {
      const mgr = managerRef.current;
      const ok = mgr.startLayerRecording(animIndex, startTime);
      if (ok) {
        animDispatch({ type: 'START_RECORDING' });
      }
      return ok;
    },
    [animDispatch],
  );

  const stopRecording = useCallback((): Animation | null => {
    const mgr = managerRef.current;
    const result = mgr.stopRecording();
    animDispatch({ type: 'STOP_RECORDING' });
    return result;
  }, [animDispatch]);

  /**
   * Capture a keyframe from the current skeleton pose.
   *
   * @param skeleton      - current skeleton state
   * @param pinnedJoints  - set of pinned joint names
   * @param time          - explicit time; if omitted the manager uses its head
   * @param recordFilter  - optional set of joint names to restrict recording to
   */
  const addKeyframe = useCallback(
    (
      skeleton: Skeleton,
      pinnedJoints: Set<string>,
      time?: number,
      recordFilter?: Set<string> | null,
    ) => {
      const mgr = managerRef.current;
      mgr.addKeyframe(skeleton, pinnedJoints, time, recordFilter);

      if (mgr.currentAnimation) {
        animDispatch({
          type: 'SET_DURATION',
          duration: mgr.currentAnimation.duration,
        });
        animDispatch({ type: 'SET_TIME', time: mgr.currentTime });
      }
    },
    [animDispatch],
  );

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  const play = useCallback(
    (index: number): boolean => {
      const mgr = managerRef.current;
      if (mgr.play(index)) {
        animDispatch({ type: 'PLAY' });
        return true;
      }
      return false;
    },
    [animDispatch],
  );

  const pause = useCallback(() => {
    managerRef.current.pause();
    animDispatch({ type: 'PAUSE' });
  }, [animDispatch]);

  const resume = useCallback(() => {
    managerRef.current.resume();
    animDispatch({ type: 'PLAY' });
  }, [animDispatch]);

  const stop = useCallback(() => {
    managerRef.current.stop();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    animDispatch({ type: 'STOP' });
  }, [animDispatch]);

  // ---------------------------------------------------------------------------
  // Timeline control
  // ---------------------------------------------------------------------------

  const seekTo = useCallback(
    (time: number) => {
      managerRef.current.seekTo(time);
      animDispatch({ type: 'SET_TIME', time: managerRef.current.currentTime });
    },
    [animDispatch],
  );

  const setSpeed = useCallback(
    (speed: number) => {
      managerRef.current.playbackSpeed = speed;
      animDispatch({ type: 'SET_SPEED', speed });
    },
    [animDispatch],
  );

  const setLoop = useCallback(
    (loop: boolean) => {
      managerRef.current.loop = loop;
      animDispatch({ type: 'SET_LOOP', loop });
    },
    [animDispatch],
  );

  // ---------------------------------------------------------------------------
  // Library management pass-throughs
  // ---------------------------------------------------------------------------

  const remove = useCallback((index: number) => {
    managerRef.current.remove(index);
  }, []);

  const rename = useCallback((index: number, newName: string) => {
    managerRef.current.rename(index, newName);
  }, []);

  const exportJSON = useCallback((): string => {
    return managerRef.current.exportJSON();
  }, []);

  const importJSON = useCallback((str: string): number => {
    return managerRef.current.importJSON(str);
  }, []);

  return {
    manager: managerRef,
    rafRef,
    lastTimeRef,
    // Recording
    startRecording,
    startLayerRecording,
    stopRecording,
    addKeyframe,
    // Playback
    play,
    pause,
    resume,
    stop,
    seekTo,
    setSpeed,
    setLoop,
    // Library
    remove,
    rename,
    exportJSON,
    importJSON,
  };
}
