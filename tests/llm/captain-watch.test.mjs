import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCaptainWatchCondition,
  CAPTAIN_WATCH_MAX_ACTIVE,
  CAPTAIN_WATCH_MAX_NOTE_CHARACTERS,
  CAPTAIN_WATCH_SNAPSHOT_VERSION,
  captainWatchTriggerKey,
  createCaptainWatchSnapshot,
  evaluateCaptainWatches,
  parseSetWatchConditionToolCall,
  renderCaptainWatchPromptBlock,
  SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA,
  SET_WATCH_CONDITION_TOOL_NAME,
  validateCaptainWatchSnapshot,
  WATCH_METRICS,
} from "../../lib/llm/captain-watch.ts";

test("WATCH_METRICS has exactly 12 unique ids", () => {
  assert.equal(WATCH_METRICS.length, 12);
  const ids = WATCH_METRICS.map((metric) => metric.id);
  assert.equal(new Set(ids).size, 12);
  assert.deepEqual(ids, [
    "hullIntegrity",
    "lowestZonePressureKpa",
    "highestZoneCarbonDioxideKpa",
    "coolantBusTemperatureK",
    "batteryStateOfChargeFraction",
    "jumpDriveChargeFraction",
    "potableWaterKg",
    "dryFoodKg",
    "atmosphereReserveKg",
    "awakePopulation",
    "meanPassengerStress",
    "openMaintenanceTaskCount",
  ]);
  assert.equal(SET_WATCH_CONDITION_TOOL_NAME, "set_watch_condition");
  assert.equal(CAPTAIN_WATCH_SNAPSHOT_VERSION, 1);
});

test("parse rejects unknown metric, bad comparator, OOB threshold, NaN, Infinity, empty note, negative expiry", () => {
  assert.equal(
    parseSetWatchConditionToolCall({
      metric: "godOmniscience",
      comparator: "above",
      threshold: 0.5,
      note: "不行",
    }).ok,
    false,
  );
  assert.equal(
    parseSetWatchConditionToolCall({
      metric: "hullIntegrity",
      comparator: "gte",
      threshold: 0.5,
      note: "不行",
    }).ok,
    false,
  );
  const oob = parseSetWatchConditionToolCall({
    metric: "hullIntegrity",
    comparator: "below",
    threshold: 1.5,
    note: "越界",
  });
  assert.equal(oob.ok, false);
  if (!oob.ok) {
    assert.match(oob.reason, /\[0, 1\]/);
  }
  assert.equal(
    parseSetWatchConditionToolCall({
      metric: "coolantBusTemperatureK",
      comparator: "above",
      threshold: Number.NaN,
      note: "热",
    }).ok,
    false,
  );
  assert.equal(
    parseSetWatchConditionToolCall({
      metric: "coolantBusTemperatureK",
      comparator: "above",
      threshold: Number.POSITIVE_INFINITY,
      note: "热",
    }).ok,
    false,
  );
  assert.equal(
    parseSetWatchConditionToolCall({
      metric: "batteryStateOfChargeFraction",
      comparator: "below",
      threshold: 0.2,
      note: "   ",
    }).ok,
    false,
  );
  assert.equal(
    parseSetWatchConditionToolCall({
      metric: "batteryStateOfChargeFraction",
      comparator: "below",
      threshold: 0.2,
      note: "低电",
      expiresAfterSeconds: -10,
    }).ok,
    false,
  );
  assert.equal(
    parseSetWatchConditionToolCall({
      metric: "batteryStateOfChargeFraction",
      comparator: "below",
      threshold: 0.2,
      note: "低电",
      expiresAfterSeconds: Number.NaN,
    }).ok,
    false,
  );
});

