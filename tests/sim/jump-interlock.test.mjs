import assert from "node:assert/strict";
import test from "node:test";

import {
  JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K,
  estimateJumpThermalProjection,
  jumpEnergyConsumedKWh,
} from "../../lib/sim/jump-interlock.ts";

test("jumpEnergyConsumedKWh scales with distance squared around the 5 ly reference", () => {
  const requiredCharge = 1000;
  assert.equal(
    jumpEnergyConsumedKWh({
      requiredChargePerJumpKWh: requiredCharge,
      distanceLightYears: 5,
    }),
    1.0 * requiredCharge,
  );
  assert.equal(
    jumpEnergyConsumedKWh({
      requiredChargePerJumpKWh: requiredCharge,
      distanceLightYears: 0,
    }),
    0.35 * requiredCharge,
  );
});

test("estimateJumpThermalProjection blocks when projected temperature exceeds the thermal bus ceiling", () => {
  const hot = estimateJumpThermalProjection({
    thermalBusTemperatureK: JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K,
    requiredChargePerJumpKWh: 50_000,
    distanceLightYears: 5,
  });
  assert.ok(hot);
  assert.equal(hot.clearsInterlock, false);
  assert.match(hot.blockReason ?? "", /推进热预测/);

  const highEnergy = estimateJumpThermalProjection({
    thermalBusTemperatureK: 300,
    requiredChargePerJumpKWh: 100_000_000,
    distanceLightYears: 5,
  });
  assert.ok(highEnergy);
  assert.ok(highEnergy.projectedTemperatureK > JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K);
  assert.equal(highEnergy.clearsInterlock, false);
  assert.match(highEnergy.blockReason ?? "", /推进热预测/);
});

test("estimateJumpThermalProjection clears interlock at safe low bus temperature", () => {
  const cool = estimateJumpThermalProjection({
    thermalBusTemperatureK: 290,
    requiredChargePerJumpKWh: 50_000,
    distanceLightYears: 1,
  });
  assert.ok(cool);
  assert.ok(cool.projectedTemperatureK <= JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K);
  assert.equal(cool.clearsInterlock, true);
  assert.equal(cool.blockReason, null);
});
