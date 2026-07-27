import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_ZONE_IDS,
  zoneCatalogEntry,
} from "../../lib/sim/compartments.ts";
import { ELECTRICAL_LOAD_IDS } from "../../lib/sim/electrical.ts";
import {
  agricultureCo2YieldFactor,
  AGRICULTURE_CO2_NOMINAL_PA,
  AGRICULTURE_CO2_STARVE_PA,
  AGRICULTURE_FOOD_KG_PER_DAY_AT_FULL_INTENSITY,
  AGRICULTURE_GROWTH_WATER_KG_PER_FOOD_KG,
  AGRICULTURE_IRRIGATION_KG_PER_DAY_AT_FULL_INTENSITY,
  CAPTAIN_OPERATIONS_SNAPSHOT_VERSION,
  CaptainOperations,
  defaultWaterAllocationKgPerDay,
  ZONE_ROLE_WATER_KG_PER_AWAKE_PERSON_DAY,
} from "../../lib/sim/captain-operations.ts";
import { WaterRecoveryNetwork } from "../../lib/sim/water.ts";

function createOperations() {
  return new CaptainOperations({
    origin: "太阳系",
    destination: "鲸鱼座 τ",
    objective: "保证乘员存续并安全抵达。",
    zoneIds: BASELINE_ZONE_IDS,
    electricalLoadIds: ELECTRICAL_LOAD_IDS,
  });
}

function disableOxygen(operations) {
  for (const generatorId of ["oxygen-generator-a", "oxygen-generator-b"]) {
    operations.configureOxygenGenerator({
      generatorId,
      enabled: false,
      targetProductionKgPerHour: 0,
    });
  }
}

test("agriculture CO2 yield factor clamps between starve and nominal", () => {
  assert.equal(agricultureCo2YieldFactor(0), 0);
  assert.equal(agricultureCo2YieldFactor(AGRICULTURE_CO2_STARVE_PA), 0);
  assert.equal(agricultureCo2YieldFactor(AGRICULTURE_CO2_NOMINAL_PA), 1);
  assert.equal(agricultureCo2YieldFactor(AGRICULTURE_CO2_NOMINAL_PA + 40), 1);
  const mid =
    (AGRICULTURE_CO2_STARVE_PA + AGRICULTURE_CO2_NOMINAL_PA) / 2;
  assert.ok(Math.abs(agricultureCo2YieldFactor(mid) - 0.5) < 1e-12);
});

test("agriculture consumes growth + irrigation water and yields food by power×CO2", () => {
  const operations = createOperations();
  disableOxygen(operations);
  operations.configureAgriculture({
    bayId: "agriculture-a",
    crop: "试验作物",
    intensityFraction: 1,
  });
  operations.configureAgriculture({
    bayId: "agriculture-b",
    crop: "试验作物",
    intensityFraction: 0,
  });

  const powerFactor = 0.5;
  const co2Factor = 0.5;
  const result = operations.advance(86_400, {
    agricultureServiceFractionByRing: { a: powerFactor, b: 0 },
    agricultureCo2AvailabilityByRing: { a: co2Factor, b: 0 },
    availablePotableWaterKgByRing: { a: 1_000, b: 0 },
  });
  const effect = result.effects.find(
    (candidate) => candidate.type === "food-produced",
  );
  assert.ok(effect);
  const growthWater =
    AGRICULTURE_FOOD_KG_PER_DAY_AT_FULL_INTENSITY *
    AGRICULTURE_GROWTH_WATER_KG_PER_FOOD_KG;
  const irrigation =
    AGRICULTURE_IRRIGATION_KG_PER_DAY_AT_FULL_INTENSITY * powerFactor;
  assert.equal(effect.irrigationWaterKgByRing.a, irrigation);
  assert.equal(effect.waterConsumedKgByRing.a, growthWater + irrigation);
  assert.equal(effect.waterConsumedKgByRing.b, 0);
  assert.ok(
    Math.abs(
      effect.foodKg -
        AGRICULTURE_FOOD_KG_PER_DAY_AT_FULL_INTENSITY *
          powerFactor *
          co2Factor,
    ) < 1e-12,
  );
  const bayA = operations.snapshot().agricultureBays.find(
    (bay) => bay.id === "agriculture-a",
  );
  assert.equal(bayA.cumulativeWaterConsumedKg, growthWater + irrigation);
  assert.ok(Math.abs(bayA.cumulativeFoodProducedKg - 10.5) < 1e-12);
});

