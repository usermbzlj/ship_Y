import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTAIN_WORLD_TOOLS,
  CAPTAIN_CONSULTATION_TOOL,
  RECORD_CAPTAIN_LOG_TOOL,
  SET_WATCH_CONDITION_TOOL,
  FILE_DISSENT_TOOL,
  FILE_PASSENGER_GRIEVANCE_TOOL,
  SHARE_PASSENGER_RUMOR_TOOL,
  parseCaptainWorldToolCall,
} from "../../lib/llm/captain-world-tools.ts";
import {
  passengerConditionBand,
  passengerStressBand,
  passengerTrustBand,
  isFiniteNumber,
  sumFiniteRecordValues,
  extractCaptainWatchMetricSample,
} from "../../lib/llm/captain-watch-metrics.ts";

const EXPECTED_CAPTAIN_WORLD_TOOL_NAMES = [
  "execute_jump",
  "set_awake_target",
  "isolate_pressure_zone",
  "set_air_handler_control",
  "set_water_processor_control",
  "configure_water_distribution_spur",
  "configure_habitat_thermal_delivery_spur",
  "schedule_maintenance",
  "schedule_thruster_pulse",
  "schedule_thruster_maneuver",
  "set_reactor_target",
  "set_reactor_mode",
  "set_cooling_pump_speed",
  "set_electrical_load_enabled",
  "set_electrical_breaker",
  "set_battery_mode",
  "set_habitat_ring_control",
  "revise_mission",
  "manage_department_order",
  "publish_communication",
  "manage_crew_assignment",
  "manage_person",
  "manage_security",
  "manage_logistics",
  "set_compartment_connection",
  "schedule_hull_repair",
  "set_thermal_control",
  "set_atmosphere_supply",
  "set_oxygen_production",
  "distribute_water",
  "reset_protection",
  "manage_maintenance_task",
  "manage_sensor_operation",
  "manage_remote_asset",
  "set_power_allocation",
];

test("CAPTAIN_WORLD_TOOLS has 35 unique names in base-then-extended order", () => {
  assert.equal(CAPTAIN_WORLD_TOOLS.length, 35);
  const names = CAPTAIN_WORLD_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, 35);
  assert.deepEqual(names, EXPECTED_CAPTAIN_WORLD_TOOL_NAMES);
});

test("every CAPTAIN_WORLD_TOOLS entry has name, description, and inputSchema", () => {
  for (const tool of CAPTAIN_WORLD_TOOLS) {
    assert.equal(typeof tool.name, "string");
    assert.ok(tool.name.length > 0, `empty name`);
    assert.equal(typeof tool.description, "string");
    assert.ok(
      typeof tool.description === "string" && tool.description.length > 0,
      `${tool.name} missing description`,
    );
    assert.equal(
      typeof tool.inputSchema,
      "object",
      `${tool.name} missing inputSchema`,
    );
    assert.ok(tool.inputSchema !== null, `${tool.name} null inputSchema`);
  }
});

test("standalone captain meta tools remain separately exported", () => {
  assert.equal(CAPTAIN_CONSULTATION_TOOL.name, "consult_departments");
  assert.equal(RECORD_CAPTAIN_LOG_TOOL.name, "record_captain_log");
  assert.equal(SET_WATCH_CONDITION_TOOL.name, "set_watch_condition");
  assert.equal(FILE_DISSENT_TOOL.name, "file_dissent");
  assert.equal(FILE_PASSENGER_GRIEVANCE_TOOL.name, "file_passenger_grievance");
  assert.equal(SHARE_PASSENGER_RUMOR_TOOL.name, "share_passenger_rumor");
  for (const tool of [
    CAPTAIN_CONSULTATION_TOOL,
    RECORD_CAPTAIN_LOG_TOOL,
    SET_WATCH_CONDITION_TOOL,
    FILE_DISSENT_TOOL,
    FILE_PASSENGER_GRIEVANCE_TOOL,
    SHARE_PASSENGER_RUMOR_TOOL,
  ]) {
    assert.equal(typeof tool.description, "string");
    assert.equal(typeof tool.inputSchema, "object");
  }
});

test("parseCaptainWorldToolCall accepts a legal execute_jump when ready", () => {
  const parsed = parseCaptainWorldToolCall(
    {
      name: "execute_jump",
      arguments: { distanceLightYears: 2.5 },
    },
    "ready",
    12,
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.command, {
      kind: "execute-jump",
      actorAgentId: "captain",
      distanceLightYears: 2.5,
    });
  }
});

