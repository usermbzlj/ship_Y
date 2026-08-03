import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCaptainWatchTriggerFallback,
  resolveCaptainDecisionTrigger,
} from "../../lib/llm/captain-decision-trigger.ts";

function baseInput(overrides = {}) {
  return {
    missionStartAlreadyInvoked: true,
    simulationSeconds: 3_600,
    nextCaptainRoutineAtSimulationSeconds: 10_000,
    routineSeconds: 3_600,
    urgentWindowSeconds: 900,
    hullConsequence: null,
    compartments: null,
    cooling: null,
    controllerRecord: null,
    observedPowerAlarm: false,
    unattendedMaintenanceFaults: [],
    requiredChargePerJumpKWh: 1_000_000,
    totalDistanceLightYears: 4,
    completedDistanceLightYears: 0,
    ...overrides,
  };
}

test("priority: mission-start beats routine and hull-threat", () => {
  const result = resolveCaptainDecisionTrigger(
    baseInput({
      missionStartAlreadyInvoked: false,
      nextCaptainRoutineAtSimulationSeconds: 3_600,
      hullConsequence: {
        hullIntegrity: 0.5,
        activeBreachCount: 2,
        totalBreachAreaSquareMeters: 1e-4,
        jumpBlocked: true,
        jumpBlockReason: "破口联锁",
        thrustPerformanceByRing: { a: 0.5, b: 1 },
        events: [],
      },
    }),
  );
  assert.equal(result.triggerKey, "mission-start");
  assert.match(result.triggerReason, /最高指令/);
});

test("priority: routine beats hull-threat when mission-start already invoked", () => {
  const result = resolveCaptainDecisionTrigger(
    baseInput({
      simulationSeconds: 3_600,
      nextCaptainRoutineAtSimulationSeconds: 3_600,
      hullConsequence: {
        hullIntegrity: 0.5,
        activeBreachCount: 2,
        totalBreachAreaSquareMeters: 1e-4,
        jumpBlocked: true,
        jumpBlockReason: "破口联锁",
        thrustPerformanceByRing: { a: 0.5, b: 1 },
        events: [],
      },
    }),
  );
  assert.equal(result.triggerKey, "routine:3600");
  assert.match(result.triggerReason, /例行系统信息周期/);
});

test("priority: hull-threat when mission-start and routine are not due", () => {
  const result = resolveCaptainDecisionTrigger(
    baseInput({
      simulationSeconds: 3_600,
      nextCaptainRoutineAtSimulationSeconds: 10_000,
      hullConsequence: {
        hullIntegrity: 0.5,
        activeBreachCount: 3,
        totalBreachAreaSquareMeters: 1e-4,
        jumpBlocked: true,
        jumpBlockReason: "壳体威胁测试",
        thrustPerformanceByRing: { a: 0.5, b: 1 },
        events: [],
      },
    }),
  );
  assert.equal(result.triggerKey, "hull-threat:3:4");
  assert.equal(result.triggerReason, "壳体威胁测试");
});

test("watch fallback fills empty trigger", () => {
  const filled = applyCaptainWatchTriggerFallback(
    { triggerKey: "", triggerReason: "" },
    [
      {
        watchId: "w-2",
        metric: "coolantBusTemperatureK",
        label: "冷却母线温度",
        comparator: "above",
        threshold: 350,
        observedValue: 360,
        note: "偏热",
      },
      {
        watchId: "w-1",
        metric: "hullIntegrity",
        label: "壳体完整度",
        comparator: "below",
        threshold: 0.9,
        observedValue: 0.8,
        note: "破损",
      },
    ],
  );
  assert.equal(filled.triggerKey, "watch:w-1,w-2");
  assert.match(filled.triggerReason, /舰长自设观察哨触发/);
  assert.match(filled.triggerReason, /冷却母线温度高于350/);
  assert.match(filled.triggerReason, /壳体完整度低于0.9/);
});

test("watch fallback leaves existing trigger untouched", () => {
  const kept = applyCaptainWatchTriggerFallback(
    { triggerKey: "mission-start", triggerReason: "首段" },
    [
      {
        watchId: "w-1",
        metric: "hullIntegrity",
        label: "壳体完整度",
        comparator: "below",
        threshold: 0.9,
        observedValue: 0.8,
        note: "破损",
      },
    ],
  );
  assert.equal(kept.triggerKey, "mission-start");
  assert.equal(kept.triggerReason, "首段");
});
