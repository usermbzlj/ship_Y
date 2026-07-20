import assert from "node:assert/strict";
import test from "node:test";

import {
  CREW_COUNT,
  DEFAULT_KEY_LLM_COUNT,
  DEFAULT_KEY_LLM_PASSENGER_IDS,
  PASSENGER_COUNT,
  PERSON_COUNT,
  PassengerSimulation,
} from "../../lib/sim/passengers.ts";

test("deterministically creates the closed 2,120-person manifest", () => {
  const first = new PassengerSimulation("manifest-seed-7");
  const second = new PassengerSimulation("manifest-seed-7");
  const people = first.getAllPassengers();

  assert.equal(people.length, PERSON_COUNT);
  assert.equal(
    people.filter((person) => person.kind === "passenger").length,
    PASSENGER_COUNT,
  );
  assert.equal(
    people.filter((person) => person.kind === "crew").length,
    CREW_COUNT,
  );
  assert.equal(
    people.filter((person) => person.isKeyLlm).length,
    DEFAULT_KEY_LLM_COUNT,
  );
  assert.deepEqual(
    first.getKeyLlmPassengers().map((person) => person.id),
    DEFAULT_KEY_LLM_PASSENGER_IDS,
  );
  assert.equal(first.serialize(), second.serialize());

  const sample = first.getPassenger("passenger-0001");
  assert.ok(sample.name.length > 0);
  assert.ok(sample.cabinId.length > 0);
  assert.ok(sample.skills.length >= 2);
  assert.equal(sample.relationshipIds.length, 3);
  for (const relatedId of sample.relationshipIds) {
    assert.ok(
      first.getPassenger(relatedId).relationshipIds.includes(sample.id),
    );
  }
});

test("population averages are derived exactly from living roster individuals", () => {
  const simulation = new PassengerSimulation("population-average-seed");
  simulation.applyPassengerIncident({
    eventId: "evt.population-average-fatality.0001",
    summary: "用于验证死亡乘员不再进入存活人口均值。",
    targetPassengerIds: ["passenger-0001"],
    fatal: true,
  });
  const living = simulation
    .getAllPassengers()
    .filter((person) => person.lifeState !== "deceased");
  const summary = simulation.getPopulationSummary();

  assert.equal(
    summary.averageHealth,
    living.reduce((total, person) => total + person.health.physical, 0) /
      living.length,
  );
  assert.equal(
    summary.averageMorale,
    living.reduce(
      (total, person) => total + person.psychology.stability,
      0,
    ) / living.length,
  );

  const emptySnapshot = simulation.snapshot();
  emptySnapshot.activeTransitions = [];
  for (const person of emptySnapshot.passengers) {
    person.lifeState = "deceased";
    person.health.physical = 0;
    person.hibernationPodId = null;
  }
  const emptySummary = PassengerSimulation.restore(
    emptySnapshot,
  ).getPopulationSummary();
  assert.equal(emptySummary.averageHealth, 0);
  assert.equal(emptySummary.averageMorale, 0);
});

