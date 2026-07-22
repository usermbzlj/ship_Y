/**
 * Simulation Time Director — authoritative wall→sim pacing inside the Worker.
 *
 * Replaces the React setInterval "hope the next tick arrives" model with:
 * - named pause tokens (ui / llm / save / mission-end / …)
 * - owed simulated seconds (no silent tick drops)
 * - requested vs effective time scale (fidelity may clamp)
 * - explicit observation scales including 1× realtime
 */

export const DIRECTOR_SNAPSHOT_VERSION = 1 as const;

/** Curated scales: realtime → minute → half-hour → hour → 2h → 6h → day. */
export const TIME_SCALE_PRESETS = [
  1, 60, 1_800, 3_600, 7_200, 21_600, 86_400,
] as const;

export type TimeScalePreset = (typeof TIME_SCALE_PRESETS)[number];

export const TIME_SCALE_LABELS: Record<TimeScalePreset, string> = {
  1: "1×",
  60: "1m/s",
  1_800: "30m/s",
  3_600: "1h/s",
  7_200: "2h/s",
  21_600: "6h/s",
  86_400: "1D/s",
};

/** Soft cap: how much sim time one heartbeat may attempt before splitting. */
export const MAX_SIM_SECONDS_PER_HEARTBEAT = 86_400;

/** How much unpaid sim debt we retain across heartbeats (avoid unbounded catch-up). */
export const MAX_OWED_SIM_SECONDS = 7 * 86_400;

export type PauseTokenId =
  | "ui"
  | "llm-waiting"
  | "save-barrier"
  | "mission-ended"
  | "arrived"
  | (string & {});

export interface TimeDirectorSnapshot {
  snapshotVersion: typeof DIRECTOR_SNAPSHOT_VERSION;
  timeScale: number;
  pauseTokens: string[];
  owedSimSeconds: number;
  totalWallSecondsAdvanced: number;
  totalSimSecondsAdvanced: number;
  lastEffectiveTimeScale: number;
  fidelityLocked: boolean;
  /** Sim seconds discarded by the MAX_OWED_SIM_SECONDS cap (cumulative). */
  droppedSimSecondsCumulative: number;
}

export interface HeartbeatAdvancePlan {
  /** Wall seconds this heartbeat contributes (already includes debt conversion). */
  wallSecondsToRun: number;
  /** Requested scale before fidelity clamp. */
  requestedTimeScale: number;
  /** Why zero wall may still be intentional. */
  paused: boolean;
  pauseTokens: string[];
  owedSimSecondsBefore: number;
}

