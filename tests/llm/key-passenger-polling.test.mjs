import assert from "node:assert/strict";
import test from "node:test";

import {
  KEY_PASSENGER_DAILY_ATTEMPT_LIMIT,
  KEY_PASSENGER_FAILURE_RETRY_BASE_SECONDS,
  KEY_PASSENGER_FAILURE_RETRY_MAX_SECONDS,
  KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS,
  KEY_PASSENGER_GLOBAL_GAP_WALL_MS,
  KEY_PASSENGER_MINIMUM_ROUTINE_SECONDS,
  KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
  KEY_PASSENGER_POLLING_SNAPSHOT_VERSION,
  KeyPassengerPollScheduler,
} from "../../lib/llm/key-passenger-polling.ts";
import {
  DEFAULT_KEY_LLM_PASSENGER_IDS,
} from "../../lib/sim/passengers.ts";

const NO_CUSTOM_ROUTINES = new Map();

function highlight(passengerId, overrides = {}) {
  const index = DEFAULT_KEY_LLM_PASSENGER_IDS.indexOf(passengerId);
  assert.notEqual(index, -1, `unknown test passenger ${passengerId}`);
  return {
    passengerId,
    name: `Passenger ${index + 1}`,
    occupation: `Occupation ${index + 1}`,
    cabinId: `CAB-${String(index + 1).padStart(3, "0")}`,
    zoneId: "A-01",
    zoneCondition: "nominal",
    zoneObservedPressurePa: 101_325,
    zoneObservationAgeSeconds: 30,
    lifeState: "awake",
    physicalHealth: 0.9,
    medicalStability: 0.9,
    psychologicalStability: 0.9,
    stress: 0.1,
    trust: 0.9,
    isKeyLlm: true,
    ...overrides,
  };
}

function publish(
  scheduler,
  highlights,
  sampledAtSimulationSeconds = 0,
) {
  scheduler.observe(sampledAtSimulationSeconds, highlights);
  scheduler.observe(
    sampledAtSimulationSeconds +
      KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
    highlights,
  );
}

function onlyAwake(passengerId, overrides = {}) {
  return DEFAULT_KEY_LLM_PASSENGER_IDS.map((id) =>
    highlight(id, {
      lifeState: id === passengerId ? "awake" : "hibernating",
      ...overrides,
    }),
  );
}

