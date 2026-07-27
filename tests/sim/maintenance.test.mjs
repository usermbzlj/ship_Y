import assert from "node:assert/strict";
import test from "node:test";
import {
  MAINTENANCE_ASSET_IDS,
  MAINTENANCE_PART_IDS,
  MaintenanceNetwork,
  evaluateMaintenanceSchedulingFeasibility,
  isCaptainWorldCommandSoftRejectMessage,
  isMaintenanceResourceContentionMessage,
  listActionableUnattendedMaintenanceFaults,
} from "../../lib/sim/maintenance.ts";

const nominalConditions = () =>
  Object.fromEntries(MAINTENANCE_ASSET_IDS.map((id) => [id, "nominal"]));

test("maintenance consumes a matching spare and finishes only through powered skilled work", () => {
  const network = new MaintenanceNetwork();
  const task = network.scheduleTask({
    assetId: "pump-a",
    detectedCondition: "stuck-off",
    crew: {
      passengerId: "crew-0003",
      skillId: "fluid-loops",
      proficiency: 1,
    },
  });
  assert.equal(network.getInventory()["pump-service-kit"], 3);
  assert.equal(network.listRobots().find((robot) => robot.id === task.assignedRobotId)?.assignedTaskId, task.id);

  const conditions = nominalConditions();
  conditions["pump-a"] = "stuck-off";
  network.advance(3_600, {
    currentConditions: conditions,
    workshopServiceFractionByRing: { a: 0, b: 1 },
    awakeCrewIds: new Set(["crew-0003"]),
  });
  assert.equal(network.listTasks()[0].completedWorkSeconds, 0);
  assert.equal(network.listTasks()[0].blockedReason, "workshop-unpowered");

  network.advance(3_600, {
    currentConditions: conditions,
    workshopServiceFractionByRing: { a: 1, b: 1 },
    awakeCrewIds: new Set(),
  });
  assert.equal(network.listTasks()[0].completedWorkSeconds, 0);
  assert.equal(network.listTasks()[0].blockedReason, "crew-unavailable");

  const result = network.advance(7_200, {
    currentConditions: conditions,
    workshopServiceFractionByRing: { a: 1, b: 1 },
    awakeCrewIds: new Set(["crew-0003"]),
  });
  assert.equal(result.completedTasks.length, 1);
  assert.equal(network.listTasks()[0].status, "completed");
  assert.equal(network.listRobots().find((robot) => robot.id === task.assignedRobotId)?.assignedTaskId, null);
});

test("maintenance has finite delayed diagnostics and deterministic restore", () => {
  const network = new MaintenanceNetwork();
  const conditions = nominalConditions();
  conditions["water-processor-b"] = "degraded";
  network.advance(119, {
    currentConditions: conditions,
    workshopServiceFractionByRing: { a: 1, b: 1 },
    awakeCrewIds: new Set(),
  });
  assert.equal(network.getPublishedDiagnostic(), null);
  network.advance(1, {
    currentConditions: conditions,
    workshopServiceFractionByRing: { a: 1, b: 1 },
    awakeCrewIds: new Set(),
  });
  assert.equal(network.getPublishedDiagnostic()?.conditions["water-processor-b"], "degraded");

  const restored = MaintenanceNetwork.restore(network.snapshot());
  assert.deepEqual(restored.snapshot(), network.snapshot());
});

test("approved substitute parts enter the real repair recipe and persist exact derating", () => {
  const network = new MaintenanceNetwork();
  const task = network.scheduleTask({
    assetId: "pump-a",
    detectedCondition: "failed",
    crew: {
      passengerId: "crew-0003",
      skillId: "fluid-loops",
      proficiency: 1,
    },
    requiredPartId: "air-handler-cartridge",
    repairDeratingFraction: 0.3,
  });
  assert.equal(task.nominalRequiredPartId, "pump-service-kit");
  assert.equal(task.requiredPartId, "air-handler-cartridge");
  assert.equal(network.getInventory()["pump-service-kit"], 4);
  assert.equal(network.getInventory()["air-handler-cartridge"], 7);

  const conditions = nominalConditions();
  conditions["pump-a"] = "failed";
  network.advance(7_200, {
    currentConditions: conditions,
    workshopServiceFractionByRing: { a: 1, b: 1 },
    awakeCrewIds: new Set(["crew-0003"]),
  });
  assert.equal(network.getAssetServiceLimitFraction("pump-a"), 0.7);
  assert.deepEqual(
    MaintenanceNetwork.restore(network.snapshot()).snapshot(),
    network.snapshot(),
  );
});

