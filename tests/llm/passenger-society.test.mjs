import assert from "node:assert/strict";
import test from "node:test";

import {
  FILE_GRIEVANCE_TOOL_INPUT_SCHEMA,
  PASSENGER_GRIEVANCE_MAX_CHARACTERS,
  PASSENGER_RUMOR_CONTEXT_LIMIT,
  PASSENGER_RUMOR_DECAY_SECONDS,
  PASSENGER_RUMOR_MAX_CHARACTERS,
  PASSENGER_RUMOR_MAX_RECORDS,
  PASSENGER_RUMOR_MORALE_STRESS_CAP,
  PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS,
  PASSENGER_SOCIETY_SNAPSHOT_VERSION,
  SHARE_RUMOR_TOOL_INPUT_SCHEMA,
  computeRumorMoraleStressDeltas,
  createPassengerSocietySnapshot,
  detectHostileRumorTags,
  markRumorsHeard,
  parseFileGrievanceToolCall,
  parseShareRumorToolCall,
  pruneStaleRumors,
  recordPassengerRumor,
  renderPassengerSocietyPromptBlock,
  ringAdjacentZoneIds,
  selectOverheardRumors,
  spreadRumorsToAdjacentZones,
  tickPassengerSociety,
  validatePassengerSocietySnapshot,
} from "../../lib/llm/passenger-society.ts";

function record(
  snapshot,
  overrides = {},
) {
  return recordPassengerRumor(snapshot, {
    originPassengerId: "p-origin",
    originDisplayName: "传言者",
    zoneId: "A-01",
    text: "冷却好像出问题了",
    simulationSeconds: 0,
    ...overrides,
  });
}

function fillRumors(count, startSeconds = 0) {
  let snapshot = createPassengerSocietySnapshot();
  const rumors = [];
  for (let index = 0; index < count; index += 1) {
    const result = record(snapshot, {
      originPassengerId: `p-${index + 1}`,
      originDisplayName: `乘客${index + 1}`,
      zoneId: index % 2 === 0 ? "A-01" : "B-02",
      text: `传言内容-${index + 1}`,
      simulationSeconds: startSeconds + index,
    });
    snapshot = result.snapshot;
    rumors.push(result.rumor);
  }
  return { snapshot, rumors };
}

test("空 text 抛 RangeError；环形上限 48 且 ordinal 不回绕", () => {
  const empty = createPassengerSocietySnapshot();
  assert.throws(
    () =>
      recordPassengerRumor(empty, {
        originPassengerId: "p-1",
        originDisplayName: "甲",
        zoneId: "A-01",
        text: "   ",
        simulationSeconds: 10,
      }),
    RangeError,
  );
  assert.equal(empty.rumors.length, 0);

  const { snapshot, rumors } = fillRumors(PASSENGER_RUMOR_MAX_RECORDS + 3);
  assert.equal(snapshot.rumors.length, PASSENGER_RUMOR_MAX_RECORDS);
  assert.equal(snapshot.rumors[0].ordinal, 4);
  assert.equal(snapshot.rumors[0].rumorId, "rumor-4");
  assert.equal(
    snapshot.rumors[snapshot.rumors.length - 1].ordinal,
    PASSENGER_RUMOR_MAX_RECORDS + 3,
  );
  assert.equal(
    snapshot.nextOrdinal,
    PASSENGER_RUMOR_MAX_RECORDS + 4,
  );
  assert.equal(rumors[0].ordinal, 1);
  assert.ok(!snapshot.rumors.some((rumor) => rumor.ordinal === 1));
  assert.equal(snapshot.rumors[0].hearCount, 0);
});

