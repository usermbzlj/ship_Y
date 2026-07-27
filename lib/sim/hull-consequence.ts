/**
 * Lightweight hull-threat authority (Passengers-style consequences).
 *
 * Compartment HullBreach remains the orifice model. This module tracks
 * unrepaired age, derives hullIntegrity, schedules ring-local cascade faults,
 * and informs jump / thrust interlocks. It is not a structural FEM.
 */

import type { HullBreach, ZoneId } from "./compartments";

export const HULL_CONSEQUENCE_SNAPSHOT_VERSION = 1 as const;

/** Area that drives integrity from 1 → 0 when fully "open". */
export const HULL_INTEGRITY_REFERENCE_AREA_M2 = 5e-2;

/** Jump interlock rejects when integrity falls below this. */
export const HULL_JUMP_INTEGRITY_MINIMUM = 0.92;

export const CASCADE_STAGE1_SECONDS = 30 * 60;
export const CASCADE_STAGE2_SECONDS = 2 * 3_600;
export const CASCADE_STAGE3_SECONDS = 6 * 3_600;

export type HullRingId = "a" | "b";
export type HullCascadeStage = 0 | 1 | 2 | 3;

export interface HullConsequenceEvent {
  id: string;
  zoneId: ZoneId;
  openedAtMicroseconds: number;
  initialAreaSquareMeters: number;
  lastGrownAtMicroseconds: number;
  cascadeStage: HullCascadeStage;
  appliedFaultKeys: string[];
}

export interface HullConsequenceSnapshot {
  snapshotVersion: typeof HULL_CONSEQUENCE_SNAPSHOT_VERSION;
  events: HullConsequenceEvent[];
}

export type HullCascadeAction =
  | {
      type: "grow-breach";
      breachId: string;
      areaSquareMeters: number;
      faultKey: string;
    }
  | {
      type: "fault-ahu";
      ring: HullRingId;
      condition: "degraded" | "stuck-off";
      faultKey: string;
    }
  | {
      type: "fault-pump";
      ring: HullRingId;
      condition: "degraded" | "stuck-off";
      faultKey: string;
    }
  | {
      type: "fault-bearing";
      ring: HullRingId;
      faultKey: string;
    }
  | {
      type: "trip-hibernation";
      ring: HullRingId;
      faultKey: string;
    };

export interface HullConsequenceTelemetry {
  hullIntegrity: number;
  activeBreachCount: number;
  totalBreachAreaSquareMeters: number;
  jumpBlocked: boolean;
  jumpBlockReason: string | null;
  thrustPerformanceByRing: Record<HullRingId, number>;
  events: Array<{
    id: string;
    zoneId: ZoneId;
    ring: HullRingId;
    cascadeStage: HullCascadeStage;
    unrepairedSeconds: number;
    nextCascadeSeconds: number | null;
    appliedFaultKeys: string[];
  }>;
}

export function ringIdForZone(zoneId: ZoneId): HullRingId {
  return zoneId.startsWith("A-") ? "a" : "b";
}

export function totalBreachAreaSquareMeters(
  breaches: readonly HullBreach[],
): number {
  return breaches.reduce(
    (total, breach) => total + Math.max(0, breach.areaSquareMeters),
    0,
  );
}

export function computeHullIntegrity(
  breaches: readonly HullBreach[],
): number {
  const area = totalBreachAreaSquareMeters(breaches);
  return Math.max(
    0,
    Math.min(1, 1 - area / HULL_INTEGRITY_REFERENCE_AREA_M2),
  );
}

export function jumpBlockedByHull(
  breaches: readonly HullBreach[],
): { blocked: boolean; reason: string | null } {
  if (breaches.length > 0) {
    return {
      blocked: true,
      reason: `活动船体破口 ${breaches.length} 处，壳体威胁联锁禁止跃迁`,
    };
  }
  const integrity = computeHullIntegrity(breaches);
  if (integrity + 1e-12 < HULL_JUMP_INTEGRITY_MINIMUM) {
    return {
      blocked: true,
      reason: `壳体完整度 ${(integrity * 100).toFixed(1)}% 低于跃迁联锁下限 ${(HULL_JUMP_INTEGRITY_MINIMUM * 100).toFixed(0)}%`,
    };
  }
  return { blocked: false, reason: null };
}

/**
 * Ring thrust performance fraction from local breach area.
 * Intact → 1; small tear → ~0.85; large / multi → down to 0.5.
 */