test("maintenance v2 saves migrate to nominal recipes and service limits", () => {
  const network = new MaintenanceNetwork();
  network.scheduleTask({
    assetId: "pump-a",
    detectedCondition: "degraded",
    crew: {
      passengerId: "crew-0003",
      skillId: "fluid-loops",
      proficiency: 0.8,
    },
  });
  const legacy = network.snapshot();
  legacy.snapshotVersion = 2;
  delete legacy.assetServiceLimitFractionById;
  for (const task of legacy.tasks) {
    delete task.nominalRequiredPartId;
    delete task.repairDeratingFraction;
  }
  const migrated = MaintenanceNetwork.restore(legacy).snapshot();
  assert.equal(migrated.snapshotVersion, 3);
  assert.equal(migrated.tasks[0].nominalRequiredPartId, "pump-service-kit");
  assert.equal(migrated.tasks[0].repairDeratingFraction, 0);
  assert.equal(migrated.assetServiceLimitFractionById["pump-a"], 1);
});

test("maintenance rejects forged topology, duplicate work, bad skills, and exhausted inventory", () => {
  const network = new MaintenanceNetwork();
  const assignment = {
    passengerId: "crew-0003",
    skillId: "fluid-loops",
    proficiency: 0.8,
  };
  assert.throws(
    () => network.scheduleTask({ assetId: "pump-a", detectedCondition: "nominal", crew: assignment }),
    /not in a repairable fault state/,
  );
  network.scheduleTask({ assetId: "pump-a", detectedCondition: "degraded", crew: assignment });
  assert.throws(
    () => network.scheduleTask({ assetId: "pump-a", detectedCondition: "degraded", crew: assignment }),
    /already has an active maintenance task/,
  );
  assert.throws(
    () =>
      new MaintenanceNetwork().scheduleTask({
        assetId: "ring-a-bearing",
        detectedCondition: "seized",
        crew: { ...assignment, skillId: "fluid-loops" },
      }),
    /lacks a qualified skill/,
  );

  const forged = network.snapshot();
  forged.inventory[MAINTENANCE_PART_IDS[0]] += 1;
  assert.throws(() => MaintenanceNetwork.restore(forged), /does not reconcile|exceeds initial stock/);
  const topology = network.snapshot();
  topology.robots.reverse();
  assert.throws(() => MaintenanceNetwork.restore(topology), /robot order changed/);
});

test("evaluateMaintenanceSchedulingFeasibility reports ring-robot-unavailable once both same-ring robots are busy", () => {
  const network = new MaintenanceNetwork();
  const crew = (passengerId) => ({ passengerId, skillId: "maintenance", proficiency: 0.8 });
  network.scheduleTask({ assetId: "pump-a", detectedCondition: "degraded", crew: crew("crew-a1") });
  network.scheduleTask({ assetId: "air-handler-a", detectedCondition: "degraded", crew: crew("crew-a2") });

  const thirdAssetFeasibility = evaluateMaintenanceSchedulingFeasibility({
    assetId: "water-processor-a",
    condition: "degraded",
    activeAssetIds: network.listTasks(),
    robots: network.listRobots(),
    inventory: network.getInventory(),
  });
  assert.deepEqual(thirdAssetFeasibility, {
    schedulable: false,
    blockReason: "ring-robot-unavailable",
  });

  const untouchedRingFeasibility = evaluateMaintenanceSchedulingFeasibility({
    assetId: "pump-b",
    condition: "failed",
    activeAssetIds: network.listTasks(),
    robots: network.listRobots(),
    inventory: network.getInventory(),
  });
  assert.deepEqual(untouchedRingFeasibility, { schedulable: true, blockReason: null });
});

test("listActionableUnattendedMaintenanceFaults excludes capacity-blocked faults but keeps schedulable ones", () => {
  const network = new MaintenanceNetwork();
  const crew = (passengerId) => ({ passengerId, skillId: "maintenance", proficiency: 0.8 });
  network.scheduleTask({ assetId: "pump-a", detectedCondition: "degraded", crew: crew("crew-a1") });
  network.scheduleTask({ assetId: "air-handler-a", detectedCondition: "degraded", crew: crew("crew-a2") });

  const observedAssets = [
    { assetId: "pump-a", condition: "degraded", label: "A 冷却泵" },
    { assetId: "water-processor-a", condition: "degraded", label: "A 水回收机" },
    { assetId: "pump-b", condition: "failed", label: "B 冷却泵" },
    { assetId: "ring-a-bearing", condition: "nominal", label: "A 居住环轴承" },
  ];

  const actionable = listActionableUnattendedMaintenanceFaults({
    observedAssets,
    activeTasks: network.listTasks(),
    robots: network.listRobots(),
    inventory: network.getInventory(),
  });

  assert.deepEqual(actionable.map((asset) => asset.assetId), ["pump-b"]);
});

