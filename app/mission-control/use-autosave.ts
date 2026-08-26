"use client";

import { useEffect, useRef } from "react";

/** Simulation-time interval between periodic autosaves (45 mission-minutes). */
export const AUTOSAVE_SIM_INTERVAL_SECONDS = 45 * 60;

export type UseAutosaveParams = {
  missionStarted: boolean;
  missionEnded: boolean;
  /** Worker/engine ready enough to take a consistency snapshot. */
  engineReady: boolean;
  simulationSeconds: number;
  /**
   * True while llm-waiting, mid save-barrier / pending snapshot, or other
   * moments when writing would race the consistency path.
   * Invoked at trigger time (may read refs).
   */
  isBlocked: () => boolean;
  /** Fire a quiet autosave into the rotating auto-* ring. */
  onRequestAutosave: () => void;
  /**
   * Increments whenever the active world is replaced — a new mission start, a
   * god intervention epoch bump, or a load. A runtime load keeps missionStarted
   * true, so this is what tells the hook to forget the previous world's autosave
   * bookkeeping (otherwise loading an earlier clock suppresses periodic saves,
   * and loading a later clock can fire a spurious save of the just-restored world).
   */
  worldGeneration: number;
};

/**
 * Periodic + light milestone autosaves while a mission is running.
 * Does not own the save barrier — callers must reuse the manual snapshot path.
 */
export function useAutosave({
  missionStarted,
  missionEnded,
  engineReady,
  simulationSeconds,
  isBlocked,
  onRequestAutosave,
  worldGeneration,
}: UseAutosaveParams): void {
  const lastAutosaveSimSecondsRef = useRef<number | null>(null);
  const startSavedRef = useRef(false);
  const arrivalSavedRef = useRef(false);
  const onRequestRef = useRef(onRequestAutosave);
  const isBlockedRef = useRef(isBlocked);
  const lastWorldGenerationRef = useRef(worldGeneration);
  onRequestRef.current = onRequestAutosave;
  isBlockedRef.current = isBlocked;

  // Reset bookkeeping when leaving a mission world.
  useEffect(() => {
    if (!missionStarted) {
      lastAutosaveSimSecondsRef.current = null;
      startSavedRef.current = false;
      arrivalSavedRef.current = false;
    }
  }, [missionStarted]);

  // Reset bookkeeping when the world is replaced in place (e.g. a load that
  // keeps missionStarted true), so the new clock is not compared against the
  // previous world's autosave timestamps.
  useEffect(() => {
    if (lastWorldGenerationRef.current !== worldGeneration) {
      lastWorldGenerationRef.current = worldGeneration;
      lastAutosaveSimSecondsRef.current = null;
      startSavedRef.current = false;
      arrivalSavedRef.current = false;
    }
  }, [worldGeneration]);

  // Light trigger: first time engine is ready after mission start.
  useEffect(() => {
    if (
      !missionStarted ||
      missionEnded ||
      !engineReady ||
      isBlockedRef.current() ||
      startSavedRef.current
    ) {
      return;
    }
    startSavedRef.current = true;
    lastAutosaveSimSecondsRef.current = simulationSeconds;
    onRequestRef.current();
  }, [missionStarted, missionEnded, engineReady, simulationSeconds]);

  // Periodic sim-time autosave.
  useEffect(() => {
    if (
      !missionStarted ||
      missionEnded ||
      !engineReady ||
      isBlockedRef.current() ||
      !startSavedRef.current
    ) {
      return;
    }
    const last = lastAutosaveSimSecondsRef.current;
    if (last == null) {
      lastAutosaveSimSecondsRef.current = simulationSeconds;
      return;
    }
    if (simulationSeconds - last < AUTOSAVE_SIM_INTERVAL_SECONDS) {
      return;
    }
    lastAutosaveSimSecondsRef.current = simulationSeconds;
    onRequestRef.current();
  }, [missionStarted, missionEnded, engineReady, simulationSeconds]);

  // Light trigger: safe arrival / mission end.
  useEffect(() => {
    if (
      !missionStarted ||
      !missionEnded ||
      !engineReady ||
      isBlockedRef.current() ||
      arrivalSavedRef.current
    ) {
      return;
    }
    arrivalSavedRef.current = true;
    lastAutosaveSimSecondsRef.current = simulationSeconds;
    onRequestRef.current();
  }, [missionStarted, missionEnded, engineReady, simulationSeconds]);
}
