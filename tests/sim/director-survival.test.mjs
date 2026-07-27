import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SimulationTimeDirector,
  TIME_SCALE_PRESETS,
  nearestTimeScalePreset,
} from "../../lib/sim/director.ts";
import { ProceduralWorldScheduler } from "../../lib/sim/procedural-world.ts";
import {
  applyRationAndStarvation,
  doseRateForTier,
  integrateHazardDose,
  MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER,
  MEDICAL_ZONE_TREATMENT_EFFECT_MULTIPLIER,
  NON_MEDICAL_ZONE_TREATMENT_EFFECT_MULTIPLIER,
  medicalTreatmentEffectMultiplier,
  rationFoodDemandKg,
} from "../../lib/sim/survival.ts";
import {
  zoneCatalogEntry,
  zoneIdsForRole,
} from "../../lib/sim/compartments.ts";

describe("SimulationTimeDirector", () => {
  it("acquires and releases named pause tokens", () => {
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

  it("records fidelity shortfall without replaying it as catch-up time", () => {
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
    assert.equal(first.owedSimSeconds, 0);
    assert.equal(first.droppedSimSecondsThisBeat, 1_740);
    assert.equal(first.fidelityLocked, true);

    // The next heartbeat represents only its own wall second.
    const secondPlan = director.planHeartbeat(1);
    assert.equal(secondPlan.owedSimSecondsBefore, 0);
    assert.equal(secondPlan.wallSecondsToRun, 1);
  });

  it("accumulates diagnostics for discarded shortfall while debt stays zero", () => {
    const director = new SimulationTimeDirector(86_400);
    const first = director.commitHeartbeat({
      wallSecondsElapsed: 1,
      wallSecondsRequested: 1,
      requestedTimeScale: 86_400,
      effectiveTimeScale: 1,
    });
    assert.equal(director.owedSimSeconds, 0);
    assert.equal(
      director.droppedSimSecondsCumulative,
      first.droppedSimSecondsThisBeat,
    );

    const second = director.commitHeartbeat({
      wallSecondsElapsed: 10,
      wallSecondsRequested: 1,
      requestedTimeScale: 86_400,
      effectiveTimeScale: 1,
    });
    assert.equal(second.owedSimSeconds, 0);
    assert.ok(second.droppedSimSecondsThisBeat > 0);
    assert.equal(
      director.droppedSimSecondsCumulative,
      first.droppedSimSecondsThisBeat +
        second.droppedSimSecondsThisBeat,
    );
    assert.equal(
      director.snapshot().droppedSimSecondsCumulative,
      director.droppedSimSecondsCumulative,
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
    const seen = {
      social: false,
      power: false,
      hibernation: false,
      sensorDrift: false,
    };
    for (let t = 0; t < 1_000_000; t += 3600) {
      const events = scheduler.check(t);
      for (const event of events) {
        if (event.type === "passenger-social") {
          assert.equal(event.narrativeOnly, true);
          assert.equal(event.interventionEventType, undefined);
          assert.match(
            event.message,
            /【叙事记录·无即时物理注入】/,
          );
          seen.social = true;
        }
        if (event.type === "power-fluctuation") {
          assert.equal(event.narrativeOnly, false);
          assert.equal(event.interventionEventType, "power-fluctuation");
          seen.power = true;
        }
        if (event.type === "hibernation-complication") {
          assert.equal(event.narrativeOnly, false);
          assert.equal(
            event.interventionEventType,
            "hibernation-complication",
          );
          seen.hibernation = true;
        }
        if (event.type === "sensor-drift") {
          assert.equal(event.narrativeOnly, false);
          assert.equal(event.interventionEventType, "sensor-drift");
          seen.sensorDrift = true;
        }
      }
      if (
        seen.social &&
        seen.power &&
        seen.hibernation &&
        seen.sensorDrift
      ) {
        break;
      }
    }
    assert.equal(seen.social, true);
    assert.equal(seen.power, true);
    assert.equal(seen.hibernation, true);
    assert.equal(seen.sensorDrift, true);
  });

  it("publishes the exact next deadline and does not drift when checked late", () => {
    const scheduler = new ProceduralWorldScheduler("exact-events");
    const firstDeadline = scheduler.nextEventSimulationSeconds();
    assert.equal(typeof firstDeadline, "number");
    const events = scheduler.check(firstDeadline + 600);
    assert.ok(events.length > 0);
    assert.ok(
      events.some(
        (event) =>
          Math.abs(event.simulationSeconds - firstDeadline) < 1e-9,
      ),
    );
    assert.ok(
      scheduler.nextEventSimulationSeconds() > firstDeadline,
    );
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

  it("exposes a medical-zone dose buffer that is reduced but not zero", () => {
    assert.ok(MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER > 0.5);
    assert.ok(MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER < 0.7);
    const raw = integrateHazardDose({
      previous: {
        zoneId: "A-15",
        family: "hypoxia",
        accumulatedDoseSeconds: 0,
        currentTier: 0,
        episode: 0,
      },
      nextTier: 1,
      deltaSeconds: 100,
    });
    assert.ok(
      Math.abs(
        raw.physicalDelta * MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER -
          raw.physicalDelta * 0.6,
      ) < 1e-15,
    );
    assert.ok(
      Math.abs(raw.stressDelta * MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER) <
        Math.abs(raw.stressDelta),
    );
  });

  it("scales medical-treatment benefit by patient ZoneRole (1.0 medical / 0.4 elsewhere)", () => {
    assert.equal(MEDICAL_ZONE_TREATMENT_EFFECT_MULTIPLIER, 1);
    assert.equal(NON_MEDICAL_ZONE_TREATMENT_EFFECT_MULTIPLIER, 0.4);
    assert.equal(medicalTreatmentEffectMultiplier(true), 1);
    assert.equal(medicalTreatmentEffectMultiplier(false), 0.4);

    const medicalZones = zoneIdsForRole("medical");
    assert.ok(medicalZones.length >= 2);
    for (const zoneId of medicalZones) {
      assert.equal(zoneCatalogEntry(zoneId).role, "medical");
      assert.equal(
        medicalTreatmentEffectMultiplier(
          zoneCatalogEntry(zoneId).role === "medical",
        ),
        1,
      );
    }

    const livingZone = "A-01";
    assert.equal(zoneCatalogEntry(livingZone).role, "living");
    assert.equal(
      medicalTreatmentEffectMultiplier(
        zoneCatalogEntry(livingZone).role === "medical",
      ),
      0.4,
    );

    const basePhysical = 0.08;
    assert.ok(
      Math.abs(basePhysical * medicalTreatmentEffectMultiplier(true) - 0.08) <
        1e-15,
    );
    assert.ok(
      Math.abs(basePhysical * medicalTreatmentEffectMultiplier(false) - 0.032) <
        1e-15,
    );
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
