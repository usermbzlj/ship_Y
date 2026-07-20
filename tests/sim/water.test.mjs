import assert from "node:assert/strict";
import test from "node:test";

import {
  WATER_RECOVERY_SNAPSHOT_VERSION,
  WaterRecoveryNetwork,
} from "../../lib/sim/water.ts";

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test("A/B water processors close both treatment stages and inventory mass", () => {
  const network = new WaterRecoveryNetwork();
  const before = network.getSummary();
  network.synchronizeAwakeOccupants({ a: 100, b: 118 });
  network.step(86_400);

  const snapshot = network.snapshot();
  const summary = network.getSummary();
  assert.equal(snapshot.snapshotVersion, WATER_RECOVERY_SNAPSHOT_VERSION);
  assert.equal(snapshot.elapsedMicroseconds, 86_400_000_000);
  assertClose(
    snapshot.ledger.domesticTransferredKg,
    218 * 3,
    1e-9,
    "daily domestic transfer",
  );
  assertClose(
    snapshot.ledger.wastewaterProcessedKg,
    6_000,
    1e-9,
    "two rated processors",
  );
  assertClose(
    snapshot.ledger.primaryRecoveredKg,
    5_100,
    1e-9,
    "primary recovery",
  );
  assertClose(
    snapshot.ledger.brineRecoveredKg,
    783,
    1e-9,
    "brine polishing recovery",
  );
  assertClose(
    snapshot.ledger.residualBrineKg,
    117,
    1e-9,
    "residual brine",
  );
  assertClose(summary.recyclerEfficiency, 0.9805, 1e-12, "combined recovery");
  assertClose(summary.massClosureErrorKg, 0, 1e-8, "water-domain mass");
  assertClose(
    summary.potableKg +
      summary.wastewaterKg +
      summary.reserveIceKg +
      summary.brineWasteKg,
    before.potableKg +
      before.wastewaterKg +
      before.reserveIceKg +
      before.brineWasteKg,
    1e-8,
    "closed inventory",
  );
});

test("processor command, feeder service, and physical condition causally limit throughput", () => {
  const network = new WaterRecoveryNetwork();
  network.configureProcessor("water-processor-a", {
    commandedThroughputFraction: 0.8,
    condition: "degraded",
  });
  network.synchronizeProcessorElectricalServiceFraction(
    "water-processor-a",
    0.5,
  );
  network.configureProcessor("water-processor-b", {
    condition: "stuck-off",
  });

  assertClose(
    network.getProcessor("water-processor-a").actualThroughputKgPerSecond,
    (3_000 / 86_400) * 0.8 * 0.5 * 0.5,
    1e-15,
    "derived A throughput",
  );
  assert.equal(
    network.getProcessor("water-processor-b").actualThroughputKgPerSecond,
    0,
  );
  network.step(86_400);
  assertClose(
    network.getProcessor("water-processor-a").lastProcessedKg,
    600,
    1e-9,
    "A processed mass",
  );
  assert.equal(
    network.getProcessor("water-processor-b").lastProcessedKg,
    0,
  );
});

test("metabolic transfer and condensate return are explicit cross-domain flows", () => {
  const network = new WaterRecoveryNetwork();
  const initial = network.getSummary();
  network.withdrawMetabolicWater({ a: 3, b: 4 });
  network.collectCondensate({ a: 1.25, b: 2.75 });

  const snapshot = network.snapshot();
  const after = network.getSummary();
  assert.equal(snapshot.ledger.metabolicOutflowKg, 7);
  assert.equal(snapshot.ledger.condensateInflowKg, 4);
  assertClose(after.massClosureErrorKg, 0, 1e-9, "cross-domain mass ledger");
  assertClose(
    after.potableKg +
      after.wastewaterKg +
      after.reserveIceKg +
      after.brineWasteKg,
    initial.potableKg +
      initial.wastewaterKg +
      initial.reserveIceKg +
      initial.brineWasteKg -
      3,
    1e-9,
    "net inventory transfer",
  );
});

test("water inventory instruments publish delayed frames instead of live truth", () => {
  const network = new WaterRecoveryNetwork();
  network.synchronizeAwakeOccupants({ a: 100, b: 118 });
  network.step(60);
  assert.equal(network.getObservation(), null);
  const sampled = network.snapshot().observation.pending[0];
  const sampledPotableA = sampled.potableKgByRing.a;

  network.step(4);
  assert.equal(network.getObservation(), null);
  network.step(1);
  const published = network.getObservation();
  assert.ok(published);
  assert.equal(published.sampledAtMicroseconds, 60_000_000);
  assert.equal(published.availableAtMicroseconds, 65_000_000);
  assert.equal(published.potableKgByRing.a, sampledPotableA);
  assert.notEqual(
    published.potableKgByRing.a,
    network.listLoops().find((loop) => loop.ring === "a").potableKg,
  );
});

test("water snapshots resume exactly and reject forged topology or ledgers", () => {
  const direct = new WaterRecoveryNetwork();
  direct.synchronizeAwakeOccupants({ a: 109, b: 109 });
  direct.step(12_345.5);
  const restored = WaterRecoveryNetwork.restore(direct.snapshot());
  direct.step(98_765.25);
  restored.step(98_765.25);
  assert.deepEqual(restored.snapshot(), direct.snapshot());

  const forgedTopology = direct.snapshot();
  forgedTopology.loops[0].id = "water-loop-b";
  assert.throws(
    () => WaterRecoveryNetwork.restore(forgedTopology),
    /fixed A\/B topology|fixed A\/B contract/,
  );

  const forgedCausality = direct.snapshot();
  forgedCausality.processors[0].actualThroughputKgPerSecond += 0.001;
  assert.throws(
    () => WaterRecoveryNetwork.restore(forgedCausality),
    /not causally derived/,
  );

  const forgedLedger = direct.snapshot();
  forgedLedger.ledger.primaryRecoveredKg += 1;
  assert.throws(
    () => WaterRecoveryNetwork.restore(forgedLedger),
    /cumulative mass balance/,
  );
});

test("God-mode inventory replacement is capacity-bound and stays auditable", () => {
  const network = new WaterRecoveryNetwork();
  network.setTotalPotableInventoryKg(3_200_000);
  const snapshot = network.snapshot();
  assert.equal(network.getSummary().potableKg, 3_200_000);
  assert.equal(snapshot.loops[0].potableKg, 1_600_000);
  assert.equal(snapshot.loops[1].potableKg, 1_600_000);
  assert.equal(snapshot.ledger.externallyAddedKg, -400_000);
  assertClose(network.getSummary().massClosureErrorKg, 0, 1e-9, "God-mode ledger");
  assert.throws(
    () => network.setTotalPotableInventoryKg(4_400_001),
    /exceeds fixed tank capacity/,
  );
});
