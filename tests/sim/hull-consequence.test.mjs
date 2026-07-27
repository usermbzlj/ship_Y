import assert from "node:assert/strict";
import test from "node:test";

import {
  CASCADE_STAGE1_SECONDS,
  CASCADE_STAGE2_SECONDS,
  CASCADE_STAGE3_SECONDS,
  HullConsequenceNetwork,
  computeHullIntegrity,
  jumpBlockedByHull,
  thrustPerformanceForRing,
} from "../../lib/sim/hull-consequence.ts";

const SAMPLE_BREACH = {
  id: "breach:test-1",
  zoneId: "A-05",
  areaSquareMeters: 2.5e-5,
  dischargeCoefficient: 0.72,
};

test("hull integrity falls with breach area and blocks jump while open", () => {
  assert.equal(computeHullIntegrity([]), 1);
  const integrity = computeHullIntegrity([SAMPLE_BREACH]);
  assert.ok(integrity < 1);
  assert.ok(integrity > 0.9);
  const blocked = jumpBlockedByHull([SAMPLE_BREACH]);
  assert.equal(blocked.blocked, true);
  assert.match(blocked.reason ?? "", /活动船体破口/);
  assert.equal(jumpBlockedByHull([]).blocked, false);
});

test("ring thrust derates from local breach area only", () => {
  assert.equal(thrustPerformanceForRing([], "a"), 1);
  assert.equal(thrustPerformanceForRing([SAMPLE_BREACH], "a"), 0.85);
  assert.equal(thrustPerformanceForRing([SAMPLE_BREACH], "b"), 1);
  const large = {
    ...SAMPLE_BREACH,
    id: "breach:large",
    areaSquareMeters: 3e-4,
  };
  assert.equal(thrustPerformanceForRing([large], "a"), 0.5);
});

test("register / clear / reconcile and cascade stages are idempotent", () => {
  const network = HullConsequenceNetwork.create();
  network.register({
    breachId: SAMPLE_BREACH.id,
    zoneId: SAMPLE_BREACH.zoneId,
    areaSquareMeters: SAMPLE_BREACH.areaSquareMeters,
    nowMicroseconds: 0,
  });
  assert.equal(network.listEvents().length, 1);
  network.register({
    breachId: SAMPLE_BREACH.id,
    zoneId: SAMPLE_BREACH.zoneId,
    areaSquareMeters: SAMPLE_BREACH.areaSquareMeters,
    nowMicroseconds: 1_000_000,
  });
  assert.equal(network.listEvents()[0].openedAtMicroseconds, 0);

  const stage1 = network.advance({
    nowMicroseconds: CASCADE_STAGE1_SECONDS * 1_000_000,
    breaches: [SAMPLE_BREACH],
  });
  assert.ok(stage1.some((action) => action.type === "grow-breach"));
  assert.ok(stage1.some((action) => action.type === "fault-ahu"));
  const stage1Again = network.advance({
    nowMicroseconds: CASCADE_STAGE1_SECONDS * 1_000_000,
    breaches: [
      {
        ...SAMPLE_BREACH,
        areaSquareMeters: SAMPLE_BREACH.areaSquareMeters * 1.5,
      },
    ],
  });
  assert.equal(stage1Again.length, 0);

  const stage2 = network.advance({
    nowMicroseconds: CASCADE_STAGE2_SECONDS * 1_000_000,
    breaches: [
      {
        ...SAMPLE_BREACH,
        areaSquareMeters: SAMPLE_BREACH.areaSquareMeters * 1.5,
      },
    ],
  });
  assert.ok(stage2.some((action) => action.type === "fault-pump"));

  const stage3 = network.advance({
    nowMicroseconds: CASCADE_STAGE3_SECONDS * 1_000_000,
    breaches: [
      {
        ...SAMPLE_BREACH,
        areaSquareMeters: SAMPLE_BREACH.areaSquareMeters * 1.5,
      },
    ],
  });
  assert.ok(stage3.some((action) => action.type === "fault-bearing"));
  assert.ok(stage3.some((action) => action.type === "trip-hibernation"));

  assert.equal(network.clear(SAMPLE_BREACH.id), true);
  assert.equal(network.listEvents().length, 0);
});

test("snapshot restore preserves cascade progress", () => {
  const network = HullConsequenceNetwork.create();
  network.register({
    breachId: SAMPLE_BREACH.id,
    zoneId: SAMPLE_BREACH.zoneId,
    areaSquareMeters: SAMPLE_BREACH.areaSquareMeters,
    nowMicroseconds: 0,
  });
  network.advance({
    nowMicroseconds: CASCADE_STAGE1_SECONDS * 1_000_000,
    breaches: [SAMPLE_BREACH],
  });
  const restored = HullConsequenceNetwork.restore(network.snapshot());
  assert.equal(restored.listEvents()[0].cascadeStage, 1);
  const telemetry = restored.getTelemetry(
    CASCADE_STAGE1_SECONDS * 1_000_000,
    [SAMPLE_BREACH],
  );
  assert.equal(telemetry.jumpBlocked, true);
  assert.ok(telemetry.events[0].appliedFaultKeys.includes("ahu-a"));
});