test("observations remain unavailable for 300 seconds and continuous updates cannot starve a pending sample", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];

  scheduler.observe(0, [
    highlight(passengerId, {
      physicalHealth: 0.2,
      name: "Original delayed sample",
      zoneId: "A-18",
      zoneCondition: "critical",
      zoneObservedPressurePa: 74_000,
    }),
  ]);
  for (
    let simulationSeconds = 1;
    simulationSeconds <
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS;
    simulationSeconds += 1
  ) {
    scheduler.observe(simulationSeconds, [
      highlight(passengerId, {
        physicalHealth: 0.99,
        name: "Newer live value",
        zoneId: "B-12",
        zoneCondition: "nominal",
        zoneObservedPressurePa: 101_325,
      }),
    ]);
  }

  assert.equal(
    scheduler.selectNextDue(
      KEY_PASSENGER_OBSERVATION_DELAY_SECONDS - 1,
      0,
      NO_CUSTOM_ROUTINES,
    ),
    null,
  );

  scheduler.observe(KEY_PASSENGER_OBSERVATION_DELAY_SECONDS, [
    highlight(passengerId, {
      physicalHealth: 0.99,
      name: "Newer live value",
      zoneId: "B-12",
      zoneCondition: "nominal",
      zoneObservedPressurePa: 101_325,
    }),
  ]);
  const firstPublished = scheduler.selectNextDue(
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
    0,
    NO_CUSTOM_ROUTINES,
  );
  assert.equal(firstPublished.passengerId, passengerId);
  assert.equal(
    firstPublished.observation.sampledAtSimulationSeconds,
    0,
  );
  assert.equal(
    firstPublished.observation.displayName,
    "Original delayed sample",
  );
  assert.equal(
    firstPublished.observation.physicalHealthBand,
    "critical",
  );
  assert.equal(firstPublished.observation.assignedZoneId, "A-18");
  assert.equal(
    firstPublished.observation.assignedZoneCondition,
    "critical",
  );
  assert.equal(
    firstPublished.observation.observedPressureBand,
    "low",
  );
  assert.equal(
    firstPublished.sampleAgeSeconds,
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
  );

  const afterFirstPublication = scheduler.snapshot();
  assert.equal(
    afterFirstPublication.observations[0].published
      .sampledAtSimulationSeconds,
    0,
  );
  assert.equal(
    afterFirstPublication.observations[0].pending
      .sampledAtSimulationSeconds,
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
  );

  scheduler.observe(
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS * 2 - 1,
    [
      highlight(passengerId, {
        physicalHealth: 0.1,
        name: "Even newer live value",
        zoneId: "A-24",
        zoneCondition: "watch",
        zoneObservedPressurePa: 111_000,
      }),
    ],
  );
  scheduler.observe(KEY_PASSENGER_OBSERVATION_DELAY_SECONDS * 2, [
    highlight(passengerId, {
      physicalHealth: 0.1,
      name: "Even newer live value",
      zoneId: "A-24",
      zoneCondition: "watch",
      zoneObservedPressurePa: 111_000,
    }),
  ]);
  const afterSecondPublication = scheduler.snapshot();
  assert.equal(
    afterSecondPublication.observations[0].published
      .sampledAtSimulationSeconds,
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
  );
  assert.equal(
    afterSecondPublication.observations[0].published.displayName,
    "Newer live value",
  );
  assert.equal(
    afterSecondPublication.observations[0].published
      .physicalHealthBand,
    "stable",
  );
  assert.equal(
    afterSecondPublication.observations[0].published.assignedZoneId,
    "B-12",
  );
  assert.equal(
    afterSecondPublication.observations[0].published
      .observedPressureBand,
    "nominal",
  );
  assert.equal(
    afterSecondPublication.observations[0].pending
      .sampledAtSimulationSeconds,
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS * 2,
  );
});

test("a poll candidate contains one passenger's categorical self-view, never exact physiology or another person's data", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  const otherPassengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[1];
  publish(scheduler, [
    highlight(passengerId, {
      name: "Allowed Own Name",
      occupation: "Allowed Own Occupation",
      cabinId: "OWN-CABIN",
      zoneId: "B-07",
      zoneCondition: "watch",
      zoneObservedPressurePa: 89_999,
      physicalHealth: 0.751234,
      medicalStability: 0.450123,
      psychologicalStability: 0.449876,
      stress: 0.700001,
      trust: 0.699999,
    }),
    highlight(otherPassengerId, {
      name: "OTHER-PERSON-SECRET-NAME",
      occupation: "OTHER-PERSON-SECRET-JOB",
      cabinId: "OTHER-PERSON-SECRET-CABIN",
      physicalHealth: 0.123456,
      medicalStability: 0.234567,
      psychologicalStability: 0.345678,
      stress: 0.456789,
      trust: 0.567891,
    }),
  ]);

  const candidate = scheduler.selectNextDue(
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
    0,
    NO_CUSTOM_ROUTINES,
  );
  assert.deepEqual(candidate, {
    passengerId,
    observation: {
      passengerId,
      sampledAtSimulationSeconds: 0,
      displayName: "Allowed Own Name",
      occupation: "Allowed Own Occupation",
      cabinId: "OWN-CABIN",
      assignedZoneId: "B-07",
      assignedZoneCondition: "watch",
      observedPressureBand: "low",
      lifeState: "awake",
      physicalHealthBand: "stable",
      medicalStabilityBand: "watch",
      psychologicalStabilityBand: "critical",
      stressBand: "high",
      trustBand: "mixed",
    },
    sampleAgeSeconds: KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
    previousOwnNote: null,
  });
  assert.deepEqual(
    Object.keys(candidate.observation).sort(),
    [
      "assignedZoneCondition",
      "assignedZoneId",
      "cabinId",
      "displayName",
      "lifeState",
      "medicalStabilityBand",
      "observedPressureBand",
      "occupation",
      "passengerId",
      "physicalHealthBand",
      "psychologicalStabilityBand",
      "sampledAtSimulationSeconds",
      "stressBand",
      "trustBand",
    ],
  );

  const serialized = JSON.stringify(candidate);
  for (const forbidden of [
    '"physicalHealth":',
    '"medicalStability":',
    '"psychologicalStability":',
    '"stress":',
    '"trust":',
    "0.751234",
    "0.450123",
    "0.449876",
    "0.700001",
    "0.699999",
    otherPassengerId,
    "OTHER-PERSON-SECRET-NAME",
    "OTHER-PERSON-SECRET-JOB",
    "OTHER-PERSON-SECRET-CABIN",
    "0.123456",
    "0.234567",
    "0.345678",
    "0.456789",
    "0.567891",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `candidate leaked ${forbidden}`,
    );
  }
});