export function thrustPerformanceForRing(
  breaches: readonly HullBreach[],
  ring: HullRingId,
): number {
  const area = breaches
    .filter((breach) => ringIdForZone(breach.zoneId) === ring)
    .reduce((total, breach) => total + Math.max(0, breach.areaSquareMeters), 0);
  if (area <= 0) return 1;
  if (area < 5e-5) return 0.85;
  if (area < 2e-4) return 0.7;
  return 0.5;
}

function nextCascadeDeadlineSeconds(stage: HullCascadeStage): number | null {
  if (stage < 1) return CASCADE_STAGE1_SECONDS;
  if (stage < 2) return CASCADE_STAGE2_SECONDS;
  if (stage < 3) return CASCADE_STAGE3_SECONDS;
  return null;
}

function cloneEvent(event: HullConsequenceEvent): HullConsequenceEvent {
  return {
    ...event,
    appliedFaultKeys: [...event.appliedFaultKeys],
  };
}

export class HullConsequenceNetwork {
  private events: HullConsequenceEvent[] = [];

  static create(): HullConsequenceNetwork {
    return new HullConsequenceNetwork();
  }

  register(input: {
    breachId: string;
    zoneId: ZoneId;
    areaSquareMeters: number;
    nowMicroseconds: number;
  }): HullConsequenceEvent {
    if (!Number.isFinite(input.areaSquareMeters) || input.areaSquareMeters < 0) {
      throw new RangeError("breach area must be a finite non-negative number");
    }
    if (
      !Number.isSafeInteger(input.nowMicroseconds) ||
      input.nowMicroseconds < 0
    ) {
      throw new RangeError("openedAt must be a safe non-negative integer");
    }
    const existing = this.events.find((event) => event.id === input.breachId);
    if (existing) {
      return cloneEvent(existing);
    }
    const event: HullConsequenceEvent = {
      id: input.breachId,
      zoneId: input.zoneId,
      openedAtMicroseconds: input.nowMicroseconds,
      initialAreaSquareMeters: input.areaSquareMeters,
      lastGrownAtMicroseconds: input.nowMicroseconds,
      cascadeStage: 0,
      appliedFaultKeys: [],
    };
    this.events.push(event);
    this.events.sort((left, right) => left.id.localeCompare(right.id));
    return cloneEvent(event);
  }

  clear(breachId: string): boolean {
    const before = this.events.length;
    this.events = this.events.filter((event) => event.id !== breachId);
    return this.events.length < before;
  }

  /** Drop registry rows whose breach no longer exists. */
  reconcile(activeBreachIds: ReadonlySet<string>): string[] {
    const removed: string[] = [];
    const next: HullConsequenceEvent[] = [];
    for (const event of this.events) {
      if (activeBreachIds.has(event.id)) {
        next.push(event);
      } else {
        removed.push(event.id);
      }
    }
    this.events = next;
    return removed;
  }

  listEvents(): HullConsequenceEvent[] {
    return this.events.map(cloneEvent);
  }

  /**
   * Advance cascade stages for unrepaired breaches. Returns idempotent actions
   * the worker must apply through domain APIs.
   */
  advance(input: {
    nowMicroseconds: number;
    breaches: readonly HullBreach[];
  }): HullCascadeAction[] {
    const { nowMicroseconds, breaches } = input;
    const breachById = new Map(breaches.map((breach) => [breach.id, breach]));
    this.reconcile(new Set(breachById.keys()));

    const actions: HullCascadeAction[] = [];
    for (const event of this.events) {
      const breach = breachById.get(event.id);
      if (!breach) continue;
      const unrepairedSeconds =
        (nowMicroseconds - event.openedAtMicroseconds) / 1_000_000;
      const ring = ringIdForZone(event.zoneId);

      if (event.cascadeStage < 1 && unrepairedSeconds >= CASCADE_STAGE1_SECONDS) {
        const growKey = "grow-x1.5";
        if (!event.appliedFaultKeys.includes(growKey)) {
          const grownArea = breach.areaSquareMeters * 1.5;
          actions.push({
            type: "grow-breach",
            breachId: event.id,
            areaSquareMeters: grownArea,
            faultKey: growKey,
          });
          event.appliedFaultKeys.push(growKey);
          event.lastGrownAtMicroseconds = nowMicroseconds;
        }
        const ahuKey = `ahu-${ring}`;
        if (!event.appliedFaultKeys.includes(ahuKey)) {
          actions.push({
            type: "fault-ahu",
            ring,
            condition: "stuck-off",
            faultKey: ahuKey,
          });
          event.appliedFaultKeys.push(ahuKey);
        }
        event.cascadeStage = 1;
      }

      if (event.cascadeStage < 2 && unrepairedSeconds >= CASCADE_STAGE2_SECONDS) {
        const pumpKey = `pump-${ring}`;
        if (!event.appliedFaultKeys.includes(pumpKey)) {
          actions.push({
            type: "fault-pump",
            ring,
            condition: "stuck-off",
            faultKey: pumpKey,
          });
          event.appliedFaultKeys.push(pumpKey);
        }
        event.cascadeStage = 2;
      }

      if (event.cascadeStage < 3 && unrepairedSeconds >= CASCADE_STAGE3_SECONDS) {
        const bearingKey = `bearing-${ring}`;
        if (!event.appliedFaultKeys.includes(bearingKey)) {
          actions.push({
            type: "fault-bearing",
            ring,
            faultKey: bearingKey,
          });
          event.appliedFaultKeys.push(bearingKey);
        }
        const hibernationKey = `hibernation-${ring}`;
        if (!event.appliedFaultKeys.includes(hibernationKey)) {
          actions.push({
            type: "trip-hibernation",
            ring,
            faultKey: hibernationKey,
          });
          event.appliedFaultKeys.push(hibernationKey);
        }
        event.cascadeStage = 3;
      }
    }
    return actions;
  }

