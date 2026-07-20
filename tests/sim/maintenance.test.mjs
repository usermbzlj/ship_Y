import assert from "node:assert/strict";
import test from "node:test";
import {
  MAINTENANCE_ASSET_IDS,
  MAINTENANCE_PART_IDS,
  MaintenanceNetwork,
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
