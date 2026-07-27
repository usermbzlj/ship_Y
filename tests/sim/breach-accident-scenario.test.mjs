/**
 * End-to-end micrometeoroid accident scenario (in-process worker harness).
 *
 * Path: god intervene micrometeoroid → A-05 breach + vent → isolate-pressure-zone
 * (life-support) → neighbor connections sealed / further ship-wide venting reduced
 * (stable containment). Fixed seed for determinism.
 */

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

const emitted = [];
globalThis.postMessage = (event) => {
  emitted.push(event);
};
await import("../../lib/sim/worker.ts");

const SEED = "breach-accident-scenario-v1";
const ZONE_ID = "A-05";
const NEIGHBOR_ZONE_IDS = ["A-04", "A-06"];
/** Short sim slice — enough for orifice venting, under ~30s wall. */
const STEP_SCALE = 60;

function dispatch(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  assert.equal(emitted.length, 1);
  return emitted[0];
}

function initialize(requestId) {
  const ready = dispatch({
    type: "initialize",
    requestId,
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: SEED,
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: STEP_SCALE,
    },
  });
  assert.equal(ready.type, "ready", ready.message);
  const released = dispatch({
    type: "set-time-control",
    requestId: `${requestId}:release-ui`,
    releasePauseTokens: ["ui"],
  });
  assert.equal(released.type, "ready", released.message);
  assert.equal(released.payload.timeControl.paused, false);
  return released;
}

function zoneTelemetry(payload, zoneId) {
  const zone = payload.compartments.zones.find((entry) => entry.zoneId === zoneId);
  assert.ok(zone, `missing zone telemetry ${zoneId}`);
  return zone;
}

function snapshot(requestId) {
  const response = dispatch({ type: "snapshot", requestId });
  assert.equal(response.type, "snapshot", response.message);
  return response.payload.snapshot;
}

/** Truth gas inventory (kg) from compartment authority snapshot. */
function zoneGasMassKg(runtimeSnapshot, zoneId) {
  const zone = runtimeSnapshot.compartments.zones.find(
    (entry) => entry.id === zoneId,
  );
  assert.ok(zone, `missing truth zone ${zoneId}`);
  return Object.values(zone.gasesKg).reduce((total, mass) => total + mass, 0);
}

function step(requestId, timeScale = STEP_SCALE) {
  const response = dispatch({
    type: "step",
    requestId,
    realSeconds: 1,
    timeScale,
  });
  assert.equal(response.type, "stepped", response.message);
  assert.ok(
    response.payload.elapsedSeconds >= timeScale,
    `expected at least ${timeScale}s sim time, got ${response.payload.elapsedSeconds}`,
  );
  return response.payload;
}