test("selectOverheardRumors：排除自己、同区优先、越新优先、过期剔除、limit、不改快照", () => {
  let snapshot = createPassengerSocietySnapshot();
  const now = 10_000;
  const decayedAt = now - PASSENGER_RUMOR_DECAY_SECONDS - 1;

  snapshot = record(snapshot, {
    originPassengerId: "listener",
    originDisplayName: "听者自己",
    zoneId: "A-01",
    text: "自己说的不该听见",
    simulationSeconds: now - 10,
  }).snapshot;

  snapshot = record(snapshot, {
    originPassengerId: "other-old-same",
    originDisplayName: "同区旧",
    zoneId: "A-01",
    text: "同区较旧",
    simulationSeconds: now - 500,
  }).snapshot;

  snapshot = record(snapshot, {
    originPassengerId: "other-new-same",
    originDisplayName: "同区新",
    zoneId: "A-01",
    text: "同区较新",
    simulationSeconds: now - 100,
  }).snapshot;

  snapshot = record(snapshot, {
    originPassengerId: "other-cross",
    originDisplayName: "跨区",
    zoneId: "B-02",
    text: "跨区传言",
    simulationSeconds: now - 50,
  }).snapshot;

  snapshot = record(snapshot, {
    originPassengerId: "stale",
    originDisplayName: "过期",
    zoneId: "A-01",
    text: "已过期",
    simulationSeconds: decayedAt,
  }).snapshot;

  const before = structuredClone(snapshot);
  const selected = selectOverheardRumors(snapshot, {
    listenerPassengerId: "listener",
    zoneId: "A-01",
    simulationSeconds: now,
  });

  assert.deepEqual(snapshot, before);
  assert.equal(selected.length, PASSENGER_RUMOR_CONTEXT_LIMIT);
  assert.deepEqual(
    selected.map((rumor) => rumor.originPassengerId),
    ["other-new-same", "other-old-same", "other-cross"],
  );
  assert.ok(
    !selected.some((rumor) => rumor.originPassengerId === "listener"),
  );
  assert.ok(
    !selected.some((rumor) => rumor.originPassengerId === "stale"),
  );

  const limited = selectOverheardRumors(snapshot, {
    listenerPassengerId: "listener",
    zoneId: "A-01",
    simulationSeconds: now,
    limit: 1,
  });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].originPassengerId, "other-new-same");
});

test("markRumorsHeard：计数递增且未知 id 忽略", () => {
  let snapshot = createPassengerSocietySnapshot();
  const first = record(snapshot, {
    text: "第一条",
    simulationSeconds: 1,
  });
  snapshot = first.snapshot;
  const second = record(snapshot, {
    originPassengerId: "p-2",
    text: "第二条",
    simulationSeconds: 2,
  });
  snapshot = second.snapshot;

  const marked = markRumorsHeard(snapshot, [
    first.rumor.rumorId,
    "rumor-missing",
    first.rumor.rumorId,
  ]);
  assert.notEqual(marked, snapshot);
  assert.equal(snapshot.rumors[0].hearCount, 0);
  assert.equal(marked.rumors[0].hearCount, 1);
  assert.equal(marked.rumors[1].hearCount, 0);

  const again = markRumorsHeard(marked, [first.rumor.rumorId]);
  assert.equal(again.rumors[0].hearCount, 2);
});

test("pruneStaleRumors：等于 decay 秒保留，超过才剔除", () => {
  let snapshot = createPassengerSocietySnapshot();
  const createdAt = 1_000;
  snapshot = record(snapshot, {
    text: "边界传言",
    simulationSeconds: createdAt,
  }).snapshot;
  snapshot = record(snapshot, {
    originPassengerId: "p-stale",
    text: "更早的",
    simulationSeconds: createdAt - 1,
  }).snapshot;

  const atBoundary = pruneStaleRumors(snapshot, {
    simulationSeconds: createdAt + PASSENGER_RUMOR_DECAY_SECONDS,
  });
  assert.equal(atBoundary.rumors.length, 1);
  assert.equal(atBoundary.rumors[0].text, "边界传言");
  assert.equal(atBoundary.nextOrdinal, snapshot.nextOrdinal);

  const past = pruneStaleRumors(snapshot, {
    simulationSeconds: createdAt + PASSENGER_RUMOR_DECAY_SECONDS + 1,
  });
  assert.equal(past.rumors.length, 0);
  assert.equal(snapshot.rumors.length, 2);
});

test("parseFileGrievanceToolCall：合法、非法、截断、缺省 category", () => {
  assert.equal(parseFileGrievanceToolCall(null).ok, false);
  assert.equal(parseFileGrievanceToolCall([]).ok, false);

  const missingSummary = parseFileGrievanceToolCall({
    category: "food",
  });
  assert.equal(missingSummary.ok, false);

  const emptySummary = parseFileGrievanceToolCall({
    summary: "   ",
  });
  assert.equal(emptySummary.ok, false);

  const badCategory = parseFileGrievanceToolCall({
    category: "laser",
    summary: "有事",
  });
  assert.equal(badCategory.ok, false);

  const defaults = parseFileGrievanceToolCall({
    summary: "  配给不够吃  ",
  });
  assert.equal(defaults.ok, true);
  if (defaults.ok) {
    assert.equal(defaults.draft.category, "other");
    assert.equal(defaults.draft.summary, "配给不够吃");
  }

  const truncated = parseFileGrievanceToolCall({
    category: "water",
    summary: "S".repeat(PASSENGER_GRIEVANCE_MAX_CHARACTERS + 30),
  });
  assert.equal(truncated.ok, true);
  if (truncated.ok) {
    assert.equal(truncated.draft.category, "water");
    assert.equal(
      truncated.draft.summary.length,
      PASSENGER_GRIEVANCE_MAX_CHARACTERS,
    );
  }
});

