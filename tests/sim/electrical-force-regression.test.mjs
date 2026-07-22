import assert from "node:assert/strict";
import test from "node:test";
import {
  ShipElectricalNetwork,
} from "../../lib/sim/electrical.ts";

test("generation force after sustained load stepping keeps bus local power closed", () => {
  const network = new ShipElectricalNetwork({
    seed: "force-after-load",
  });
  for (const load of network.listLoads()) {
    if (
      load.id.startsWith("jump-drive") ||
      load.id.startsWith("propulsion-control")
    ) {
      network.synchronizeLoadControllerDemandFraction(load.id, 1);
    }
  }
  for (let hour = 0; hour < 3; hour += 1) {
    network.step(3_600);
  }
  const summary = network.applyExternalGenerationPower(
    650_000,
    "regression: generation force after stepping",
  );
  assert.equal(summary.generationPowerKw, 650_000);
  assert.equal(summary.powerBalanceErrorKw, 0);
  for (const bus of network.listBuses()) {
    const residual =
      bus.generationPowerKw +
      bus.batteryPowerKw +
      bus.netTransferPowerKw -
      bus.servedPowerKw -
      bus.curtailedPowerKw;
    assert.ok(
      Math.abs(residual) <= 1e-6,
      `${bus.id} residual ${residual}`,
    );
  }
  const transferSum = network
    .listBuses()
    .reduce((total, bus) => total + bus.netTransferPowerKw, 0);
  assert.ok(Math.abs(transferSum) <= 1e-6, `transfer sum ${transferSum}`);
});

test("generation force with open bus-tie keeps each island closed", () => {
  const network = new ShipElectricalNetwork({
    seed: "force-open-tie",
  });
  network.executeControlCommand({
    type: "set-breaker",
    breakerId: "breaker:bus-tie",
    commandedClosed: false,
  });
  network.step(120);
  const summary = network.applyExternalGenerationPower(
    500_000,
    "regression: force with open tie",
  );
  assert.equal(summary.generationPowerKw, 500_000);
  assert.equal(summary.powerBalanceErrorKw, 0);
});
