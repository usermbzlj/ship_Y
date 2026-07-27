/**
 * Long-voyage conservation smoke (HANDOFF §6.5).
 *
 * Fixed-seed mission via the in-process worker (same `postMessage` harness as
 * `time-survival-golden` / `worker-runtime`). A full coupled worker day is too
 * slow for CI (~3 min: 60 s electrical coupling × 1440 slices), so this smoke:
 *   1) advances ≥1 coupled sim hour on the worker (integration path), then
 *   2) restores water / atmosphere / electrical from the snapshot and steps
 *      each domain ≥1 sim day with native large steps (same accelerated path
 *      as `water.test` day steps and `electrical` six-hour conservation).
 *
 * Tolerances (documented for reviewers):
 * - Water massClosureErrorKg / inventory−ledger: abs ≤ 1e-6 kg
 *   (worker-runtime band; hard restore gate is max(1e-4, inventory·1e-11)).
 * - Atmosphere species (zones + vented sink + scrubber capture) vs cumulative
 *   metabolism ledger: abs ≤ max(1e-6, |expected|·1e-10) kg per species —
 *   slightly looser than per-substep assertSpeciesBalance (1e-9 / 1e-12) for
 *   day-scale float drift; nitrogen must not be invented.
 * - Electrical stored vs ledger (incl. numericalResidualKWh): abs ≤ 1e-6 kWh
 *   (matches ShipElectricalNetwork restore / getEnergyBalance gate).
 */

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { CompartmentAtmosphereNetwork } from "../../lib/sim/compartments.ts";
import { ShipElectricalNetwork } from "../../lib/sim/electrical.ts";
import { WaterRecoveryNetwork } from "../../lib/sim/water.ts";

const emitted = [];
globalThis.postMessage = (event) => {
  emitted.push(event);
};
await import("../../lib/sim/worker.ts");

const SEED = "long-voyage-conservation-smoke-v1";
const SIM_DAY_SECONDS = 86_400;
const COUPLED_HOUR_SCALE = 3_600;
const GAS_SPECIES = [
  "oxygen",
  "nitrogen",
  "carbonDioxide",
  "waterVapor",
];

/** Post-absorption water closure smoke band (kg). */
const WATER_CLOSURE_TOL_KG = 1e-6;
/** Atmosphere accounted-mass vs metabolism (kg). */
const ATMOSPHERE_ABS_FLOOR_KG = 1e-6;
const ATMOSPHERE_REL_TOL = 1e-10;
/** Electrical stored vs ledger (kWh). */
const ELECTRICAL_CLOSURE_TOL_KWH = 1e-6;
/** Wall-clock budget for this smoke (ms). */
const MAX_WALL_MS = 90_000;

function dispatch(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  assert.equal(
    emitted.length,
    1,
    `expected exactly one worker event for ${command.type}, got ${emitted.length}`,
  );
  return emitted[0];
}

function initialize() {
  const ready = dispatch({
    type: "initialize",
    requestId: "conservation-init",
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: SEED,
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: COUPLED_HOUR_SCALE,
    },
  });
  assert.equal(ready.type, "ready", ready.message);
  assert.equal(ready.payload.timeControl.paused, true);

  const released = dispatch({
    type: "set-time-control",
    requestId: "conservation-release-ui",
    releasePauseTokens: ["ui"],
  });
  assert.equal(released.type, "ready", released.message);
  assert.equal(released.payload.timeControl.paused, false);
  return released;
}

function step(requestId, realSeconds, timeScale) {
  const event = dispatch({
    type: "step",
    requestId,
    realSeconds,
    timeScale,
  });
  assert.equal(
    event.type,
    "stepped",
    event.message ?? `step ${requestId} failed`,
  );
  return event;
}

function snapshot(requestId) {
  const event = dispatch({
    type: "snapshot",
    requestId,
  });
  assert.equal(event.type, "snapshot", event.message);
  return event.payload.snapshot;
}

function waterInventoryKg(waterSnap) {
  return waterSnap.loops.reduce(
    (total, loop) =>
      total +
      loop.potableKg +
      loop.wastewaterKg +
      loop.reserveIceKg +
      loop.brineWasteKg,
    0,
  );
}

function expectedWaterInventoryKg(waterSnap) {
  const ledger = waterSnap.ledger;
  return (
    ledger.initialInventoryKg +
    ledger.condensateInflowKg +
    ledger.externallyAddedKg +
    ledger.numericalResidualKg -
    ledger.metabolicOutflowKg
  );
}