  getTelemetry(
    nowMicroseconds: number,
    breaches: readonly HullBreach[],
  ): HullConsequenceTelemetry {
    const integrity = computeHullIntegrity(breaches);
    const jump = jumpBlockedByHull(breaches);
    return {
      hullIntegrity: integrity,
      activeBreachCount: breaches.length,
      totalBreachAreaSquareMeters: totalBreachAreaSquareMeters(breaches),
      jumpBlocked: jump.blocked,
      jumpBlockReason: jump.reason,
      thrustPerformanceByRing: {
        a: thrustPerformanceForRing(breaches, "a"),
        b: thrustPerformanceForRing(breaches, "b"),
      },
      events: this.events.map((event) => {
        const unrepairedSeconds = Math.max(
          0,
          (nowMicroseconds - event.openedAtMicroseconds) / 1_000_000,
        );
        const deadline = nextCascadeDeadlineSeconds(event.cascadeStage);
        return {
          id: event.id,
          zoneId: event.zoneId,
          ring: ringIdForZone(event.zoneId),
          cascadeStage: event.cascadeStage,
          unrepairedSeconds,
          nextCascadeSeconds:
            deadline === null
              ? null
              : Math.max(0, deadline - unrepairedSeconds),
          appliedFaultKeys: [...event.appliedFaultKeys],
        };
      }),
    };
  }

  snapshot(): HullConsequenceSnapshot {
    return {
      snapshotVersion: HULL_CONSEQUENCE_SNAPSHOT_VERSION,
      events: this.events.map(cloneEvent),
    };
  }

  static restore(snapshot: HullConsequenceSnapshot): HullConsequenceNetwork {
    if (snapshot.snapshotVersion !== HULL_CONSEQUENCE_SNAPSHOT_VERSION) {
      throw new Error(
        `unsupported hull-consequence snapshot version ${String(snapshot.snapshotVersion)}`,
      );
    }
    if (!Array.isArray(snapshot.events)) {
      throw new TypeError("hull-consequence events must be an array");
    }
    const network = new HullConsequenceNetwork();
    for (const raw of snapshot.events) {
      if (
        typeof raw?.id !== "string" ||
        typeof raw.zoneId !== "string" ||
        !Number.isFinite(raw.openedAtMicroseconds) ||
        !Number.isFinite(raw.initialAreaSquareMeters) ||
        !Number.isFinite(raw.lastGrownAtMicroseconds) ||
        ![0, 1, 2, 3].includes(raw.cascadeStage) ||
        !Array.isArray(raw.appliedFaultKeys)
      ) {
        throw new TypeError("hull-consequence event is malformed");
      }
      network.events.push({
        id: raw.id,
        zoneId: raw.zoneId as ZoneId,
        openedAtMicroseconds: Math.trunc(raw.openedAtMicroseconds),
        initialAreaSquareMeters: raw.initialAreaSquareMeters,
        lastGrownAtMicroseconds: Math.trunc(raw.lastGrownAtMicroseconds),
        cascadeStage: raw.cascadeStage as HullCascadeStage,
        appliedFaultKeys: raw.appliedFaultKeys.map(String),
      });
    }
    network.events.sort((left, right) => left.id.localeCompare(right.id));
    return network;
  }
}