test("parseShareRumorToolCall：合法、非法、截断", () => {
  assert.equal(parseShareRumorToolCall(null).ok, false);
  assert.equal(parseShareRumorToolCall({ text: "  " }).ok, false);

  const ok = parseShareRumorToolCall({
    text: "  听说下一区断电了  ",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.draft.text, "听说下一区断电了");
  }

  const truncated = parseShareRumorToolCall({
    text: "R".repeat(PASSENGER_RUMOR_MAX_CHARACTERS + 20),
  });
  assert.equal(truncated.ok, true);
  if (truncated.ok) {
    assert.equal(
      truncated.draft.text.length,
      PASSENGER_RUMOR_MAX_CHARACTERS,
    );
  }
});

test("renderPassengerSocietyPromptBlock：全空 null；无精确单位；含未经证实与末尾提醒", () => {
  assert.equal(
    renderPassengerSocietyPromptBlock(
      {
        circle: [],
        zoneMood: null,
        overheardRumors: [],
        recentPublicCommunications: [],
      },
      { nowSimulationSeconds: 0 },
    ),
    null,
  );

  const rumor = record(createPassengerSocietySnapshot(), {
    originPassengerId: "p-rumor",
    originDisplayName: "路人",
    zoneId: "A-01",
    text: "听说通风不太对劲",
    simulationSeconds: 86_400,
  }).rumor;

  const block = renderPassengerSocietyPromptBlock(
    {
      circle: [
        {
          passengerId: "p-family",
          displayName: "阿宁",
          relation: "family",
          lifeState: "awake",
          conditionBand: "watch",
          sameZone: true,
        },
        {
          passengerId: "p-peer",
          displayName: "老周",
          relation: "peer",
          lifeState: "hibernating",
          conditionBand: "stable",
          sameZone: false,
        },
        {
          passengerId: "p-gone",
          displayName: "小夏",
          relation: "family",
          lifeState: "deceased",
          conditionBand: "critical",
          sameZone: false,
        },
      ],
      zoneMood: {
        zoneId: "A-01",
        zoneLabel: "居住环甲段",
        awakeCount: 128,
        stressBand: "moderate",
        trustBand: "mixed",
      },
      overheardRumors: [rumor],
      recentPublicCommunications: [
        {
          simulationSeconds: 86_400 + 3_600,
          text: "舰桥提醒大家保持冷静，按区段领取配给。",
        },
      ],
    },
    { nowSimulationSeconds: 86_400 * 2 },
  );

  assert.ok(block);
  assert.match(block, /<around_you>/);
  assert.match(block, /<\/around_you>/);
  assert.match(block, /未经证实/);
  assert.match(block, /不要把传言当事实/);
  assert.match(block, /不要编造你没听说的事/);
  assert.match(block, /阿宁/);
  assert.match(block, /让你担心/);
  assert.match(block, /上百人/);
  assert.doesNotMatch(block, /kPa/);
  assert.doesNotMatch(block, /kg/);
  assert.doesNotMatch(block, /%/);
  assert.doesNotMatch(block, /\bK\b/);
  assert.doesNotMatch(block, /128/);
  assert.doesNotMatch(block, /0\.\d+/);
});

test("validatePassengerSocietySnapshot：严格性与深拷贝", () => {
  assert.equal(validatePassengerSocietySnapshot(null), null);
  assert.equal(validatePassengerSocietySnapshot({}), null);
  assert.equal(
    validatePassengerSocietySnapshot({
      snapshotVersion: 99,
      nextOrdinal: 1,
      rumors: [],
    }),
    null,
  );

  const { snapshot } = fillRumors(2, 100);
  const validated = validatePassengerSocietySnapshot(snapshot);
  assert.ok(validated);
  assert.equal(
    validated.snapshotVersion,
    PASSENGER_SOCIETY_SNAPSHOT_VERSION,
  );
  assert.notEqual(validated, snapshot);
  assert.notEqual(validated.rumors, snapshot.rumors);
  assert.deepEqual(validated, snapshot);

  validated.rumors[0].text = "被篡改";
  assert.notEqual(snapshot.rumors[0].text, "被篡改");

  const brokenOrdinal = structuredClone(snapshot);
  brokenOrdinal.rumors[0].rumorId = "rumor-999";
  assert.equal(validatePassengerSocietySnapshot(brokenOrdinal), null);

  const extraKey = {
    ...snapshot,
    extra: true,
  };
  assert.equal(validatePassengerSocietySnapshot(extraKey), null);
});