export interface HeartbeatAdvanceResult {
  requestedTimeScale: number;
  effectiveTimeScale: number;
  wallSecondsConsumed: number;
  simSecondsAdvanced: number;
  owedSimSeconds: number;
  /** Sim seconds dropped this beat because owed debt exceeded the cap. */
  droppedSimSecondsThisBeat: number;
  fidelityLocked: boolean;
  paused: boolean;
  pauseTokens: string[];
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

export function isTimeScalePreset(value: number): value is TimeScalePreset {
  return (TIME_SCALE_PRESETS as readonly number[]).includes(value);
}

export function nearestTimeScalePreset(value: number): TimeScalePreset {
  assertFiniteNonNegative(value, "timeScale");
  let best: TimeScalePreset = TIME_SCALE_PRESETS[0];
  let bestDistance = Math.abs(value - best);
  for (const preset of TIME_SCALE_PRESETS) {
    const distance = Math.abs(value - preset);
    if (distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best;
}

export class SimulationTimeDirector {
  private timeScaleValue: number;
  private readonly pauseTokensValue = new Set<string>();
  private owedSimSecondsValue = 0;
  private totalWallSecondsAdvancedValue = 0;
  private totalSimSecondsAdvancedValue = 0;
  private lastEffectiveTimeScaleValue: number;
  private fidelityLockedValue = false;
  private droppedSimSecondsCumulativeValue = 0;

  constructor(timeScale = 1_800) {
    this.timeScaleValue = 1;
    this.lastEffectiveTimeScaleValue = 1;
    this.setTimeScale(timeScale);
  }

  get timeScale(): number {
    return this.timeScaleValue;
  }

  get owedSimSeconds(): number {
    return this.owedSimSecondsValue;
  }

  get pauseTokens(): readonly string[] {
    return [...this.pauseTokensValue].sort();
  }

  get isPaused(): boolean {
    return this.pauseTokensValue.size > 0;
  }

  get fidelityLocked(): boolean {
    return this.fidelityLockedValue;
  }

  get lastEffectiveTimeScale(): number {
    return this.lastEffectiveTimeScaleValue;
  }

  get droppedSimSecondsCumulative(): number {
    return this.droppedSimSecondsCumulativeValue;
  }

  setTimeScale(timeScale: number): void {
    assertFiniteNonNegative(timeScale, "timeScale");
    if (timeScale === 0) {
      throw new Error("timeScale must be > 0 (use pause tokens to freeze time)");
    }
    this.timeScaleValue = timeScale;
  }

  acquirePauseToken(token: PauseTokenId): boolean {
    const id = String(token).trim();
    if (!id) throw new Error("pause token must be non-empty");
    if (this.pauseTokensValue.has(id)) return false;
    this.pauseTokensValue.add(id);
    return true;
  }

  releasePauseToken(token: PauseTokenId): boolean {
    return this.pauseTokensValue.delete(String(token));
  }

  clearPauseTokens(except: readonly string[] = []): void {
    const keep = new Set(except);
    for (const token of [...this.pauseTokensValue]) {
      if (!keep.has(token)) this.pauseTokensValue.delete(token);
    }
  }

  /**
   * Convert a wall-clock heartbeat into an advance plan.
   * Unpaid simulated seconds from prior fidelity clamps are folded into the
   * synthetic wall budget so catch-up remains possible within the per-beat cap.
   */
  planHeartbeat(wallSecondsElapsed: number): HeartbeatAdvancePlan {
    assertFiniteNonNegative(wallSecondsElapsed, "wallSecondsElapsed");
    const paused = this.isPaused;
    if (paused) {
      return {
        wallSecondsToRun: 0,
        requestedTimeScale: this.timeScaleValue,
        paused: true,
        pauseTokens: [...this.pauseTokens],
        owedSimSecondsBefore: this.owedSimSecondsValue,
      };
    }

    const freshSim = wallSecondsElapsed * this.timeScaleValue;
    const desiredSim = freshSim + this.owedSimSecondsValue;
    const cappedSim = Math.min(desiredSim, MAX_SIM_SECONDS_PER_HEARTBEAT);
    const wallSecondsToRun = cappedSim / this.timeScaleValue;

    return {
      wallSecondsToRun,
      requestedTimeScale: this.timeScaleValue,
      paused: false,
      pauseTokens: [...this.pauseTokens],
      owedSimSecondsBefore: this.owedSimSecondsValue,
    };
  }

  /**
   * Record what the coupled step actually achieved.
   * Shortfall vs (fresh wall×scale + prior debt) becomes the next owed balance.
   */
  commitHeartbeat(input: {
    wallSecondsElapsed: number;
    wallSecondsRequested: number;
    requestedTimeScale: number;
    effectiveTimeScale: number;
  }): HeartbeatAdvanceResult {
    assertFiniteNonNegative(input.wallSecondsElapsed, "wallSecondsElapsed");
    assertFiniteNonNegative(input.wallSecondsRequested, "wallSecondsRequested");
    assertFiniteNonNegative(input.requestedTimeScale, "requestedTimeScale");
    assertFiniteNonNegative(input.effectiveTimeScale, "effectiveTimeScale");

    if (this.isPaused || input.wallSecondsRequested === 0) {
      this.lastEffectiveTimeScaleValue = 0;
      this.fidelityLockedValue = false;
      return {
        requestedTimeScale: this.timeScaleValue,
        effectiveTimeScale: 0,
        wallSecondsConsumed: 0,
        simSecondsAdvanced: 0,
        owedSimSeconds: this.owedSimSecondsValue,
        droppedSimSecondsThisBeat: 0,
        fidelityLocked: false,
        paused: this.isPaused,
        pauseTokens: [...this.pauseTokens],
      };
    }

    const freshSim = input.wallSecondsElapsed * input.requestedTimeScale;
    const desiredSim = freshSim + this.owedSimSecondsValue;
    const advancedSim =
      input.wallSecondsRequested * input.effectiveTimeScale;
    const rawOwed = Math.max(0, desiredSim - advancedSim);
    const droppedSimSecondsThisBeat = Math.max(
      0,
      rawOwed - MAX_OWED_SIM_SECONDS,
    );
    const owed = Math.min(MAX_OWED_SIM_SECONDS, rawOwed);

    this.owedSimSecondsValue = owed;
    this.droppedSimSecondsCumulativeValue += droppedSimSecondsThisBeat;
    this.totalWallSecondsAdvancedValue += input.wallSecondsElapsed;
    this.totalSimSecondsAdvancedValue += advancedSim;
    this.lastEffectiveTimeScaleValue = input.effectiveTimeScale;
    this.fidelityLockedValue =
      input.effectiveTimeScale + 1e-9 < input.requestedTimeScale;

    return {
      requestedTimeScale: input.requestedTimeScale,
      effectiveTimeScale: input.effectiveTimeScale,
      wallSecondsConsumed: input.wallSecondsRequested,
      simSecondsAdvanced: advancedSim,
      owedSimSeconds: this.owedSimSecondsValue,
      droppedSimSecondsThisBeat,
      fidelityLocked: this.fidelityLockedValue,
      paused: false,
      pauseTokens: [...this.pauseTokens],
    };
  }

  /** Drop owed debt (e.g. after mission end or explicit scrub). */
  clearOwedSimSeconds(): void {
    this.owedSimSecondsValue = 0;
  }

  snapshot(): TimeDirectorSnapshot {
    return {
      snapshotVersion: DIRECTOR_SNAPSHOT_VERSION,
      timeScale: this.timeScaleValue,
      pauseTokens: [...this.pauseTokens],
      owedSimSeconds: this.owedSimSecondsValue,
      totalWallSecondsAdvanced: this.totalWallSecondsAdvancedValue,
      totalSimSecondsAdvanced: this.totalSimSecondsAdvancedValue,
      lastEffectiveTimeScale: this.lastEffectiveTimeScaleValue,
      fidelityLocked: this.fidelityLockedValue,
      droppedSimSecondsCumulative: this.droppedSimSecondsCumulativeValue,
    };
  }

  static restore(snapshot: TimeDirectorSnapshot): SimulationTimeDirector {
    if (snapshot.snapshotVersion !== DIRECTOR_SNAPSHOT_VERSION) {
      throw new Error(
        `unsupported time director snapshot version ${String(snapshot.snapshotVersion)}`,
      );
    }
    assertFiniteNonNegative(snapshot.timeScale, "director.timeScale");
    assertFiniteNonNegative(snapshot.owedSimSeconds, "director.owedSimSeconds");
    assertFiniteNonNegative(
      snapshot.totalWallSecondsAdvanced,
      "director.totalWallSecondsAdvanced",
    );
    assertFiniteNonNegative(
      snapshot.totalSimSecondsAdvanced,
      "director.totalSimSecondsAdvanced",
    );
    assertFiniteNonNegative(
      snapshot.lastEffectiveTimeScale,
      "director.lastEffectiveTimeScale",
    );
    assertFiniteNonNegative(
      snapshot.droppedSimSecondsCumulative,
      "director.droppedSimSecondsCumulative",
    );
    if (!Array.isArray(snapshot.pauseTokens)) {
      throw new Error("director.pauseTokens must be an array");
    }

    const director = new SimulationTimeDirector(snapshot.timeScale);
    for (const token of snapshot.pauseTokens) {
      director.acquirePauseToken(String(token));
    }
    director.owedSimSecondsValue = snapshot.owedSimSeconds;
    director.totalWallSecondsAdvancedValue = snapshot.totalWallSecondsAdvanced;
    director.totalSimSecondsAdvancedValue = snapshot.totalSimSecondsAdvanced;
    director.lastEffectiveTimeScaleValue = snapshot.lastEffectiveTimeScale;
    director.fidelityLockedValue = Boolean(snapshot.fidelityLocked);
    director.droppedSimSecondsCumulativeValue =
      snapshot.droppedSimSecondsCumulative;
    return director;
  }
}