test("parse trims and truncates long note; expiresAfterSeconds optional", () => {
  const longNote = "担".repeat(CAPTAIN_WATCH_MAX_NOTE_CHARACTERS + 40);
  const parsed = parseSetWatchConditionToolCall({
    metric: "meanPassengerStress",
    comparator: "above",
    threshold: 0.7,
    note: `  ${longNote}  `,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(
      parsed.draft.note.length,
      CAPTAIN_WATCH_MAX_NOTE_CHARACTERS,
    );
    assert.equal(parsed.draft.expiresAfterSeconds, null);
  }

  const withExpiry = parseSetWatchConditionToolCall({
    metric: "awakePopulation",
    comparator: "below",
    threshold: 100,
    note: "人手",
    expiresAfterSeconds: 3_600,
  });
  assert.equal(withExpiry.ok, true);
  if (withExpiry.ok) {
    assert.equal(withExpiry.draft.expiresAfterSeconds, 3_600);
  }

  const nullExpiry = parseSetWatchConditionToolCall({
    metric: "awakePopulation",
    comparator: "below",
    threshold: 100,
    note: "人手",
    expiresAfterSeconds: null,
  });
  assert.equal(nullExpiry.ok, true);
  if (nullExpiry.ok) {
    assert.equal(nullExpiry.draft.expiresAfterSeconds, null);
  }
});

test("same metric+comparator replaces; exceeding max drops oldest ordinal", () => {
  let snapshot = createCaptainWatchSnapshot();
  const first = applyCaptainWatchCondition(
    snapshot,
    {
      metric: "coolantBusTemperatureK",
      comparator: "above",
      threshold: 340,
      note: "初哨",
      expiresAfterSeconds: null,
    },
    { simulationSeconds: 100 },
  );
  snapshot = first.snapshot;
  assert.equal(snapshot.conditions.length, 1);
  assert.equal(first.condition.watchId, "watch-1");

  const replaced = applyCaptainWatchCondition(
    snapshot,
    {
      metric: "coolantBusTemperatureK",
      comparator: "above",
      threshold: 360,
      note: "改哨",
      expiresAfterSeconds: 7_200,
    },
    { simulationSeconds: 200 },
  );
  snapshot = replaced.snapshot;
  assert.equal(snapshot.conditions.length, 1);
  assert.equal(snapshot.conditions[0].threshold, 360);
  assert.equal(snapshot.conditions[0].note, "改哨");
  assert.equal(snapshot.conditions[0].watchId, "watch-2");
  assert.equal(snapshot.conditions[0].expiresAtSimulationSeconds, 7_400);

  const drafts = [
    ["hullIntegrity", "below", 0.9],
    ["lowestZonePressureKpa", "below", 80],
    ["batteryStateOfChargeFraction", "below", 0.3],
    ["jumpDriveChargeFraction", "above", 0.95],
    ["potableWaterKg", "below", 1_000],
    ["dryFoodKg", "below", 2_000],
    ["atmosphereReserveKg", "below", 500],
  ];
  for (const [metric, comparator, threshold] of drafts) {
    const applied = applyCaptainWatchCondition(
      snapshot,
      {
        metric,
        comparator,
        threshold,
        note: metric,
        expiresAfterSeconds: null,
      },
      { simulationSeconds: 300 },
    );
    snapshot = applied.snapshot;
  }

  assert.equal(snapshot.conditions.length, CAPTAIN_WATCH_MAX_ACTIVE);
  assert.equal(
    snapshot.conditions.some((c) => c.watchId === "watch-2"),
    false,
  );
  const ordinals = snapshot.conditions.map((c) => c.ordinal).sort(
    (a, b) => a - b,
  );
  assert.equal(ordinals[0] > 2, true);
});

test("evaluate uses strict inequality; missing samples skip; fire disarms once", () => {
  let snapshot = createCaptainWatchSnapshot();
  snapshot = applyCaptainWatchCondition(
    snapshot,
    {
      metric: "batteryStateOfChargeFraction",
      comparator: "below",
      threshold: 0.25,
      note: "低电警戒",
      expiresAfterSeconds: null,
    },
    { simulationSeconds: 1_000 },
  ).snapshot;
  snapshot = applyCaptainWatchCondition(
    snapshot,
    {
      metric: "coolantBusTemperatureK",
      comparator: "above",
      threshold: 400,
      note: "过热",
      expiresAfterSeconds: null,
    },
    { simulationSeconds: 1_000 },
  ).snapshot;

  const equalEdge = evaluateCaptainWatches(
    snapshot,
    {
      batteryStateOfChargeFraction: 0.25,
      coolantBusTemperatureK: 400,
    },
    { simulationSeconds: 1_100 },
  );
  assert.equal(equalEdge.fired.length, 0);
  assert.equal(equalEdge.snapshot.conditions.every((c) => c.armed), true);

  const missing = evaluateCaptainWatches(
    snapshot,
    {
      batteryStateOfChargeFraction: null,
      coolantBusTemperatureK: Number.NaN,
    },
    { simulationSeconds: 1_200 },
  );
  assert.equal(missing.fired.length, 0);

  const absent = evaluateCaptainWatches(
    snapshot,
    {},
    { simulationSeconds: 1_250 },
  );
  assert.equal(absent.fired.length, 0);

  const firedOnce = evaluateCaptainWatches(
    snapshot,
    {
      batteryStateOfChargeFraction: 0.2,
      coolantBusTemperatureK: 401,
    },
    { simulationSeconds: 1_300 },
  );
  assert.equal(firedOnce.fired.length, 2);
  assert.deepEqual(
    firedOnce.fired.map((item) => item.watchId),
    ["watch-1", "watch-2"],
  );
  assert.equal(firedOnce.fired[0].observedValue, 0.2);
  assert.equal(firedOnce.fired[0].label, "电池荷电状态");
  assert.equal(
    firedOnce.snapshot.conditions.every((c) => c.armed === false),
    true,
  );
  assert.equal(
    firedOnce.snapshot.conditions.every(
      (c) => c.triggeredAtSimulationSeconds === 1_300,
    ),
    true,
  );

  const secondPass = evaluateCaptainWatches(
    firedOnce.snapshot,
    {
      batteryStateOfChargeFraction: 0.1,
      coolantBusTemperatureK: 500,
    },
    { simulationSeconds: 1_400 },
  );
  assert.equal(secondPass.fired.length, 0);
  assert.equal(secondPass.snapshot.conditions.length, 2);
});

test("expired conditions are removed before evaluation", () => {
  let snapshot = createCaptainWatchSnapshot();
  snapshot = applyCaptainWatchCondition(
    snapshot,
    {
      metric: "openMaintenanceTaskCount",
      comparator: "above",
      threshold: 10,
      note: "维修堆积",
      expiresAfterSeconds: 100,
    },
    { simulationSeconds: 500 },
  ).snapshot;
  assert.equal(snapshot.conditions[0].expiresAtSimulationSeconds, 600);

  const expired = evaluateCaptainWatches(
    snapshot,
    { openMaintenanceTaskCount: 50 },
    { simulationSeconds: 600 },
  );
  assert.equal(expired.fired.length, 0);
  assert.equal(expired.snapshot.conditions.length, 0);

  snapshot = applyCaptainWatchCondition(
    createCaptainWatchSnapshot(),
    {
      metric: "openMaintenanceTaskCount",
      comparator: "above",
      threshold: 10,
      note: "维修堆积",
      expiresAfterSeconds: 100,
    },
    { simulationSeconds: 500 },
  ).snapshot;
  const stillLive = evaluateCaptainWatches(
    snapshot,
    { openMaintenanceTaskCount: 50 },
    { simulationSeconds: 599 },
  );
  assert.equal(stillLive.fired.length, 1);
  assert.equal(stillLive.snapshot.conditions.length, 1);
});

test("fired sorts by ordinal; trigger key is order-independent and stable", () => {
  let snapshot = createCaptainWatchSnapshot();
  for (const [metric, comparator, threshold] of [
    ["hullIntegrity", "below", 0.95],
    ["meanPassengerStress", "above", 0.6],
    ["awakePopulation", "below", 50],
  ]) {
    snapshot = applyCaptainWatchCondition(
      snapshot,
      {
        metric,
        comparator,
        threshold,
        note: metric,
        expiresAfterSeconds: null,
      },
      { simulationSeconds: 10 },
    ).snapshot;
  }

  const { fired } = evaluateCaptainWatches(
    snapshot,
    {
      hullIntegrity: 0.9,
      meanPassengerStress: 0.8,
      awakePopulation: 40,
    },
    { simulationSeconds: 20 },
  );
  assert.deepEqual(
    fired.map((item) => item.watchId),
    ["watch-1", "watch-2", "watch-3"],
  );

  const keyA = captainWatchTriggerKey(fired);
  const keyB = captainWatchTriggerKey([...fired].reverse());
  assert.equal(keyA, keyB);
  assert.equal(keyA, "watch:watch-1,watch-2,watch-3");
  assert.equal(captainWatchTriggerKey([]), null);
});

test("render returns null when empty; groups active/triggered with reminder", () => {
  assert.equal(
    renderCaptainWatchPromptBlock(createCaptainWatchSnapshot(), {
      nowSimulationSeconds: 0,
    }),
    null,
  );

  let snapshot = createCaptainWatchSnapshot();
  snapshot = applyCaptainWatchCondition(
    snapshot,
    {
      metric: "coolantBusTemperatureK",
      comparator: "above",
      threshold: 350,
      note: "冷却趋势让我不安",
      expiresAfterSeconds: 14_400,
    },
    { simulationSeconds: 3_600 },
  ).snapshot;
  snapshot = applyCaptainWatchCondition(
    snapshot,
    {
      metric: "batteryStateOfChargeFraction",
      comparator: "below",
      threshold: 0.3,
      note: "担心供电",
      expiresAfterSeconds: null,
    },
    { simulationSeconds: 3_600 },
  ).snapshot;

  const afterFire = evaluateCaptainWatches(
    snapshot,
    {
      coolantBusTemperatureK: 300,
      batteryStateOfChargeFraction: 0.2,
    },
    { simulationSeconds: 7_200 },
  );
  snapshot = afterFire.snapshot;

  const block = renderCaptainWatchPromptBlock(snapshot, {
    nowSimulationSeconds: 10_800,
  });
  assert.ok(block);
  assert.match(block, /^<watch>\n/);
  assert.match(block, /\n<\/watch>$/);
  assert.match(block, /你自己设的观察哨/);
  assert.match(block, /触发后会自动失效一次/);
  assert.match(block, /【生效中】/);
  assert.match(block, /【已触发（待你复核或重设）】/);
  assert.match(block, /冷却母线温度 高于 350 K/);
  assert.match(block, /冷却趋势让我不安/);
  assert.match(block, /创建于距今 2h00m/);
  assert.match(block, /将在 2h00m 后过期/);
  assert.match(block, /电池荷电状态 低于 0\.3/);
  assert.match(block, /担心供电/);
  assert.match(block, /触发于距今 1h00m/);
  assert.doesNotMatch(block, /距今 -\d/);
});

test("validateCaptainWatchSnapshot is strict and deep-clones", () => {
  assert.equal(validateCaptainWatchSnapshot(null), null);
  assert.equal(validateCaptainWatchSnapshot({}), null);
  assert.equal(
    validateCaptainWatchSnapshot({
      snapshotVersion: 1,
      nextOrdinal: 1,
      conditions: [],
      extra: true,
    }),
    null,
  );

  let snapshot = createCaptainWatchSnapshot();
  snapshot = applyCaptainWatchCondition(
    snapshot,
    {
      metric: "potableWaterKg",
      comparator: "below",
      threshold: 500,
      note: "水紧",
      expiresAfterSeconds: null,
    },
    { simulationSeconds: 42 },
  ).snapshot;

  const validated = validateCaptainWatchSnapshot(snapshot);
  assert.ok(validated);
  assert.notEqual(validated, snapshot);
  assert.notEqual(validated.conditions, snapshot.conditions);
  assert.deepEqual(validated, snapshot);

  const tampered = structuredClone(snapshot);
  tampered.conditions[0].metric = "notAMetric";
  assert.equal(validateCaptainWatchSnapshot(tampered), null);

  const badComparator = structuredClone(snapshot);
  badComparator.conditions[0].comparator = "gte";
  assert.equal(validateCaptainWatchSnapshot(badComparator), null);

  const infinite = structuredClone(snapshot);
  infinite.conditions[0].threshold = Number.POSITIVE_INFINITY;
  assert.equal(validateCaptainWatchSnapshot(infinite), null);

  const badId = structuredClone(snapshot);
  badId.conditions[0].watchId = "watch-99";
  assert.equal(validateCaptainWatchSnapshot(badId), null);
});

test("SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA is frozen with full enum and required", () => {
  assert.equal(Object.isFrozen(SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA), true);
  assert.equal(
    Object.isFrozen(SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA.properties),
    true,
  );
  const properties = SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA.properties;
  assert.ok(properties && typeof properties === "object");
  const metric = properties.metric;
  assert.ok(metric && typeof metric === "object");
  assert.equal(Object.isFrozen(metric), true);
  assert.deepEqual(metric.enum, WATCH_METRICS.map((item) => item.id));
  assert.equal(Object.isFrozen(metric.enum), true);

  const comparator = properties.comparator;
  assert.ok(comparator && typeof comparator === "object");
  assert.deepEqual(comparator.enum, ["above", "below"]);

  assert.deepEqual(SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA.required, [
    "metric",
    "comparator",
    "threshold",
    "note",
  ]);
  assert.equal(
    SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA.additionalProperties,
    false,
  );
  assert.equal(
    properties.note.maxLength,
    CAPTAIN_WATCH_MAX_NOTE_CHARACTERS,
  );
  assert.match(
    String(metric.description),
    /授权观测中本来就能看到的量/,
  );
  assert.match(
    String(comparator.description),
    /触发一次后自动失效/,
  );
});