test("agriculture irrigation tracks intensity×power only, not CO2", () => {
  const operations = createOperations();
  disableOxygen(operations);
  operations.configureAgriculture({
    bayId: "agriculture-a",
    crop: "试验作物",
    intensityFraction: 0.65,
  });
  operations.configureAgriculture({
    bayId: "agriculture-b",
    crop: "试验作物",
    intensityFraction: 0.65,
  });

  const co2Starved = operations.advance(86_400, {
    agricultureServiceFractionByRing: { a: 1, b: 1 },
    agricultureCo2AvailabilityByRing: { a: 0, b: 0 },
    availablePotableWaterKgByRing: { a: 10_000, b: 10_000 },
  });
  const co2Effect = co2Starved.effects.find(
    (candidate) => candidate.type === "food-produced",
  );
  assert.ok(co2Effect);
  const irrigationPerBay =
    AGRICULTURE_IRRIGATION_KG_PER_DAY_AT_FULL_INTENSITY * 0.65;
  assert.equal(co2Effect.foodKg, 0);
  assert.equal(co2Effect.irrigationWaterKgByRing.a, irrigationPerBay);
  assert.equal(co2Effect.irrigationWaterKgByRing.b, irrigationPerBay);
  assert.equal(
    co2Effect.waterConsumedKgByRing.a,
    irrigationPerBay +
      AGRICULTURE_FOOD_KG_PER_DAY_AT_FULL_INTENSITY *
        0.65 *
        AGRICULTURE_GROWTH_WATER_KG_PER_FOOD_KG,
  );

  const powerStarvedOps = createOperations();
  disableOxygen(powerStarvedOps);
  powerStarvedOps.configureAgriculture({
    bayId: "agriculture-a",
    crop: "试验作物",
    intensityFraction: 1,
  });
  powerStarvedOps.configureAgriculture({
    bayId: "agriculture-b",
    crop: "试验作物",
    intensityFraction: 0,
  });
  const powerStarved = powerStarvedOps.advance(86_400, {
    agricultureServiceFractionByRing: { a: 0, b: 0 },
    agricultureCo2AvailabilityByRing: { a: 1, b: 0 },
    availablePotableWaterKgByRing: { a: 1_000, b: 0 },
  });
  const powerEffect = powerStarved.effects.find(
    (candidate) => candidate.type === "food-produced",
  );
  assert.ok(powerEffect);
  assert.equal(powerEffect.foodKg, 0);
  assert.equal(powerEffect.irrigationWaterKgByRing.a, 0);
  // Growth water still attempted when lights are off (wasteful feedstock draw).
  assert.equal(
    powerEffect.waterConsumedKgByRing.a,
    AGRICULTURE_FOOD_KG_PER_DAY_AT_FULL_INTENSITY *
      AGRICULTURE_GROWTH_WATER_KG_PER_FOOD_KG,
  );
});

