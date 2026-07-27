import assert from "node:assert/strict";
import test from "node:test";

const emitted = [];
globalThis.postMessage = (event) => emitted.push(event);
await import("../../lib/sim/worker.ts");

function dispatch(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  assert.equal(emitted.length, 1);
  return emitted[0];
}

test("captain world authority reaches durable operations and physical actuators but excludes player controls", () => {
  let current = dispatch({
    type: "initialize",
    requestId: "captain-authority:init",
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: "captain-authority-worker",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 3_600,
    },
  }).payload;
  current = dispatch({
    type: "set-time-control",
    requestId: "captain-authority:release",
    releasePauseTokens: ["ui"],
  }).payload;

  const issue = (command) => {
    const sequence = current.commandBus.revision + 1;
    const event = dispatch({
      type: "ship-command",
      requestId: `captain-authority:${sequence}`,
      commandId: `captain:authority-${sequence}`,
      idempotencyKey: `captain:authority-${sequence}`,
      issuedAtMicroseconds: Math.round(current.elapsedSeconds * 1_000_000),
      expectedRevision: current.commandBus.revision,
      expectedStateRevision: current.state.revision,
      command: { ...command, actorAgentId: "captain" },
    });
    assert.equal(event.type, "ship-command", event.message);
    current = event.payload;
    return event.payload.result;
  };

  issue({
    kind: "revise-mission",
    disposition: "divert",
    destination: "天仓五",
    objective: "转入安全港并完成乘员安置",
    route: [
      { id: "safe-corridor", label: "安全走廊", distanceFromPreviousLightYears: 2.2 },
    ],
    totalDistanceLightYears: 4.4,
    totalLegs: 2,
  });
  issue({
    kind: "manage-department-order",
    action: "create",
    departmentId: "engineering",
    title: "热控复核",
    instruction: "复核散热余量并每五分钟回报",
    priority: "urgent",
    deadlineSeconds: 3_600,
    estimatedWorkSeconds: 1_200,
    reportingIntervalSeconds: 300,
  });
  issue({
    kind: "publish-communication",
    communicationKind: "announcement",
    audienceOrTarget: "全体乘客",
    subject: "任务改道",
    message: "本舰已转向安全港，世界时钟在本次决策期间保持冻结。",
  });
  issue({
    kind: "manage-crew-assignment",
    personId: "crew-0001",
    departmentId: "engineering",
    role: "损管主管",
    shiftId: "alpha",
    dutyZoneId: "A-01",
    departmentHead: true,
  });
  issue({
    kind: "manage-person",
    action: "triage",
    personId: "crew-0001",
    triageLevel: "urgent",
  });
  issue({
    kind: "manage-person",
    action: "transfer",
    personId: "crew-0001",
    zoneId: "A-02",
    priority: "urgent",
  });
  issue({
    kind: "manage-security",
    action: "protect",
    teamId: "security-team-a",
    zoneId: "A-01",
    reason: "保护舰桥入口",
  });
  issue({
    kind: "manage-security",
    action: "investigate",
    teamId: "security-team-b",
    zoneId: "A-02",
    personId: "crew-0001",
    reason: "复核未经授权的门禁操作",
  });
  issue({
    kind: "manage-logistics",
    action: "set-ration",
    rationKgPerPersonDay: 0.7,
  });
  issue({
    kind: "set-compartment-connection",
    connectionId: "door:A-01:A-02",
    commandedOpenFraction: 0.35,
  });
  issue({
    kind: "set-thermal-control",
    targetType: "radiator",
    radiatorId: "radiator-wing-a",
    controlFraction: 0.8,
  });
  issue({
    kind: "set-atmosphere-supply",
    zoneId: "A-01",
    gas: "oxygen",
    massKg: 2,
    operation: "add",
  });
  issue({
    kind: "set-oxygen-production",
    generatorId: "oxygen-generator-a",
    enabled: true,
    targetProductionKgPerHour: 6,
  });
  issue({
    kind: "distribute-water",
    action: "set-zone-allocation",
    zoneId: "A-01",
    kgPerAwakePersonDay: 4.5,
  });
  issue({
    kind: "manage-sensor-operation",
    action: "set-frequency",
    packageId: "thermal-diagnostic-array",
    sampleIntervalSeconds: 5,
  });
  issue({
    kind: "manage-sensor-operation",
    action: "active-scan",
    packageId: "thermal-diagnostic-array",
    target: "A/B 环热控总线",
    durationSeconds: 600,
    priority: "urgent",
  });
  issue({
    kind: "manage-sensor-operation",
    action: "active-scan",
    packageId: "hull-inspection-array",
    target: "A环外壳",
    durationSeconds: 600,
    priority: "urgent",
  });
  issue({
    kind: "manage-remote-asset",
    assetId: "drone-a1",
    action: "deploy",
    mission: "外壳检查",
    target: "A环外壳",
  });
  issue({
    kind: "set-power-allocation",
    loadId: "habitat-a",
    maximumDemandFraction: 0.6,
  });

  const stepped = dispatch({
    type: "step",
    requestId: "captain-authority:advance",
    realSeconds: 1,
    timeScale: 3_000,
  });
  assert.equal(stepped.type, "stepped", stepped.message);
  current = stepped.payload;
  const saved = dispatch({
    type: "snapshot",
    requestId: "captain-authority:snapshot",
  }).payload.snapshot;

  assert.equal(saved.snapshotVersion, 18);
  assert.equal(saved.engine.state.journey.destination, "天仓五");
  assert.equal(saved.operations.mission.disposition, "divert");
  assert.equal(saved.operations.departmentOrders.length, 1);
  assert.equal(saved.operations.communications.length, 1);
  assert.equal(saved.operations.crewAssignments[0].personId, "crew-0001");
  assert.equal(saved.operations.securityTeams[0].posture, "protect");
  assert.equal(saved.operations.securityTeams[1].posture, "standby");
  assert.equal(saved.operations.securityCases[0].status, "cleared");
  assert.equal(
    saved.operations.personDispositions.find(
      (disposition) => disposition.personId === "crew-0001",
    ).currentZoneId,
    "A-02",
  );
  assert.equal(saved.operations.rationKgPerAwakePersonDay, 0.7);
  assert.equal(saved.operations.waterKgPerAwakePersonDayByZone["A-01"], 4.5);
  assert.equal(
    saved.operations.oxygenGenerators.find(
      (generator) => generator.id === "oxygen-generator-a",
    ).targetProductionKgPerHour,
    6,
  );
  assert.equal(saved.operations.remoteAssets.find((asset) => asset.id === "drone-a1").status, "deployed");
  assert.ok(
    saved.operations.remoteAssets.find((asset) => asset.id === "drone-a1")
      .energyStoredKWh < 48,
    "a deployed drone must consume its finite battery",
  );
  const scanSummaries = saved.operations.sensors.completedScanReports.map(
    (report) => report.summary,
  );
  assert.ok(
    scanSummaries.some((summary) => /热总线.*K.*散热功率.*W/.test(summary)),
    "thermal active-scan report should summarize sensor bus/radiator readings",
  );
  assert.ok(
    scanSummaries.some((summary) =>
      /高权限主动扫描摘要.*主动船体扫描/.test(summary),
    ),
    "hull active-scan report should carry the sensor-only disclaimer",
  );
  assert.equal(
    scanSummaries.some((summary) => /舰体真值|导航真值/.test(summary)),
    false,
    "active-scan reports must not claim perfect world truth",
  );
  assert.equal(saved.operations.powerAllocationLimitByLoad["habitat-a"], 0.6);
  assert.equal(saved.compartments.connections.find((connection) => connection.id === "door:A-01:A-02").commandedOpenFraction, 0.35);
  assert.equal(saved.cooling.radiators.find((radiator) => radiator.id === "radiator-wing-a").deployedFraction, 0.8);
  assert.equal(saved.operations.elapsedMicroseconds, saved.engine.clock.elapsedMicroseconds);

  const captainPermissions = saved.commandBus.permissions.find(
    (permission) => permission.role === "captain",
  ).kinds;
  for (const forbidden of ["snapshot", "restore", "set-time-control", "intervene", "save", "load"]) {
    assert.equal(captainPermissions.includes(forbidden), false);
  }
  for (const required of ["revise-mission", "manage-person", "manage-security", "set-thermal-control", "set-oxygen-production", "set-power-allocation"]) {
    assert.equal(captainPermissions.includes(required), true);
  }
});