test("listActionableUnattendedMaintenanceFaults suppresses diagnostic lag when truth is already nominal", () => {
  const network = new MaintenanceNetwork();
  const observedAssets = [
    { assetId: "pump-b", condition: "degraded", label: "B 冷却泵" },
  ];
  const actionable = listActionableUnattendedMaintenanceFaults({
    observedAssets,
    activeTasks: [],
    robots: network.listRobots(),
    inventory: network.getInventory(),
    truthConditions: { "pump-b": "nominal" },
  });
  assert.deepEqual(actionable, []);
});

test("listActionableUnattendedMaintenanceFaults suppresses recently completed assets still observed as degraded", () => {
  const network = new MaintenanceNetwork();
  const observedAssets = [
    { assetId: "pump-b", condition: "degraded", label: "B 冷却泵" },
  ];
  const actionable = listActionableUnattendedMaintenanceFaults({
    observedAssets,
    activeTasks: [],
    robots: network.listRobots(),
    inventory: network.getInventory(),
    recentlyCompletedAssetIds: ["pump-b"],
  });
  assert.deepEqual(actionable, []);
});

test("isMaintenanceResourceContentionMessage matches the real robot-unavailable rejection", () => {
  const network = new MaintenanceNetwork();
  const crew = (passengerId) => ({ passengerId, skillId: "maintenance", proficiency: 0.8 });
  network.scheduleTask({ assetId: "pump-a", detectedCondition: "degraded", crew: crew("crew-a1") });
  network.scheduleTask({ assetId: "air-handler-a", detectedCondition: "degraded", crew: crew("crew-a2") });

  assert.throws(
    () =>
      network.scheduleTask({
        assetId: "water-processor-a",
        detectedCondition: "degraded",
        crew: crew("crew-a3"),
      }),
    (error) => {
      assert.match(error.message, /no A-ring repair robot is available/);
      assert.equal(isMaintenanceResourceContentionMessage(error.message), true);
      return true;
    },
  );
  assert.equal(isMaintenanceResourceContentionMessage("no B-ring repair robot is available"), true);
  assert.equal(isMaintenanceResourceContentionMessage("totally unrelated failure"), false);
});

test("isCaptainWorldCommandSoftRejectMessage classifies soft vs hard rejects", () => {
  const soft = [
    "command FORBIDDEN: role captain cannot execute jump",
    "command REVISION_CONFLICT: expected revision 3, current revision is 4",
    "command UNKNOWN_ACTOR: actor ghost is not registered",
    "command IDEMPOTENCY_CONFLICT: idempotency key k belongs to another command",
    "command EXECUTOR_ERROR: executor failed: no A-ring repair robot is available",
    "command EXECUTOR_ERROR: executor failed: observed state revision 5 is stale; current revision is 6",
    "command EXECUTOR_ERROR: executor failed: creating a department order requires department, title, and instruction",
    "command EXECUTOR_ERROR: executor failed: cargo move is incomplete",
    "command EXECUTOR_ERROR: executor failed: 当前没有可维修故障",
  ];
  for (const message of soft) {
    assert.equal(
      isCaptainWorldCommandSoftRejectMessage(message),
      true,
      message,
    );
  }

  const hard = [
    "command INVALID_EXECUTOR_RESULT: executor result must be a plain JSON object",
    "command REENTRANT_DISPATCH: an executor cannot dispatch on the same bus",
    "command EXECUTOR_ERROR: executor failed: population.averageHealth does not match the authoritative cross-domain projection",
    "command EXECUTOR_ERROR: executor failed: rotation habitability lost ring-a",
    "command EXECUTOR_ERROR: executor failed: maintenance lost pump-a",
    "totally unrelated catastrophic failure",
  ];
  for (const message of hard) {
    assert.equal(
      isCaptainWorldCommandSoftRejectMessage(message),
      false,
      message,
    );
  }
});