test("an offline pressure observation is redacted to unknown without exposing a pressure truth value", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  publish(
    scheduler,
    onlyAwake(passengerId, {
      zoneId: "B-24",
      zoneCondition: "offline",
      zoneObservedPressurePa: null,
      zoneObservationAgeSeconds: null,
    }),
  );

  const candidate = scheduler.selectNextDue(
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
    0,
    NO_CUSTOM_ROUTINES,
  );
  assert.equal(candidate.observation.assignedZoneId, "B-24");
  assert.equal(
    candidate.observation.assignedZoneCondition,
    "offline",
  );
  assert.equal(
    candidate.observation.observedPressureBand,
    "unknown",
  );
  assert.equal(
    JSON.stringify(candidate).includes("zoneObservedPressurePa"),
    false,
  );
});

test("selection skips hibernating, deceased, and non-key telemetry and invokes only an awake fixed passenger", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const awakePassengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[3];
  const highlights = DEFAULT_KEY_LLM_PASSENGER_IDS.map(
    (passengerId, index) =>
      highlight(passengerId, {
        lifeState:
          passengerId === awakePassengerId
            ? "awake"
            : index === 1
              ? "deceased"
              : "hibernating",
        isKeyLlm: index !== 2,
      }),
  );
  publish(scheduler, highlights);

  const candidate = scheduler.selectNextDue(
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS,
    0,
    NO_CUSTOM_ROUTINES,
  );
  assert.equal(candidate.passengerId, awakePassengerId);
  assert.equal(candidate.observation.lifeState, "awake");
});

test("round-robin selection is fair and both simulation and wall-clock global gaps are mandatory", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const highlights = DEFAULT_KEY_LLM_PASSENGER_IDS.map((passengerId) =>
    highlight(passengerId),
  );
  publish(scheduler, highlights);

  let simulationSeconds =
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS;
  let wallEpochMs = 100_000;
  const selectedIds = [];

  const first = scheduler.selectNextDue(
    simulationSeconds,
    wallEpochMs,
    NO_CUSTOM_ROUTINES,
  );
  assert.equal(first.passengerId, DEFAULT_KEY_LLM_PASSENGER_IDS[0]);
  selectedIds.push(first.passengerId);
  scheduler.markDispatched(
    first.passengerId,
    simulationSeconds,
    wallEpochMs,
  );

  assert.equal(
    scheduler.selectNextDue(
      simulationSeconds +
        KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS -
        1,
      wallEpochMs + KEY_PASSENGER_GLOBAL_GAP_WALL_MS,
      NO_CUSTOM_ROUTINES,
    ),
    null,
    "simulation-time gap must not be bypassed",
  );
  assert.equal(
    scheduler.selectNextDue(
      simulationSeconds +
        KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS,
      wallEpochMs + KEY_PASSENGER_GLOBAL_GAP_WALL_MS - 1,
      NO_CUSTOM_ROUTINES,
    ),
    null,
    "wall-clock gap must not be bypassed",
  );

  for (
    let index = 1;
    index < DEFAULT_KEY_LLM_PASSENGER_IDS.length;
    index += 1
  ) {
    simulationSeconds += KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS;
    wallEpochMs += KEY_PASSENGER_GLOBAL_GAP_WALL_MS;
    const candidate = scheduler.selectNextDue(
      simulationSeconds,
      wallEpochMs,
      NO_CUSTOM_ROUTINES,
    );
    assert.equal(
      candidate.passengerId,
      DEFAULT_KEY_LLM_PASSENGER_IDS[index],
    );
    selectedIds.push(candidate.passengerId);
    scheduler.markDispatched(
      candidate.passengerId,
      simulationSeconds,
      wallEpochMs,
    );
  }

  assert.deepEqual(selectedIds, DEFAULT_KEY_LLM_PASSENGER_IDS);
  simulationSeconds += KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS;
  wallEpochMs += KEY_PASSENGER_GLOBAL_GAP_WALL_MS;
  assert.equal(
    scheduler.selectNextDue(
      simulationSeconds,
      wallEpochMs,
      NO_CUSTOM_ROUTINES,
    ).passengerId,
    DEFAULT_KEY_LLM_PASSENGER_IDS[0],
  );
});