test("journey representatives are deterministic, unique, stratified, and incident-aware", () => {
  const simulation = new PassengerSimulation("representative-seed");
  const incidentPassengerId = "passenger-1777";
  simulation.applyPassengerIncident({
    eventId: "evt.representative-major-incident.0001",
    eventType: "major-pressure-loss",
    summary: "一次重大失压事故成为该乘员最鲜明的航程记忆。",
    targetPassengerIds: [incidentPassengerId],
    healthImpact: { physical: -0.1 },
    psychologyImpact: { stability: -0.15, stress: 0.2 },
    valence: -0.95,
    salience: 1,
    confidence: 1,
  });

  const first = simulation.getJourneyRepresentativePassengers();
  const second = simulation.getJourneyRepresentativePassengers(6);
  const ids = first.map((person) => person.id);
  assert.deepEqual(second, first);
  assert.equal(first.length, 6);
  assert.equal(new Set(ids).size, first.length);
  assert.ok(first.some((person) => person.kind === "crew"));
  assert.ok(first.some((person) => person.kind === "passenger"));
  assert.ok(ids.includes(incidentPassengerId));
  assert.ok(
    first.some((person) => !person.isKeyLlm),
    "representatives must not be limited to the first key-LLM slots",
  );

  const experienceAverage = (person) =>
    Object.values(person.experience).reduce(
      (total, value) => total + value,
      0,
    ) / Object.keys(person.experience).length;
  const experienceOrder = simulation.getAllPassengers().sort(
    (left, right) =>
      experienceAverage(left) - experienceAverage(right) ||
      left.id.localeCompare(right.id),
  );
  assert.ok(ids.includes(experienceOrder[0].id));
  assert.ok(ids.includes(experienceOrder.at(-1).id));
  assert.equal(
    first
      .find((person) => person.id === incidentPassengerId)
      .memories.some(
        (memory) =>
          memory.incident?.eventId ===
          "evt.representative-major-incident.0001",
      ),
    true,
  );
});

test("snapshot and restore preserve every passenger and active transition", () => {
  const original = new PassengerSimulation("restore-seed");
  const podId = original.getAvailablePodIds(1)[0];
  original.scheduleHibernationTransition({
    passengerId: "passenger-0001",
    action: "hibernate",
    startAtMicroseconds: 10_000_000,
    podId,
    durations: { inductionSeconds: 2 },
  });
  original.advanceBySeconds(10);

  const restored = PassengerSimulation.restore(original.serialize());
  assert.equal(restored.serialize(), original.serialize());
  assert.deepEqual(restored.advanceBySeconds(2), original.advanceBySeconds(2));
  assert.equal(restored.serialize(), original.serialize());
});

test("hibernate follows scheduled to induction to hibernating and reserves a pod", () => {
  const simulation = new PassengerSimulation("sleep-seed");
  const podId = simulation.getAvailablePodIds(1)[0];
  const transition = simulation.scheduleHibernationTransition({
    passengerId: "passenger-0001",
    action: "hibernate",
    startAtMicroseconds: 5_000_000,
    podId,
    durations: { inductionSeconds: 3 },
  });

  assert.equal(transition.phase, "scheduled");
  assert.ok(!simulation.getAvailablePodIds().includes(podId));
  assert.deepEqual(simulation.advanceBySeconds(4), []);
  assert.equal(simulation.getPassenger("passenger-0001").lifeState, "awake");

  const induction = simulation.advanceBySeconds(1);
  assert.equal(induction[0].to, "induction");
  assert.equal(simulation.getPassenger("passenger-0001").lifeState, "awake");

  const completed = simulation.advanceBySeconds(3);
  assert.equal(completed[0].to, "hibernating");
  assert.equal(
    simulation.getPassenger("passenger-0001").hibernationPodId,
    podId,
  );
  assert.equal(simulation.getActiveTransitions().length, 0);
});

test("wake follows scheduled to waking to recovery to awake", () => {
  const simulation = new PassengerSimulation("wake-seed");
  const sleeping = simulation.getPassenger("passenger-0133");
  assert.equal(sleeping.lifeState, "hibernating");
  assert.ok(sleeping.hibernationPodId);

  simulation.scheduleHibernationTransition({
    passengerId: sleeping.id,
    action: "wake",
    startAtMicroseconds: 0,
    durations: { wakingSeconds: 3, recoverySeconds: 4 },
  });
  assert.equal(simulation.advanceBySeconds(0)[0].to, "waking");
  assert.equal(simulation.advanceBySeconds(3)[0].to, "recovery");
  assert.equal(simulation.getPassenger(sleeping.id).lifeState, "hibernating");
  assert.equal(simulation.advanceBySeconds(4)[0].to, "awake");
  assert.equal(simulation.getPassenger(sleeping.id).lifeState, "awake");
  assert.equal(simulation.getPassenger(sleeping.id).hibernationPodId, null);
});