test("agriculture irrigation debit conserves potable mass via water network API", () => {
  const operations = createOperations();
  disableOxygen(operations);
  operations.configureAgriculture({
    bayId: "agriculture-a",
    crop: "试验作物",
    intensityFraction: 0.65,
  });
  operations.configureAgriculture({
    bayId: "agriculture-b",
    crop: "试验作物",
    intensityFraction: 0,
  });

  const water = new WaterRecoveryNetwork();
  const before = water.getSummary();
  const loops = water.listLoops();
  const available = {
    a: loops.find((loop) => loop.id === "water-loop-a").potableKg,
    b: loops.find((loop) => loop.id === "water-loop-b").potableKg,
  };
  const result = operations.advance(86_400, {
    agricultureServiceFractionByRing: { a: 1, b: 0 },
    agricultureCo2AvailabilityByRing: { a: 1, b: 0 },
    availablePotableWaterKgByRing: available,
  });
  const effect = result.effects.find(
    (candidate) => candidate.type === "food-produced",
  );
  assert.ok(effect);
  const irrigation =
    AGRICULTURE_IRRIGATION_KG_PER_DAY_AT_FULL_INTENSITY * 0.65;
  const growth =
    AGRICULTURE_FOOD_KG_PER_DAY_AT_FULL_INTENSITY *
    0.65 *
    AGRICULTURE_GROWTH_WATER_KG_PER_FOOD_KG;
  assert.equal(effect.irrigationWaterKgByRing.a, irrigation);
  assert.equal(effect.waterConsumedKgByRing.a, irrigation + growth);

  water.withdrawPotableForOperations(effect.waterConsumedKgByRing);
  const after = water.getSummary();
  assert.ok(
    Math.abs(after.potableKg - (before.potableKg - irrigation - growth)) <
      1e-8,
  );
  assert.ok(Math.abs(after.massClosureErrorKg) < 1e-8);
  assert.ok(
    Math.abs(
      after.potableKg +
        after.wastewaterKg +
        after.reserveIceKg +
        after.brineWasteKg -
        (before.potableKg +
          before.wastewaterKg +
          before.reserveIceKg +
          before.brineWasteKg -
          irrigation -
          growth),
    ) < 1e-8,
  );
});

test("captain mission, delegation, reports, and communications advance on one world clock", () => {
  const operations = createOperations();
  const mission = operations.reviseMission({
    disposition: "divert",
    destination: "天仓五",
    objective: "避开热控风险并转入安全港",
    route: [
      { id: "wp-1", label: "安全走廊入口", distanceFromPreviousLightYears: 2.4 },
    ],
  });
  assert.equal(mission.destination, "天仓五");

  const order = operations.createDepartmentOrder({
    departmentId: "engineering",
    title: "复核散热能力",
    instruction: "在一小时内给出剩余热容和处置建议",
    priority: "urgent",
    deadlineSeconds: 3_600,
    estimatedWorkSeconds: 1_200,
    reportingIntervalSeconds: 300,
  });
  const communication = operations.recordCommunication({
    kind: "announcement",
    audienceOrTarget: "全体乘客",
    subject: "临时改道",
    message: "为处理热控风险，本舰将临时改道。",
    deliveryDelaySeconds: 600,
  });

  const first = operations.advance(600);
  assert.equal(operations.elapsedMicroseconds, 600_000_000);
  assert.equal(first.deliveredCommunications[0].id, communication.id);
  assert.ok(first.reports.some((report) => report.progressFraction > 0));
  assert.deepEqual(
    first.reports.map((report) => report.atMicroseconds),
    [300_000_000, 600_000_000],
    "periodic reports must retain their exact world-time boundaries",
  );

  operations.changeDepartmentOrder({
    orderId: order.id,
    priority: "emergency",
    deadlineSeconds: 1_800,
  });
  operations.advance(600);
  const completed = operations.snapshot().departmentOrders.find(
    (candidate) => candidate.id === order.id,
  );
  assert.equal(completed.status, "completed");
});