test("a passenger cannot reduce its successful routine below six hours, while a longer configured routine remains effective", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  publish(scheduler, onlyAwake(passengerId));

  const firstSimulationSeconds =
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS;
  const first = scheduler.selectNextDue(
    firstSimulationSeconds,
    0,
    new Map([[passengerId, 1]]),
  );
  assert.equal(first.passengerId, passengerId);
  scheduler.markDispatched(
    passengerId,
    firstSimulationSeconds,
    0,
  );
  scheduler.markSucceeded(
    passengerId,
    firstSimulationSeconds,
    "routine completed",
  );

  assert.equal(
    scheduler.selectNextDue(
      firstSimulationSeconds +
        KEY_PASSENGER_MINIMUM_ROUTINE_SECONDS -
        1,
      KEY_PASSENGER_GLOBAL_GAP_WALL_MS,
      new Map([[passengerId, 1]]),
    ),
    null,
  );
  assert.equal(
    scheduler.selectNextDue(
      firstSimulationSeconds +
        KEY_PASSENGER_MINIMUM_ROUTINE_SECONDS,
      KEY_PASSENGER_GLOBAL_GAP_WALL_MS,
      new Map([[passengerId, 1]]),
    ).passengerId,
    passengerId,
  );

  const eightHours = 8 * 60 * 60;
  assert.equal(
    scheduler.selectNextDue(
      firstSimulationSeconds + eightHours - 1,
      KEY_PASSENGER_GLOBAL_GAP_WALL_MS,
      new Map([[passengerId, eightHours]]),
    ),
    null,
  );
  assert.equal(
    scheduler.selectNextDue(
      firstSimulationSeconds + eightHours,
      KEY_PASSENGER_GLOBAL_GAP_WALL_MS,
      new Map([[passengerId, eightHours]]),
    ).passengerId,
    passengerId,
  );
});

test("the global scheduler enforces exactly 64 attempts per simulation day and resets only on the next day", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const highlights = DEFAULT_KEY_LLM_PASSENGER_IDS.map((passengerId) =>
    highlight(passengerId),
  );
  publish(scheduler, highlights);

  for (
    let attempt = 0;
    attempt < KEY_PASSENGER_DAILY_ATTEMPT_LIMIT;
    attempt += 1
  ) {
    const simulationSeconds =
      KEY_PASSENGER_OBSERVATION_DELAY_SECONDS +
      attempt * KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS;
    const wallEpochMs =
      attempt * KEY_PASSENGER_GLOBAL_GAP_WALL_MS;
    const candidate = scheduler.selectNextDue(
      simulationSeconds,
      wallEpochMs,
      NO_CUSTOM_ROUTINES,
    );
    assert.equal(
      candidate.passengerId,
      DEFAULT_KEY_LLM_PASSENGER_IDS[
        attempt % DEFAULT_KEY_LLM_PASSENGER_IDS.length
      ],
    );
    scheduler.markDispatched(
      candidate.passengerId,
      simulationSeconds,
      wallEpochMs,
    );
  }

  assert.equal(
    scheduler.snapshot().attemptsInBudgetDay,
    KEY_PASSENGER_DAILY_ATTEMPT_LIMIT,
  );
  const sameDaySimulationSeconds =
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS +
    KEY_PASSENGER_DAILY_ATTEMPT_LIMIT *
      KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS;
  const nextWallEpochMs =
    KEY_PASSENGER_DAILY_ATTEMPT_LIMIT *
    KEY_PASSENGER_GLOBAL_GAP_WALL_MS;
  assert.equal(
    scheduler.selectNextDue(
      sameDaySimulationSeconds,
      nextWallEpochMs,
      NO_CUSTOM_ROUTINES,
    ),
    null,
  );
  assert.throws(
    () =>
      scheduler.markDispatched(
        DEFAULT_KEY_LLM_PASSENGER_IDS[0],
        sameDaySimulationSeconds,
        nextWallEpochMs,
      ),
    /daily attempt budget exhausted/,
  );

  const nextDay = 86_400;
  const nextDayCandidate = scheduler.selectNextDue(
    nextDay,
    nextWallEpochMs,
    NO_CUSTOM_ROUTINES,
  );
  assert.equal(
    nextDayCandidate.passengerId,
    DEFAULT_KEY_LLM_PASSENGER_IDS[0],
  );
  assert.equal(scheduler.snapshot().attemptsInBudgetDay, 0);
});