function accountedAtmosphereGasesKg(compartments) {
  const gases = {
    oxygen: 0,
    nitrogen: 0,
    carbonDioxide: 0,
    waterVapor: 0,
  };
  for (const zone of compartments.zones) {
    for (const gas of GAS_SPECIES) {
      gases[gas] += zone.gasesKg[gas];
    }
  }
  for (const gas of GAS_SPECIES) {
    gases[gas] += compartments.sink.ventedGasesKg[gas];
  }
  for (const handler of compartments.airHandlers) {
    gases.carbonDioxide += handler.cumulativeCapturedCarbonDioxideKg;
  }
  return gases;
}

function expectedAtmosphereGasesKg(initialAccounted, metabolism) {
  return {
    oxygen: initialAccounted.oxygen - metabolism.oxygenConsumedKg,
    nitrogen: initialAccounted.nitrogen,
    carbonDioxide:
      initialAccounted.carbonDioxide + metabolism.carbonDioxideProducedKg,
    waterVapor:
      initialAccounted.waterVapor + metabolism.waterVaporProducedKg,
  };
}

function atmosphereTolKg(expectedKg) {
  return Math.max(
    ATMOSPHERE_ABS_FLOOR_KG,
    Math.abs(expectedKg) * ATMOSPHERE_REL_TOL,
  );
}

function electricalStoredKWh(electricalSnap) {
  return electricalSnap.batteries.reduce(
    (total, battery) => total + battery.storedEnergyKWh,
    0,
  );
}