test("oxygen production conserves water, oxygen and hydrogen under power and feedstock limits", () => {
  const operations = createOperations();
  operations.configureOxygenGenerator({
    generatorId: "oxygen-generator-a",
    enabled: true,
    targetProductionKgPerHour: 8,
  });
  operations.configureOxygenGenerator({
    generatorId: "oxygen-generator-b",
    enabled: false,
    targetProductionKgPerHour: 0,
  });
  operations.configureAgriculture({
    bayId: "agriculture-a",
    crop: "复合谷物与豆科",
    intensityFraction: 0,
  });
  operations.configureAgriculture({
    bayId: "agriculture-b",
    crop: "复合谷物与豆科",
    intensityFraction: 0,
  });
  const oxygenBefore = operations.snapshot().atmosphereReserveKg.oxygen;
  const result = operations.advance(3_600, {
    oxygenProductionServiceFractionByRing: { a: 0.5, b: 0 },
    agricultureServiceFractionByRing: { a: 0, b: 0 },
    agricultureCo2AvailabilityByRing: { a: 0, b: 0 },
    availablePotableWaterKgByRing: { a: 2.25, b: 0 },
  });
  const effect = result.effects.find(
    (candidate) => candidate.type === "oxygen-produced",
  );
  assert.ok(effect);
  assert.equal(effect.waterConsumedKgByRing.a, 2.25);
  assert.equal(effect.oxygenKg, 2);
  assert.equal(effect.hydrogenKg, 0.25);
  const snapshot = operations.snapshot();
  assert.equal(snapshot.atmosphereReserveKg.oxygen, oxygenBefore + 2);
  assert.equal(snapshot.hydrogenReserveKg, 0.25);
  assert.equal(
    snapshot.oxygenGenerators.find(
      (generator) => generator.id === "oxygen-generator-a",
    ).lastElectricalServiceFraction,
    0.5,
  );
});

test("captain operations v1 saves migrate to powered oxygen and finite remote assets", () => {
  const current = createOperations().snapshot();
  const legacy = structuredClone(current);
  legacy.snapshotVersion = 1;
  delete legacy.oxygenGenerators;
  delete legacy.hydrogenReserveKg;
  for (const asset of legacy.remoteAssets) {
    delete asset.energyCapacityKWh;
    delete asset.energyStoredKWh;
    delete asset.deployedPowerKw;
    delete asset.rechargePowerKw;
    delete asset.lastTelemetryAtMicroseconds;
  }
  for (const grievance of legacy.grievances) {
    delete grievance.filedByPassengerId;
  }
  const migrated = CaptainOperations.restore({
    snapshot: legacy,
    zoneIds: BASELINE_ZONE_IDS,
    electricalLoadIds: ELECTRICAL_LOAD_IDS,
  }).snapshot();
  assert.equal(migrated.snapshotVersion, CAPTAIN_OPERATIONS_SNAPSHOT_VERSION);
  assert.equal(migrated.oxygenGenerators.length, 2);
  assert.equal(migrated.remoteAssets[0].energyStoredKWh, 240);
  assert.ok(migrated.grievances.length > 0);
  for (const grievance of migrated.grievances) {
    assert.equal(grievance.filedByPassengerId, null);
  }
});