test("failed polls use exponential simulation-time backoff capped at six hours", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  publish(scheduler, onlyAwake(passengerId));

  let failureSimulationSeconds =
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS;
  let wallEpochMs = 0;
  const expectedDelays = [
    KEY_PASSENGER_FAILURE_RETRY_BASE_SECONDS,
    KEY_PASSENGER_FAILURE_RETRY_BASE_SECONDS * 2,
    KEY_PASSENGER_FAILURE_RETRY_BASE_SECONDS * 4,
    KEY_PASSENGER_FAILURE_RETRY_BASE_SECONDS * 8,
    KEY_PASSENGER_FAILURE_RETRY_MAX_SECONDS,
    KEY_PASSENGER_FAILURE_RETRY_MAX_SECONDS,
  ];

  for (
    let failureIndex = 0;
    failureIndex < expectedDelays.length;
    failureIndex += 1
  ) {
    const candidate = scheduler.selectNextDue(
      failureSimulationSeconds,
      wallEpochMs,
      NO_CUSTOM_ROUTINES,
    );
    assert.equal(candidate.passengerId, passengerId);
    scheduler.markDispatched(
      passengerId,
      failureSimulationSeconds,
      wallEpochMs,
    );
    scheduler.markFailed(passengerId, failureSimulationSeconds);

    const expectedRetry =
      failureSimulationSeconds + expectedDelays[failureIndex];
    const schedule = scheduler
      .snapshot()
      .schedules.find((entry) => entry.passengerId === passengerId);
    assert.equal(schedule.consecutiveFailures, failureIndex + 1);
    assert.equal(
      schedule.nextRetrySimulationSeconds,
      expectedRetry,
    );
    assert.equal(
      scheduler.selectNextDue(
        expectedRetry - 1,
        wallEpochMs + KEY_PASSENGER_GLOBAL_GAP_WALL_MS,
        NO_CUSTOM_ROUTINES,
      ),
      null,
    );

    failureSimulationSeconds = expectedRetry;
    wallEpochMs += KEY_PASSENGER_GLOBAL_GAP_WALL_MS;
  }
});

test("snapshot and restore retain a private note only for its owning passenger", () => {
  const scheduler = new KeyPassengerPollScheduler();
  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  publish(scheduler, onlyAwake(passengerId));

  const simulationSeconds =
    KEY_PASSENGER_OBSERVATION_DELAY_SECONDS;
  scheduler.markDispatched(passengerId, simulationSeconds, 0);
  scheduler.markSucceeded(
    passengerId,
    simulationSeconds,
    "  Own private note: cabin noise disturbed my sleep.  ",
  );

  const snapshot = scheduler.snapshot();
  const ownerIndex =
    DEFAULT_KEY_LLM_PASSENGER_IDS.indexOf(passengerId);
  assert.equal(
    snapshot.schedules[ownerIndex].previousOwnNote,
    "Own private note: cabin noise disturbed my sleep.",
  );
  assert.equal(
    snapshot.schedules
      .filter((schedule) => schedule.previousOwnNote !== null)
      .length,
    1,
  );
  assert.equal(
    snapshot.observations.some(
      (slot) =>
        JSON.stringify(slot).includes("Own private note"),
    ),
    false,
  );

  const restored = KeyPassengerPollScheduler.restore(snapshot);
  assert.deepEqual(restored.listPrivateNotes(), [
    {
      passengerId,
      createdAtSimulationSeconds: simulationSeconds,
      text: "Own private note: cabin noise disturbed my sleep.",
    },
  ]);
  const nextOwnPoll = restored.selectNextDue(
    simulationSeconds + KEY_PASSENGER_MINIMUM_ROUTINE_SECONDS,
    KEY_PASSENGER_GLOBAL_GAP_WALL_MS,
    new Map([[passengerId, 1]]),
  );
  assert.equal(nextOwnPoll.passengerId, passengerId);
  assert.equal(
    nextOwnPoll.previousOwnNote,
    "Own private note: cabin noise disturbed my sleep.",
  );
});

