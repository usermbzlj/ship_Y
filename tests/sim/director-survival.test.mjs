import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SimulationTimeDirector,
  TIME_SCALE_PRESETS,
  MAX_OWED_SIM_SECONDS,
  nearestTimeScalePreset,
} from "../../lib/sim/director.ts";
import { ProceduralWorldScheduler } from "../../lib/sim/procedural-world.ts";
import {
  applyRationAndStarvation,
  doseRateForTier,
  integrateHazardDose,
  rationFoodDemandKg,
} from "../../lib/sim/survival.ts";

describe("SimulationTimeDirector", () => {
  it("acquires and releases pause tokens without dropping owed debt", () => {
    const director = new SimulationTimeDirector(1800);
    assert.equal(director.acquirePauseToken("ui"), true);
    assert.equal(director.acquirePauseToken("ui"), false);
    assert.equal(director.isPaused, true);

    const plan = director.planHeartbeat(1);
    assert.equal(plan.wallSecondsToRun, 0);
    assert.equal(plan.paused, true);

    director.releasePauseToken("ui");
    assert.equal(director.isPaused, false);
  });

  it("banks fidelity shortfall as owed sim seconds and drains it later", () => {
    const director = new SimulationTimeDirector(1800);
    const plan = director.planHeartbeat(1);
    assert.equal(plan.wallSecondsToRun, 1);

    // Fidelity clamped effective scale to 60× instead of 1800×.
    const first = director.commitHeartbeat({
      wallSecondsElapsed: 1,
      wallSecondsRequested: 1,
      requestedTimeScale: 1800,
      effectiveTimeScale: 60,
    });
    assert.equal(first.simSecondsAdvanced, 60);
    assert.ok(first.owedSimSeconds > 1700);
    assert.equal(first.droppedSimSecondsThisBeat, 0);
    assert.equal(first.fidelityLocked, true);

    // Next heartbeat still requests wall time; debt remains tracked.
    const secondPlan = director.planHeartbeat(1);
    assert.equal(secondPlan.owedSimSecondsBefore, first.owedSimSeconds);
    assert.ok(secondPlan.wallSecondsToRun > 0);
  });

  it("records dropped sim seconds when owed debt exceeds the hard cap", () => {
    const director = new SimulationTimeDirector(86_400);
    // Seed a near-cap debt via fidelity shortfall, then overflow it.
    director.commitHeartbeat({
      wallSecondsElapsed: 1,
      wallSecondsRequested: 1,
      requestedTimeScale: 86_400,
      effectiveTimeScale: 1,
    });
    assert.ok(director.owedSimSeconds > 0);
    assert.equal(director.droppedSimSecondsCumulative, 0);

    // Desire ≈ prior debt + 10 days; advance almost nothing → truncate.
    const overflow = director.commitHeartbeat({
      wallSecondsElapsed: 10,
      wallSecondsRequested: 1,
      requestedTimeScale: 86_400,
      effectiveTimeScale: 1,
    });
    assert.equal(overflow.owedSimSeconds, MAX_OWED_SIM_SECONDS);
    assert.ok(overflow.droppedSimSecondsThisBeat > 0);
    assert.equal(
      director.droppedSimSecondsCumulative,
      overflow.droppedSimSecondsThisBeat,
    );
    assert.equal(
      director.snapshot().droppedSimSecondsCumulative,
      overflow.droppedSimSecondsThisBeat,
    );
  });

  it("round-trips through snapshot restore", () => {
    const director = new SimulationTimeDirector(3600);
    director.acquirePauseToken("llm-waiting");
    director.commitHeartbeat({
      wallSecondsElapsed: 1,
      wallSecondsRequested: 1,
      requestedTimeScale: 3600,
      effectiveTimeScale: 60,
    });
    const restored = SimulationTimeDirector.restore(director.snapshot());
    assert.deepEqual(restored.snapshot(), director.snapshot());
  });

  it("maps arbitrary scales to nearest preset", () => {
    assert.equal(nearestTimeScalePreset(1), 1);
    assert.equal(nearestTimeScalePreset(50), 60);
    assert.equal(nearestTimeScalePreset(2000), 1800);
    assert.ok(TIME_SCALE_PRESETS.includes(1));
  });
});

describe("ProceduralWorldScheduler", () => {
  it("is deterministic for the same seed and enters the snapshot", () => {
    const a = new ProceduralWorldScheduler("mission-seed");
    const b = new ProceduralWorldScheduler("mission-seed");
    const eventsA = a.check(1_000_000);
    const eventsB = b.check(1_000_000);
    assert.deepEqual(eventsA, eventsB);

    const restored = ProceduralWorldScheduler.restore(a.snapshot());
    assert.deepEqual(restored.snapshot(), a.snapshot());
  });

  it("marks narrative-only events without intervention bindings", () => {
    const scheduler = new ProceduralWorldScheduler(42);
    // Force by checking far future repeatedly until social fires.
    let found = false;
    for (let t = 0; t < 1_000_000; t += 3600) {
      const events = scheduler.check(t);
      const social = events.find((e) => e.type === "passenger-social");
      if (social) {
        assert.equal(social.narrativeOnly, true);
        assert.equal(social.interventionEventType, undefined);
        found = true;
        break;
      }
    }
    assert.equal(found, true);
  });
});

describe("survival pressure", () => {
  it("integrates continuous hazard dose instead of one-shot damage", () => {
    const first = integrateHazardDose({
      previous: {
        zoneId: "A-01",
        family: "hypoxia",
        accumulatedDoseSeconds: 0,
        currentTier: 0,
        episode: 0,
      },
      nextTier: 1,
      deltaSeconds: 100,
    });
    assert.equal(first.dose.episode, 1);
    assert.equal(first.dose.currentTier, 1);
    assert.ok(first.physicalDelta < 0);
    assert.ok(
      Math.abs(
        first.physicalDelta - -doseRateForTier("hypoxia", 1) * 100,
      ) < 1e-12,
    );

    const second = integrateHazardDose({
      previous: first.dose,
      nextTier: 1,
      deltaSeconds: 100,
    });
    assert.equal(second.dose.episode, 1);
    assert.ok(second.physicalDelta < 0);
    assert.ok(second.dose.accumulatedDoseSeconds >= 200);
  });

  it("consumes ration food and applies starvation when empty", () => {
    const demand = rationFoodDemandKg(100, 86_400);
    assert.ok(Math.abs(demand - 62) < 1e-9);

    const fed = applyRationAndStarvation({
      foodDryKg: 1000,
      awakeCount: 100,
      deltaSeconds: 86_400,
      ledger: {
        rationFoodConsumedKg: 0,
        starvationExposurePersonSeconds: 0,
        lastSettledDayIndex: -1,
      },
    });
    assert.ok(fed.foodDryKg < 1000);
    assert.ok(fed.starvationPhysicalDelta === 0);

    const starved = applyRationAndStarvation({
      foodDryKg: 0,
      awakeCount: 100,
      deltaSeconds: 86_400,
      ledger: fed.ledger,
    });
    assert.equal(starved.foodDryKg, 0);
    assert.ok(starved.starvationPhysicalDelta < 0);
    assert.ok(starved.ledger.starvationExposurePersonSeconds > 0);
  });
});