test("hibernation medical phases consume powered service time rather than wall time", () => {
  const simulation = new PassengerSimulation(
    "powered-hibernation-seed",
  );
  const sleeping = simulation.getPassenger("passenger-0133");
  simulation.scheduleHibernationTransition({
    passengerId: sleeping.id,
    action: "wake",
    startAtMicroseconds: 0,
    durations: { wakingSeconds: 60, recoverySeconds: 60 },
  });

  assert.equal(
    simulation.advanceTo(0, {
      hibernationServiceFraction: () => 0,
    })[0].to,
    "waking",
  );
  assert.deepEqual(
    simulation.advanceTo(120_000_000, {
      hibernationServiceFraction: () => 0,
    }),
    [],
  );
  assert.equal(
    simulation.getPassenger(sleeping.id).lifeState,
    "hibernating",
  );
  assert.equal(
    simulation.getActiveTransitions()[0].phaseEndsAtMicroseconds,
    180_000_000,
    "zero service must preserve all sixty powered seconds of waking work",
  );

  assert.deepEqual(
    simulation.advanceTo(180_000_000, {
      hibernationServiceFraction: () => 0.5,
    }),
    [],
    "sixty wall seconds at half service perform only thirty powered seconds",
  );
  assert.equal(
    simulation.getActiveTransitions()[0].phaseEndsAtMicroseconds,
    210_000_000,
  );
  const wakingComplete = simulation.advanceTo(240_000_000, {
    hibernationServiceFraction: () => 0.5,
  });
  assert.equal(wakingComplete[0].to, "recovery");
  assert.equal(
    simulation.getPassenger(sleeping.id).lifeState,
    "hibernating",
  );

  const recoveryComplete = simulation.advanceTo(300_000_000, {
    hibernationServiceFraction: () => 1,
  });
  assert.equal(recoveryComplete[0].to, "awake");
  assert.equal(
    simulation.getPassenger(sleeping.id).lifeState,
    "awake",
  );
});

test("powered hibernation progress survives snapshot restore", () => {
  const simulation = new PassengerSimulation(
    "powered-hibernation-restore",
  );
  simulation.scheduleHibernationTransition({
    passengerId: "passenger-0133",
    action: "wake",
    startAtMicroseconds: 0,
    durations: { wakingSeconds: 120, recoverySeconds: 30 },
  });
  simulation.advanceTo(0);
  simulation.advanceTo(90_000_000, {
    hibernationServiceFraction: () => 1 / 3,
  });

  const restored = PassengerSimulation.restore(
    simulation.snapshot(),
  );
  const hooks = {
    hibernationServiceFraction: () => 0.5,
  };
  assert.deepEqual(
    restored.advanceTo(270_000_000, hooks),
    simulation.advanceTo(270_000_000, hooks),
  );
  assert.equal(restored.serialize(), simulation.serialize());
});