test("restore rejects corrupted snapshots and any observation or schedule slot that no longer matches the fixed roster", () => {
  const scheduler = new KeyPassengerPollScheduler();
  publish(scheduler, [
    highlight(DEFAULT_KEY_LLM_PASSENGER_IDS[0]),
  ]);
  const valid = scheduler.snapshot();
  assert.equal(
    valid.snapshotVersion,
    KEY_PASSENGER_POLLING_SNAPSHOT_VERSION,
  );

  const legacyVersion = structuredClone(valid);
  legacyVersion.snapshotVersion = 1;
  assert.throws(
    () => KeyPassengerPollScheduler.restore(legacyVersion),
    /unsupported key-passenger polling snapshot/,
  );

  const invalidCursor = structuredClone(valid);
  invalidCursor.roundRobinCursor =
    DEFAULT_KEY_LLM_PASSENGER_IDS.length;
  assert.throws(
    () => KeyPassengerPollScheduler.restore(invalidCursor),
    /round-robin cursor/,
  );

  const misplacedObservations = structuredClone(valid);
  [
    misplacedObservations.observations[0],
    misplacedObservations.observations[1],
  ] = [
    misplacedObservations.observations[1],
    misplacedObservations.observations[0],
  ];
  assert.throws(
    () => KeyPassengerPollScheduler.restore(misplacedObservations),
    /fixed roster order/,
  );

  const misplacedSchedule = structuredClone(valid);
  misplacedSchedule.schedules[0].passengerId =
    DEFAULT_KEY_LLM_PASSENGER_IDS[1];
  assert.throws(
    () => KeyPassengerPollScheduler.restore(misplacedSchedule),
    /fixed roster order/,
  );

  const stalePending = structuredClone(valid);
  stalePending.observations[0].pending.sampledAtSimulationSeconds =
    stalePending.observations[0].published
      .sampledAtSimulationSeconds;
  assert.throws(
    () => KeyPassengerPollScheduler.restore(stalePending),
    /pending key-passenger observation must be newer/,
  );

  const oversizedPrivateNote = structuredClone(valid);
  oversizedPrivateNote.schedules[0].previousOwnNote = "x".repeat(
    513,
  );
  assert.throws(
    () => KeyPassengerPollScheduler.restore(oversizedPrivateNote),
    /invalid retained state/,
  );

  const missingFixedSlot = structuredClone(valid);
  missingFixedSlot.schedules.pop();
  assert.throws(
    () => KeyPassengerPollScheduler.restore(missingFixedSlot),
    /preserve all 32 fixed slots/,
  );

  const invalidAssignedZone = structuredClone(valid);
  invalidAssignedZone.observations[0].published.assignedZoneId =
    "C-99";
  assert.throws(
    () => KeyPassengerPollScheduler.restore(invalidAssignedZone),
    /published is invalid/,
  );

  const invalidZoneCondition = structuredClone(valid);
  invalidZoneCondition.observations[0].published.assignedZoneCondition =
    "healthy";
  assert.throws(
    () => KeyPassengerPollScheduler.restore(invalidZoneCondition),
    /published is invalid/,
  );

  const invalidPressureBand = structuredClone(valid);
  invalidPressureBand.observations[0].published.observedPressureBand =
    "vacuum";
  assert.throws(
    () => KeyPassengerPollScheduler.restore(invalidPressureBand),
    /published is invalid/,
  );

  const leakedTruthField = structuredClone(valid);
  leakedTruthField.observations[0].published.zoneTruthPressurePa =
    101_325;
  assert.throws(
    () => KeyPassengerPollScheduler.restore(leakedTruthField),
    /published is invalid/,
  );
});