test("captain operations persist personnel, security, logistics, tasks, sensors and allocations without player controls", () => {
  const operations = createOperations();
  operations.assignCrew({
    personId: "crew-0001",
    departmentId: "engineering",
    role: "损管主管",
    shiftId: "alpha",
    dutyZoneId: "A-01",
    departmentHead: true,
  });
  operations.setPersonDisposition({
    personId: "crew-0001",
    currentZoneId: "A-01",
    triageLevel: "urgent",
    detained: true,
    detentionReason: "等待事故调查",
  });
  const securityCase = operations.openSecurityCase({
    subjectPersonId: "crew-0001",
    zoneId: "A-01",
    allegation: "未经授权操作舱门",
  });
  operations.deploySecurityTeam({
    teamId: "security-team-a",
    zoneId: "A-01",
    posture: "investigate",
    caseId: securityCase.id,
  });
  operations.setAccessControl({
    connectionId: "door:A-01:A-02",
    accessMode: "restricted",
    reason: "事故现场保护",
  });
  operations.setRation(0.7);
  operations.setWaterAllocation("A-01", 4.2);
  operations.configureAgriculture({
    bayId: "agriculture-a",
    crop: "高蛋白豆科",
    intensityFraction: 0.9,
  });
  operations.moveCargo({
    cargoId: "cargo:hull-sealant",
    quantity: 2,
    destinationZoneId: "A-18",
  });
  operations.setPowerAllocation("habitat-a", 0.55);
  operations.transferAtmosphereReserve("oxygen", 10, "to-compartment");
  operations.setSensorSampleInterval("external-radar", 5);
  operations.configureRemoteAsset({
    assetId: "drone-a1",
    action: "deploy",
    mission: "外壳检查",
    target: "A环外壳",
  });
  const task = operations.scheduleTask({
    kind: "remote-deployment",
    targetId: "drone-a1",
    description: "部署 drone-a1",
    deadlineSeconds: 1_200,
    requiredWorkSeconds: 600,
    priority: "urgent",
    assignedDepartmentId: "navigation",
    effect: { action: "deploy" },
  });
  const advance = operations.advance(600);
  assert.equal(advance.effects.find((effect) => effect.type === "task-completed").task.id, task.id);
  const oxygenProduction = advance.effects.find(
    (effect) => effect.type === "oxygen-produced",
  );
  assert.ok(oxygenProduction);
  assert.ok(Math.abs(oxygenProduction.oxygenKg - 8 / 6) < 1e-9);
  operations.applyCompletedTask(task.id);

  const snapshot = operations.snapshot();
  assert.equal(snapshot.remoteAssets.find((asset) => asset.id === "drone-a1").status, "deployed");
  assert.equal(snapshot.powerAllocationLimitByLoad["habitat-a"], 0.55);
  assert.ok(
    Math.abs(
      snapshot.atmosphereReserveKg.oxygen -
        (31_990 + oxygenProduction.oxygenKg),
    ) < 1e-9,
  );
  assert.equal(snapshot.waterKgPerAwakePersonDayByZone["A-01"], 4.2);
  assert.equal("save" in snapshot, false);
  assert.equal("load" in snapshot, false);
  assert.equal("timeScale" in snapshot, false);
  assert.deepEqual(
    CaptainOperations.restore({
      snapshot,
      zoneIds: BASELINE_ZONE_IDS,
      electricalLoadIds: ELECTRICAL_LOAD_IDS,
    }).snapshot(),
    snapshot,
  );
});

test("new missions seed water allocations from ZoneRole defaults", () => {
  const operations = createOperations();
  const expectedByRole = {
    living: 3,
    public: 2.5,
    medical: 4,
    galley: 6,
    agriculture: 8,
    cargo: 1.5,
    industrial: 2,
    access: 1.5,
  };
  assert.deepEqual(ZONE_ROLE_WATER_KG_PER_AWAKE_PERSON_DAY, expectedByRole);

  const byZone = operations.snapshot().waterKgPerAwakePersonDayByZone;
  for (const zoneId of BASELINE_ZONE_IDS) {
    const role = zoneCatalogEntry(zoneId).role;
    assert.equal(
      byZone[zoneId],
      expectedByRole[role],
      `${zoneId} (${role})`,
    );
    assert.equal(operations.getWaterAllocationKgPerDay(zoneId), expectedByRole[role]);
    assert.equal(defaultWaterAllocationKgPerDay(zoneId), expectedByRole[role]);
  }
  assert.equal(byZone["A-01"], 3);
  assert.equal(byZone["A-11"], 2.5);
  assert.equal(byZone["A-14"], 4);
  assert.equal(byZone["A-16"], 6);
  assert.equal(byZone["A-17"], 8);
  assert.equal(byZone["A-19"], 1.5);
  assert.equal(byZone["A-21"], 2);
  assert.equal(byZone["A-23"], 1.5);
});

test("restore migrates missing water keys to role defaults without rewriting saved values", () => {
  const baseline = createOperations().snapshot();
  const partial = {
    ...baseline,
    waterKgPerAwakePersonDayByZone: {
      "A-01": 3,
      "A-16": 5.5,
    },
  };
  const restored = CaptainOperations.restore({
    snapshot: partial,
    zoneIds: BASELINE_ZONE_IDS,
    electricalLoadIds: ELECTRICAL_LOAD_IDS,
  }).snapshot().waterKgPerAwakePersonDayByZone;

  assert.equal(restored["A-01"], 3);
  assert.equal(restored["A-16"], 5.5);
  assert.equal(restored["A-14"], 4);
  assert.equal(restored["A-17"], 8);
  assert.equal(Object.keys(restored).length, BASELINE_ZONE_IDS.length);
});
