import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCausalInterventionRequest,
  buildForceOverrideRequest,
} from "../../lib/sim/causal-event-catalog.ts";
import { createBaselineShipState } from "../../lib/sim/index.ts";

test("micrometeoroid request snapshot fields", () => {
  const request = buildCausalInterventionRequest("micrometeoroid");
  assert.equal(request.actor, "player:god-mode");
  assert.equal(request.reason, "微流星体撞击外壳并形成等效微破口");
  assert.deepEqual(request.metadata, {
    mode: "causal-event",
    eventType: "micrometeoroid",
    sourceKnownToAi: false,
    targetZoneId: "A-18",
  });
  assert.deepEqual(request.operations, [
    {
      operation: "add",
      path: "atmosphere.leakAreaSquareMeters",
      value: 0.000045,
    },
  ]);
  assert.equal(request.declaredBalance.massKg, -0.34);
  assert.equal(request.declaredBalance.energyJ, 280_000_000);
  assert.deepEqual(request.declaredBalance.linearMomentumKgMPerSecond, [
    1_180, -240, 90,
  ]);
  assert.deepEqual(request.declaredBalance.angularMomentumKgM2PerSecond, [
    0, 28_000, -74_000,
  ]);
});

test("unknown causal event type throws", () => {
  assert.throws(
    () => buildCausalInterventionRequest("not-a-real-event"),
    /unsupported causal event type: not-a-real-event/,
  );
});

test("force override oxygen mass delta", () => {
  const engineState = createBaselineShipState();
  const currentOxygen = engineState.atmosphere.gasesKg.oxygen;
  const targetOxygen = currentOxygen + 500;
  const request = buildForceOverrideRequest(
    {
      id: "oxygen-mass",
      label: "居住区氧气总质量",
      path: "atmosphere.gasesKg.oxygen",
      unit: "kg",
    },
    targetOxygen,
    engineState,
  );
  assert.equal(request.declaredBalance.massKg, 500);
  assert.equal(
    request.declaredBalance.energyJ,
    500 * 1_005 * engineState.thermal.habitatTemperatureK,
  );
  assert.deepEqual(request.operations, [
    {
      operation: "set",
      path: "atmosphere.gasesKg.oxygen",
      value: targetOxygen,
    },
  ]);
  assert.equal(request.metadata?.fieldId, "oxygen-mass");
});