test("hibernation banks consume local ride-through, persist dose, and recharge causally", () => {
  const simulation = new PassengerSimulation(
    "hibernation-bank-power",
  );
  const first = simulation.advanceHibernationPower(1_200, {
    a: 0,
    b: 1,
  });
  assert.equal(
    first.effectiveServiceFractionByBank.a,
    0.75,
  );
  assert.equal(
    first.effectiveServiceFractionByBank.b,
    1,
  );
  assert.deepEqual(first.crossedIncidentThresholds, []);
  const afterFirst = simulation.getHibernationPowerBanks();
  assert.deepEqual(
    afterFirst.find((bank) => bank.bankId === "a"),
    {
      bankId: "a",
      reserveSeconds: 0,
      unprotectedDoseSeconds: 300,
      outageSequence: 1,
      highestIncidentLevel: 0,
      lastFeederServiceFraction: 0,
    },
  );

  const second = simulation.advanceHibernationPower(1_500, {
    a: 0,
    b: 1,
  });
  assert.deepEqual(second.crossedIncidentThresholds, [
    {
      bankId: "a",
      outageSequence: 1,
      level: 1,
      unprotectedDoseSeconds: 1_800,
    },
  ]);
  const restored = PassengerSimulation.restore(
    simulation.snapshot(),
  );
  assert.deepEqual(
    restored.getHibernationPowerBanks(),
    simulation.getHibernationPowerBanks(),
  );

  restored.advanceHibernationPower(3_600, { a: 1, b: 1 });
  const recovered = restored
    .getHibernationPowerBanks()
    .find((bank) => bank.bankId === "a");
  assert.equal(recovered.reserveSeconds, 900);
  assert.equal(recovered.unprotectedDoseSeconds, 0);
  assert.equal(recovered.highestIncidentLevel, 0);
});

test("transition scheduling rejects wrong states, pods, and double booking", () => {
  const simulation = new PassengerSimulation("validation-seed");
  const occupiedPod = simulation.getPassenger(
    "passenger-0133",
  ).hibernationPodId;
  assert.ok(occupiedPod);

  assert.throws(
    () =>
      simulation.scheduleHibernationTransition({
        passengerId: "passenger-0001",
        action: "hibernate",
        startAtMicroseconds: 0,
        podId: occupiedPod,
      }),
    /unavailable/,
  );
  assert.throws(
    () =>
      simulation.scheduleHibernationTransition({
        passengerId: "passenger-0133",
        action: "hibernate",
        startAtMicroseconds: 0,
        podId: simulation.getAvailablePodIds(1)[0],
      }),
    /incompatible/,
  );

  simulation.scheduleHibernationTransition({
    passengerId: "passenger-0133",
    action: "wake",
    startAtMicroseconds: 0,
  });
  assert.throws(
    () =>
      simulation.scheduleHibernationTransition({
        passengerId: "passenger-0133",
        action: "wake",
        startAtMicroseconds: 1,
      }),
    /already has an active transition/,
  );
});

test("event memories shape a multi-paragraph subjective evaluation without a score", () => {
  const simulation = new PassengerSimulation("experience-seed");
  const before = simulation.getPassenger("passenger-0001");
  const memory = simulation.recordPassengerEvent("passenger-0001", {
    eventType: "forced-lockdown",
    summary: "事故期间被长时间限制在居住舱，但及时获得了完整说明。",
    valence: -0.55,
    salience: 0.95,
    confidence: 0.9,
    experienceImpact: {
      freedom: -0.3,
      trust: -0.08,
      transparency: 0.15,
      safety: 0.05,
    },
  });
  const after = simulation.getPassenger("passenger-0001");

  assert.equal(after.memories.at(-1).id, memory.id);
  assert.ok(after.experience.freedom < before.experience.freedom);
  assert.ok(after.experience.transparency > before.experience.transparency);

  const evaluation = simulation.getJourneyEvaluation("passenger-0001");
  assert.equal(evaluation.split("\n\n").length, 3);
  assert.match(evaluation, /安全感/);
  assert.match(evaluation, /个人自由/);
  assert.match(evaluation, /信息透明度/);
  assert.match(evaluation, /休眠流程/);
  assert.doesNotMatch(evaluation, /总分|评分：|\d+\/100/);
});