test("微流星体破口事故：撞击 → 泄压 → 隔离封舱遏制", () => {
  const wallStart = performance.now();

  const ready = initialize("init-breach-accident");
  assert.equal(zoneTelemetry(ready.payload, ZONE_ID).hasBreach, false);
  const baselineVentedKg = ready.payload.compartments.totalVentedGasKg;
  const massBeforeBreach = zoneGasMassKg(
    snapshot("pre-breach-truth"),
    ZONE_ID,
  );

  // 1) God intervene micrometeoroid on living zone A-05
  const intervention = dispatch({
    type: "intervene",
    requestId: "micrometeoroid-a-05",
    request: {
      actor: "player:god-mode",
      reason: "breach-accident-scenario micrometeoroid",
      operations: [
        {
          operation: "add",
          path: "atmosphere.leakAreaSquareMeters",
          value: 0.000045,
        },
      ],
      declaredBalance: {
        massKg: -0.025,
        energyJ: 25_000,
        linearMomentumKgMPerSecond: [12, -2.4, 0.9],
        angularMomentumKgM2PerSecond: [0, 280, -740],
        note: "test ~φ7.6 mm Whipple-caught grain puncture balance",
      },
      metadata: {
        mode: "causal-event",
        eventType: "micrometeoroid",
        targetZoneId: ZONE_ID,
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(intervention.type, "intervention", intervention.message);
  assert.ok(
    intervention.payload.compartments.activeBreaches >= 1,
    "listBreaches / activeBreaches must report the hull puncture",
  );
  assert.equal(
    zoneTelemetry(intervention.payload, ZONE_ID).hasBreach,
    true,
    "A-05 telemetry hasBreach must be true after micrometeoroid",
  );

  // 2) Short open-network step: zone mass drops and/or vented gas rises
  const afterVent = step("vent-open-network");
  const ventedAfterOpen = afterVent.compartments.totalVentedGasKg;
  const massAfterOpen = zoneGasMassKg(
    snapshot("post-open-vent-truth"),
    ZONE_ID,
  );
  const observedPressurePa =
    zoneTelemetry(afterVent, ZONE_ID).observed.pressurePa;
  const massDropped = massAfterOpen < massBeforeBreach;
  const ventedIncreased = ventedAfterOpen > baselineVentedKg;
  const observedPressureDropped =
    observedPressurePa !== null && observedPressurePa < 100_000;
  assert.ok(
    massDropped || ventedIncreased || observedPressureDropped,
    `expected A-05 mass/pressure drop or vented-gas increase; mass ${massBeforeBreach}→${massAfterOpen}, vented ${baselineVentedKg}→${ventedAfterOpen}, observedP=${observedPressurePa}`,
  );
  const openNetworkVentDelta = ventedAfterOpen - baselineVentedKg;
  assert.ok(
    openNetworkVentDelta > 0,
    "open-network step must vent a positive mass through the breach",
  );

  // 3) Isolation path: close all A-05 incident valves (stable containment)
  const isolated = dispatch({
    type: "ship-command",
    requestId: "isolate-a-05-after-breach",
    commandId: "life-support:isolate-a-05-after-breach",
    idempotencyKey: "life-support:isolate-a-05-after-breach",
    issuedAtMicroseconds: Math.round(afterVent.elapsedSeconds * 1_000_000),
    expectedRevision: afterVent.commandBus.revision,
    expectedStateRevision: afterVent.state.revision,
    command: {
      kind: "isolate-pressure-zone",
      actorAgentId: "life-support",
      zoneId: ZONE_ID,
    },
  });
  assert.equal(isolated.type, "ship-command", isolated.message);
  assert.ok(
    isolated.payload.result.actuatedConnections > 0,
    "isolation must actuate at least one compartment connection",
  );

  const isolatedSnapshot = snapshot("isolated-connections");
  const incidentConnections =
    isolatedSnapshot.compartments.connections.filter(
      (connection) =>
        connection.zoneAId === ZONE_ID || connection.zoneBId === ZONE_ID,
    );
  assert.ok(incidentConnections.length > 0);
  assert.ok(
    incidentConnections.every(
      (connection) => connection.commandedOpenFraction === 0,
    ),
    "every A-05 incident connection must be commanded shut",
  );

  const neighborMassAtIsolate = Object.fromEntries(
    NEIGHBOR_ZONE_IDS.map((zoneId) => [
      zoneId,
      zoneGasMassKg(isolatedSnapshot, zoneId),
    ]),
  );

  // 4) Contained step: further ship-wide venting slows; neighbors stay stable
  const afterContainment = step("vent-isolated");
  assert.equal(
    zoneTelemetry(afterContainment, ZONE_ID).hasBreach,
    true,
    "breach remains until hull repair; isolation only contains it",
  );
  const containedVentDelta =
    afterContainment.compartments.totalVentedGasKg - ventedAfterOpen;
  assert.ok(
    containedVentDelta < openNetworkVentDelta,
    `isolation should reduce further venting vs open network (${containedVentDelta} < ${openNetworkVentDelta})`,
  );

  const afterContainmentSnapshot = snapshot("post-containment-truth");
  for (const neighborId of NEIGHBOR_ZONE_IDS) {
    const before = neighborMassAtIsolate[neighborId];
    const after = zoneGasMassKg(afterContainmentSnapshot, neighborId);
    assert.ok(
      Math.abs(after - before) < 0.05,
      `${neighborId} gas mass should stay stable under containment (${before}→${after} kg)`,
    );
  }

  const wallMs = performance.now() - wallStart;
  assert.ok(
    wallMs < 30_000,
    `scenario must finish under 30s wall (took ${wallMs.toFixed(0)} ms)`,
  );
});

test("壳体威胁：破口禁跃迁、推进降额，未修 30min 级联 AHU", () => {
  const ready = initialize("init-hull-threat");
  assert.equal(ready.payload.hullConsequence.jumpBlocked, false);
  assert.equal(ready.payload.hullConsequence.hullIntegrity, 1);

  const hit = dispatch({
    type: "intervene",
    requestId: "hull-threat-micrometeoroid",
    request: {
      actor: "player:god-mode",
      reason: "hull threat cascade regression",
      operations: [
        {
          operation: "add",
          path: "atmosphere.leakAreaSquareMeters",
          value: 2.5e-5,
        },
      ],
      declaredBalance: {
        massKg: -0.025,
        energyJ: 25_000,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "micrometeoroid",
      },
      metadata: {
        eventType: "micrometeoroid",
        targetZoneId: ZONE_ID,
      },
    },
  });
  assert.equal(hit.type, "intervention", hit.message);
  assert.equal(hit.payload.hullConsequence.jumpBlocked, true);
  assert.ok(hit.payload.hullConsequence.hullIntegrity < 1);
  assert.equal(
    hit.payload.hullConsequence.thrustPerformanceByRing.a,
    0.85,
  );
  assert.equal(
    hit.payload.hullConsequence.thrustPerformanceByRing.b,
    1,
  );

  const jumpRejected = dispatch({
    type: "ship-command",
    requestId: "hull-threat-jump",
    commandId: "captain:hull-threat-jump",
    idempotencyKey: "captain:hull-threat-jump",
    issuedAtMicroseconds: Math.round(
      hit.payload.elapsedSeconds * 1_000_000,
    ),
    expectedRevision: hit.payload.commandBus.revision,
    expectedStateRevision: hit.payload.state.revision,
    command: {
      kind: "execute-jump",
      actorAgentId: "captain",
      distanceLightYears: 1,
    },
  });
  assert.equal(jumpRejected.type, "error", jumpRejected.message);
  assert.match(jumpRejected.message, /活动船体破口|壳体威胁|跃迁联锁/);

  // Active-breach coupling uses 3600s slices; cascade checks at slice start.
  step("hull-threat-hour-1", 3_600);
  const afterCascade = step("hull-threat-hour-2", 3_600);
  assert.ok(
    afterCascade.hullConsequence.events.some(
      (event) => event.cascadeStage >= 1,
    ),
    "unrepaired breach should reach cascade stage 1 after ≥30 min at slice boundary",
  );
  const snap = snapshot("hull-threat-after-cascade");
  const airHandler = snap.compartments.airHandlers.find(
    (handler) => handler.id === "air-handler-a",
  );
  assert.equal(airHandler.condition, "stuck-off");

  const cleared = dispatch({
    type: "intervene",
    requestId: "hull-threat-clear-leak",
    request: {
      actor: "player:god-mode",
      reason: "clear equivalent breach area",
      operations: [
        {
          operation: "set",
          path: "atmosphere.leakAreaSquareMeters",
          value: 0,
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "force clear",
      },
      metadata: { mode: "direct-force", fieldId: "leak" },
    },
  });
  assert.equal(cleared.type, "intervention", cleared.message);
  assert.equal(cleared.payload.hullConsequence.activeBreachCount, 0);
  assert.equal(cleared.payload.hullConsequence.jumpBlocked, false);
  assert.equal(cleared.payload.hullConsequence.hullIntegrity, 1);
  // Cascaded equipment stays broken after seal (Passengers-like).
  const stillBroken = snapshot("hull-threat-after-clear").compartments
    .airHandlers.find((handler) => handler.id === "air-handler-a");
  assert.equal(stillBroken.condition, "stuck-off");
});