function electricalLedgerExpectedStoredKWh(electricalSnap) {
  const ledger = electricalSnap.ledger;
  return (
    ledger.initialStoredEnergyKWh +
    ledger.reactorGenerationKWh -
    ledger.servedLoadKWh -
    ledger.curtailedGenerationKWh -
    ledger.batteryConversionLossKWh +
    ledger.externalEnergyKWh +
    ledger.numericalResidualKWh
  );
}

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ± ${tolerance}, received ${actual} (Δ=${actual - expected})`,
  );
}

function assertWaterClosure(waterSnap, label) {
  const inventoryKg = waterInventoryKg(waterSnap);
  const expectedKg = expectedWaterInventoryKg(waterSnap);
  assertClose(
    inventoryKg - expectedKg,
    0,
    WATER_CLOSURE_TOL_KG,
    `${label}: water inventory vs ledger (potable+waste+ice+brine)`,
  );
  assert.ok(
    Number.isFinite(inventoryKg) && inventoryKg > 0,
    `${label}: water inventory must stay finite and positive, got ${inventoryKg}`,
  );
  assert.ok(
    Number.isFinite(waterSnap.ledger.numericalResidualKg),
    `${label}: water numericalResidualKg must stay finite`,
  );
  return { inventoryKg, closureKg: inventoryKg - expectedKg };
}

function assertAtmosphereClosure(initialAccounted, compartmentsSnap, label) {
  const accounted = accountedAtmosphereGasesKg(compartmentsSnap);
  const expected = expectedAtmosphereGasesKg(
    initialAccounted,
    compartmentsSnap.metabolism,
  );
  for (const gas of GAS_SPECIES) {
    assertClose(
      accounted[gas],
      expected[gas],
      atmosphereTolKg(expected[gas]),
      `${label}: atmosphere accounted ${gas} (zones+vented+captured)`,
    );
  }
  assertClose(
    accounted.nitrogen,
    initialAccounted.nitrogen,
    atmosphereTolKg(initialAccounted.nitrogen),
    `${label}: nitrogen closed across zones+vented (no metabolic source)`,
  );
  return accounted;
}

function assertElectricalClosure(electricalSnap, label) {
  const storedKWh = electricalStoredKWh(electricalSnap);
  const ledgerExpectedKWh = electricalLedgerExpectedStoredKWh(electricalSnap);
  assertClose(
    storedKWh,
    ledgerExpectedKWh,
    ELECTRICAL_CLOSURE_TOL_KWH,
    `${label}: electrical stored vs ledger (incl. numericalResidualKWh)`,
  );
  assert.ok(
    Number.isFinite(electricalSnap.ledger.numericalResidualKWh),
    `${label}: electrical numericalResidualKWh must stay finite`,
  );
  return { storedKWh, closureKWh: storedKWh - ledgerExpectedKWh };
}

test("long-voyage smoke: ≥1 sim day keeps water/atmosphere/electrical within closure bands", () => {
  const wallStarted = performance.now();
  initialize();

  const before = snapshot("conservation-before");
  assert.equal(before.engine.clock.elapsedMicroseconds, 0);
  const initialAtmosphere = accountedAtmosphereGasesKg(before.compartments);
  assert.equal(before.compartments.metabolism.oxygenConsumedKg, 0);

  // (1) Coupled worker hour — same harness as golden / worker-runtime.
  const coupled = step("conservation-coupled-hour", 1, COUPLED_HOUR_SCALE);
  assert.equal(coupled.payload.elapsedSeconds, COUPLED_HOUR_SCALE);
  const afterCoupled = snapshot("conservation-after-coupled-hour");
  assertWaterClosure(afterCoupled.water, "coupled-hour");
  assertAtmosphereClosure(
    initialAtmosphere,
    afterCoupled.compartments,
    "coupled-hour",
  );
  assertElectricalClosure(afterCoupled.electrical, "coupled-hour");
  if (
    typeof coupled.payload.waterRecovery?.truth?.summary?.massClosureErrorKg ===
    "number"
  ) {
    assertClose(
      coupled.payload.waterRecovery.truth.summary.massClosureErrorKg,
      0,
      WATER_CLOSURE_TOL_KG,
      "coupled-hour waterRecovery.truth.summary.massClosureErrorKg",
    );
  }
  if (
    typeof coupled.payload.electrical?.truth?.energyClosureErrorKWh === "number"
  ) {
    assertClose(
      coupled.payload.electrical.truth.energyClosureErrorKWh,
      0,
      ELECTRICAL_CLOSURE_TOL_KWH,
      "coupled-hour electrical.truth.energyClosureErrorKWh",
    );
  }

  // (2) Domain-accelerated ≥1 sim day from the mission snapshot (t=0 baseline).
  //    Clocks are independent per domain; each must advance ≥86400 s.
  const water = WaterRecoveryNetwork.restore(before.water);
  const compartments = CompartmentAtmosphereNetwork.restore(
    before.compartments,
  );
  const electrical = ShipElectricalNetwork.restore(before.electrical);

  water.step(SIM_DAY_SECONDS);
  compartments.step(SIM_DAY_SECONDS);
  electrical.step(SIM_DAY_SECONDS);

  const waterSnap = water.snapshot();
  const compartmentsSnap = compartments.snapshot();
  const electricalSnap = electrical.snapshot();

  assert.equal(
    waterSnap.elapsedMicroseconds,
    SIM_DAY_SECONDS * 1_000_000,
  );
  assert.equal(
    compartmentsSnap.elapsedMicroseconds,
    SIM_DAY_SECONDS * 1_000_000,
  );
  assert.equal(
    electricalSnap.elapsedMicroseconds,
    SIM_DAY_SECONDS * 1_000_000,
  );

  const waterDay = assertWaterClosure(waterSnap, "domain-day");
  assertAtmosphereClosure(initialAtmosphere, compartmentsSnap, "domain-day");
  assert.ok(
    compartmentsSnap.metabolism.oxygenConsumedKg > 0,
    "domain-day metabolism must consume oxygen over a sim day",
  );
  const electricalDay = assertElectricalClosure(electricalSnap, "domain-day");
  assertClose(
    water.getSummary().massClosureErrorKg,
    0,
    WATER_CLOSURE_TOL_KG,
    "domain-day water.getSummary().massClosureErrorKg",
  );
  assertClose(
    electrical.getEnergyBalance().closureErrorKWh,
    0,
    ELECTRICAL_CLOSURE_TOL_KWH,
    "domain-day electrical.getEnergyBalance().closureErrorKWh",
  );

  const wallMs = performance.now() - wallStarted;
  assert.ok(
    wallMs < MAX_WALL_MS,
    `conservation smoke took ${wallMs.toFixed(0)} ms (limit ${MAX_WALL_MS})`,
  );

  console.log(
    JSON.stringify({
      seed: SEED,
      coupledSimSeconds: coupled.payload.elapsedSeconds,
      domainDaySeconds: SIM_DAY_SECONDS,
      wallMs: Math.round(wallMs),
      waterClosureKg: waterDay.closureKg,
      waterInventoryKg: waterDay.inventoryKg,
      atmosphereOxygenConsumedKg:
        compartmentsSnap.metabolism.oxygenConsumedKg,
      ventedGasKg: GAS_SPECIES.reduce(
        (total, gas) => total + compartmentsSnap.sink.ventedGasesKg[gas],
        0,
      ),
      electricalClosureKWh: electricalDay.closureKWh,
      electricalNumericalResidualKWh:
        electricalSnap.ledger.numericalResidualKWh,
    }),
  );
});