test("tool schema 冻结且拒绝额外字段", () => {
  assert.equal(FILE_GRIEVANCE_TOOL_INPUT_SCHEMA.additionalProperties, false);
  assert.equal(SHARE_RUMOR_TOOL_INPUT_SCHEMA.additionalProperties, false);
  assert.ok(Object.isFrozen(FILE_GRIEVANCE_TOOL_INPUT_SCHEMA));
  assert.ok(Object.isFrozen(SHARE_RUMOR_TOOL_INPUT_SCHEMA));
  assert.ok(
    Object.isFrozen(FILE_GRIEVANCE_TOOL_INPUT_SCHEMA.properties),
  );
  assert.ok(
    Object.isFrozen(SHARE_RUMOR_TOOL_INPUT_SCHEMA.properties),
  );
  assert.match(
    String(
      FILE_GRIEVANCE_TOOL_INPUT_SCHEMA.properties.summary.description,
    ),
    /不是直接命令飞船/,
  );
  assert.match(
    String(SHARE_RUMOR_TOOL_INPUT_SCHEMA.properties.text.description),
    /可能被别人当真/,
  );
});

test("validate 将 v1 快照迁移为 v2", () => {
  const v1 = {
    snapshotVersion: 1,
    nextOrdinal: 2,
    rumors: [
      {
        rumorId: "rumor-1",
        ordinal: 1,
        originPassengerId: "p-1",
        originDisplayName: "甲",
        createdAtSimulationSeconds: 10,
        zoneId: "A-01",
        text: "听说缺粮了要饿死",
        hearCount: 2,
      },
    ],
  };
  const migrated = validatePassengerSocietySnapshot(v1);
  assert.ok(migrated);
  assert.equal(migrated.snapshotVersion, PASSENGER_SOCIETY_SNAPSHOT_VERSION);
  assert.equal(migrated.lastSpreadSimSeconds, 0);
  assert.equal(migrated.lastMoraleSimSeconds, 0);
  assert.equal(migrated.rumors[0].spreadGeneration, 0);
  assert.equal(migrated.rumors[0].lastZoneHopSimSeconds, 10);
  assert.deepEqual(migrated.rumors[0].tags, ["hostile"]);
});

test("邻区扩散：足够节拍后传言可出现在相邻区带", () => {
  let snapshot = createPassengerSocietySnapshot();
  snapshot = record(snapshot, {
    zoneId: "A-01",
    text: "冷却好像出问题了",
    simulationSeconds: 0,
  }).snapshot;

  const neighbors = new Set(ringAdjacentZoneIds("A-01"));
  let hopped = false;
  for (let tick = 1; tick <= 2_000; tick += 1) {
    const simulationSeconds = tick * PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS;
    snapshot = spreadRumorsToAdjacentZones(snapshot, {
      simulationSeconds,
      adjacentZones: ringAdjacentZoneIds,
    });
    if (snapshot.rumors.some((rumor) => neighbors.has(rumor.zoneId))) {
      hopped = true;
      break;
    }
  }
  assert.equal(hopped, true);
  const copies = snapshot.rumors.filter((rumor) => neighbors.has(rumor.zoneId));
  assert.ok(copies.length >= 1);
  assert.ok(copies.every((rumor) => rumor.spreadGeneration === 1));
  assert.ok(copies.every((rumor) => rumor.hearCount === 0));
});

test("士气压力增量有界且确定性", () => {
  let snapshot = createPassengerSocietySnapshot();
  const recorded = record(snapshot, {
    zoneId: "A-07",
    text: "有人要叛变了，大家恐慌",
    simulationSeconds: 0,
  });
  assert.deepEqual(detectHostileRumorTags(recorded.rumor.text), ["hostile"]);
  snapshot = recorded.snapshot;
  for (let index = 0; index < 40; index += 1) {
    snapshot = markRumorsHeard(snapshot, [recorded.rumor.rumorId]);
  }

  const first = computeRumorMoraleStressDeltas(snapshot, {
    simulationSeconds: PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS,
  });
  const firstAgain = computeRumorMoraleStressDeltas(snapshot, {
    simulationSeconds: PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS,
  });
  assert.deepEqual(first.zoneStressDeltas, firstAgain.zoneStressDeltas);
  assert.equal(first.zoneStressDeltas.length, 1);
  assert.equal(first.zoneStressDeltas[0].zoneId, "A-07");
  assert.ok(first.zoneStressDeltas[0].stressDelta > 0);
  assert.ok(
    first.zoneStressDeltas[0].stressDelta <= PASSENGER_RUMOR_MORALE_STRESS_CAP,
  );

  const second = computeRumorMoraleStressDeltas(first.snapshot, {
    simulationSeconds: PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS,
  });
  assert.equal(second.zoneStressDeltas.length, 0);

  const tick = tickPassengerSociety(createPassengerSocietySnapshot(), {
    simulationSeconds: PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS,
    adjacentZones: ringAdjacentZoneIds,
  });
  assert.deepEqual(tick.zoneStressDeltas, []);
});
