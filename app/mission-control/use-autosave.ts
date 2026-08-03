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
}: UseAutosaveParams): void {
  const lastAutosaveSimSecondsRef = useRef<number | null>(null);
  const startSavedRef = useRef(false);
  const arrivalSavedRef = useRef(false);
  const onRequestRef = useRef(onRequestAutosave);
  const isBlockedRef = useRef(isBlocked);
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