test("batch incidents apply in stable ID order, clamp state, and survive restore idempotently", () => {
  const simulation = new PassengerSimulation("incident-seed");
  const input = {
    eventId: "evt.coolant-leak.0001",
    eventType: "coolant-exposure",
    summary: "冷却剂泄漏导致短时暴露，医疗组完成处置。",
    targetPassengerIds: [
      "passenger-0002",
      "crew-0001",
      "passenger-0001",
    ],
    healthImpact: {
      physical: -0.2,
      resilience: -0.1,
      chronicRisk: 0.95,
    },
    psychologyImpact: {
      stability: -0.9,
      stress: 0.95,
    },
    experienceImpact: {
      safety: -0.9,
      trust: 0.8,
      transparency: 0.15,
    },
    valence: -0.72,
    salience: 0.94,
    confidence: 0.88,
  };
  const before = new Map(
    input.targetPassengerIds.map((id) => [id, simulation.getPassenger(id)]),
  );

  const applied = simulation.applyPassengerIncident(input);
  assert.deepEqual(
    applied.outcomes.map((outcome) => outcome.passengerId),
    ["crew-0001", "passenger-0001", "passenger-0002"],
  );
  assert.deepEqual(
    applied.outcomes.map((outcome) => outcome.status),
    ["applied", "applied", "applied"],
  );
  assert.deepEqual(
    applied.outcomes.map((outcome) => Number(outcome.memoryId.slice(-6))),
    applied.outcomes.map(
      (_, index) =>
        Number(applied.outcomes[0].memoryId.slice(-6)) + index,
    ),
  );

  for (const outcome of applied.outcomes) {
    const previous = before.get(outcome.passengerId);
    const person = simulation.getPassenger(outcome.passengerId);
    const memory = person.memories.at(-1);
    assert.equal(
      person.health.physical,
      Math.max(0, previous.health.physical - 0.2),
    );
    assert.equal(
      person.health.resilience,
      Math.max(0, previous.health.resilience - 0.1),
    );
    assert.equal(person.health.chronicRisk, 1);
    assert.equal(person.psychology.stability, 0);
    assert.equal(person.psychology.stress, 1);
    assert.equal(person.experience.safety, 0);
    assert.equal(person.experience.trust, 1);
    assert.equal(memory.id, outcome.memoryId);
    assert.equal(memory.incident.eventId, input.eventId);
    assert.deepEqual(memory.incident.healthImpact, input.healthImpact);
    assert.deepEqual(
      memory.incident.psychologyImpact,
      input.psychologyImpact,
    );
    assert.equal(memory.incident.causedDeath, false);
  }

  const serializedAfterFirstApplication = simulation.serialize();
  const replay = simulation.applyPassengerIncident(input);
  assert.deepEqual(
    replay.outcomes.map((outcome) => outcome.status),
    ["already-applied", "already-applied", "already-applied"],
  );
  assert.equal(simulation.serialize(), serializedAfterFirstApplication);

  const restored = PassengerSimulation.restore(serializedAfterFirstApplication);
  assert.deepEqual(
    restored.applyPassengerIncident(input).outcomes.map(
      (outcome) => outcome.status,
    ),
    ["already-applied", "already-applied", "already-applied"],
  );
  assert.equal(restored.serialize(), serializedAfterFirstApplication);
});

test("batch incident validation is atomic for bad targets, ranges, and event collisions", () => {
  const simulation = new PassengerSimulation("incident-atomic-seed");
  const beforeUnknownTarget = simulation.serialize();
  assert.throws(
    () =>
      simulation.applyPassengerIncident({
        eventId: "evt.invalid-target.0001",
        summary: "目标清单含有不存在的乘员。",
        targetPassengerIds: ["passenger-0001", "passenger-9999"],
        healthImpact: { physical: -0.1 },
      }),
    /unknown passenger/,
  );
  assert.equal(simulation.serialize(), beforeUnknownTarget);

  const beforeInvalidRange = simulation.serialize();
  assert.throws(
    () =>
      simulation.applyPassengerIncident({
        eventId: "evt.invalid-range.0001",
        summary: "非法强度不得进入乘员状态。",
        targetPassengerIds: ["passenger-0001"],
        psychologyImpact: { stress: 1.01 },
      }),
    /between -1 and 1/,
  );
  assert.equal(simulation.serialize(), beforeInvalidRange);

  simulation.applyPassengerIncident({
    eventId: "evt.audit-collision.0001",
    summary: "首次记录的事故摘要。",
    targetPassengerIds: ["passenger-0001"],
    healthImpact: { physical: -0.05 },
  });
  const beforeCollision = simulation.serialize();
  assert.throws(
    () =>
      simulation.applyPassengerIncident({
        eventId: "evt.audit-collision.0001",
        summary: "试图用相同事件编号改写事故。",
        targetPassengerIds: ["passenger-0001", "passenger-0002"],
        healthImpact: { physical: -0.2 },
      }),
    /eventId collision/,
  );
  assert.equal(simulation.serialize(), beforeCollision);
  assert.equal(
    simulation
      .getPassenger("passenger-0002")
      .memories.some(
        (memory) =>
          memory.incident?.eventId === "evt.audit-collision.0001",
      ),
    false,
  );
});