test("parseCaptainWorldToolCall accepts legal set_awake_target", () => {
  const parsed = parseCaptainWorldToolCall(
    {
      name: "set_awake_target",
      arguments: { targetAwake: 120 },
    },
    "ready",
    12,
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.command.kind, "set-awake-target");
    if (parsed.command.kind === "set-awake-target") {
      assert.equal(parsed.command.targetAwake, 120);
    }
  }
});

test("parseCaptainWorldToolCall rejects unknown tool names", () => {
  const parsed = parseCaptainWorldToolCall(
    { name: "delete_save_file", arguments: {} },
    "ready",
    12,
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.reason, /白名单/);
  }
});

test("parseCaptainWorldToolCall rejects missing required fields", () => {
  const parsed = parseCaptainWorldToolCall(
    { name: "isolate_pressure_zone", arguments: {} },
    "ready",
    12,
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.reason, /zoneId/);
  }
});

test("parseCaptainWorldToolCall rejects out-of-range numeric arguments", () => {
  const jump = parseCaptainWorldToolCall(
    {
      name: "execute_jump",
      arguments: { distanceLightYears: 9 },
    },
    "ready",
    12,
  );
  assert.equal(jump.ok, false);
  if (!jump.ok) {
    assert.match(jump.reason, /0\.1 至 5/);
  }

  const awake = parseCaptainWorldToolCall(
    {
      name: "set_awake_target",
      arguments: { targetAwake: 9999 },
    },
    "ready",
    12,
  );
  assert.equal(awake.ok, false);
  if (!awake.ok) {
    assert.match(awake.reason, /0 至 2120/);
  }
});

test("passenger band helpers keep key-passenger thresholds", () => {
  assert.equal(passengerConditionBand(0.8), "stable");
  assert.equal(passengerConditionBand(0.5), "watch");
  assert.equal(passengerConditionBand(0.1), "critical");
  assert.equal(passengerStressBand(0.2), "low");
  assert.equal(passengerStressBand(0.5), "moderate");
  assert.equal(passengerStressBand(0.9), "high");
  assert.equal(passengerTrustBand(0.8), "high");
  assert.equal(passengerTrustBand(0.5), "mixed");
  assert.equal(passengerTrustBand(0.1), "low");
});

test("isFiniteNumber and sumFiniteRecordValues ignore non-finite values", () => {
  assert.equal(isFiniteNumber(1), true);
  assert.equal(isFiniteNumber(Number.NaN), false);
  assert.equal(sumFiniteRecordValues({ a: 1, b: 2 }), 3);
  assert.equal(sumFiniteRecordValues({ a: 1, b: Number.NaN }), 1);
  assert.equal(sumFiniteRecordValues(null), null);
});

test("extractCaptainWatchMetricSample only reads authorized observation fields", () => {
  const sample = extractCaptainWatchMetricSample({
    sensorView: {
      hullThreat: { hullIntegrity: 0.91 },
      coolantSensorK: 340,
      batteryStateOfChargeSensorFraction: 0.55,
      waterRecoverySensors: {
        availability: "available",
        potableKgByRing: { a: 10, b: 20 },
      },
      maintenanceDiagnostics: { activeTasks: [{ id: "t1" }, { id: "t2" }] },
      lowestZonePressureSensorPa: 95_000,
      highestZoneCarbonDioxideSensorPa: 400,
    },
    delayedAuthorizedRecords: {
      jumpControllerRecord: {
        availability: "available",
        jumpDriveChargeEstimateKWh: 50,
        jumpDriveCapacityKWh: 100,
      },
      crewManifestRecord: {
        availability: "available",
        awakeRegistered: 42,
      },
    },
    operationsLedger: {
      availability: "available",
      atmosphereReserveKg: { oxygen: 1, nitrogen: 2 },
      foodDryKg: 700,
      meanPassengerStress: 0.33,
    },
  });
  assert.equal(sample.hullIntegrity, 0.91);
  assert.equal(sample.potableWaterKg, 30);
  assert.equal(sample.openMaintenanceTaskCount, 2);
  assert.equal(sample.awakePopulation, 42);
  assert.equal(sample.jumpDriveChargeFraction, 0.5);
  assert.equal(sample.lowestZonePressureKpa, 95);
  assert.equal(sample.highestZoneCarbonDioxideKpa, 0.4);
  assert.equal(sample.dryFoodKg, 700);
  assert.equal(sample.atmosphereReserveKg, 3);
  assert.equal(sample.meanPassengerStress, 0.33);
});