test("fatal incidents cancel transitions, release pods, and reject new postmortem effects", () => {
  const simulation = new PassengerSimulation("incident-fatal-seed");
  const passengerId = "passenger-0001";
  const podId = simulation.getAvailablePodIds(1)[0];
  const transition = simulation.scheduleHibernationTransition({
    passengerId,
    action: "hibernate",
    startAtMicroseconds: 5_000_000,
    podId,
  });

  const result = simulation.applyPassengerIncident({
    eventId: "evt.fatal-decompression.0001",
    eventType: "fatal-decompression",
    summary: "爆炸性失压超出个体防护与医疗救治能力。",
    targetPassengerIds: [passengerId],
    healthImpact: { physical: -0.4 },
    psychologyImpact: { stress: 1 },
    experienceImpact: { safety: -1 },
    valence: -1,
    salience: 1,
    confidence: 1,
    fatal: true,
  });
  const outcome = result.outcomes[0];
  const person = simulation.getPassenger(passengerId);
  assert.equal(outcome.causedDeath, true);
  assert.equal(outcome.cancelledTransitionId, transition.id);
  assert.equal(outcome.releasedPodId, podId);
  assert.equal(person.lifeState, "deceased");
  assert.equal(person.health.physical, 0);
  assert.equal(person.hibernationPodId, null);
  assert.equal(simulation.getActiveTransitions().length, 0);
  assert.ok(simulation.getAvailablePodIds().includes(podId));

  const beforePostmortemAttempt = simulation.serialize();
  assert.throws(
    () =>
      simulation.applyPassengerIncident({
        eventId: "evt.postmortem.0001",
        summary: "死亡后不得继续累积主观状态。",
        targetPassengerIds: [passengerId, "passenger-0002"],
        psychologyImpact: { stress: 0.1 },
      }),
    /deceased passenger/,
  );
  assert.equal(simulation.serialize(), beforePostmortemAttempt);
  assert.equal(
    simulation
      .getPassenger("passenger-0002")
      .memories.some(
        (memory) => memory.incident?.eventId === "evt.postmortem.0001",
      ),
    false,
  );
  assert.equal(
    PassengerSimulation.restore(simulation.serialize()).serialize(),
    simulation.serialize(),
  );
});

test("restore rejects attempts to replace the fixed key-LLM roster", () => {
  const simulation = new PassengerSimulation("llm-roster-seed");
  const snapshot = simulation.snapshot();
  const fixed = snapshot.passengers.find(
    (person) => person.id === DEFAULT_KEY_LLM_PASSENGER_IDS[0],
  );
  const replacement = snapshot.passengers.find(
    (person) => person.id === "passenger-0100",
  );
  fixed.isKeyLlm = false;
  fixed.keyLlmSlot = null;
  replacement.isKeyLlm = true;
  replacement.keyLlmSlot = 1;

  assert.throws(
    () => PassengerSimulation.restore(snapshot),
    /fixed key-LLM slot|exactly 32/,
  );
});
