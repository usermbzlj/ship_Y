import assert from "node:assert/strict";
import test from "node:test";

import {
  ATMOSPHERE_RESERVE_LEDGER_SEMANTICS,
  captainHullThreatBlocksJump,
  projectCaptainHullThreatObservation,
  projectCaptainPressureZoneAlerts,
} from "../../lib/sim/captain-observation.ts";

function makeZone(overrides = {}) {
  return {
    zoneId: "A-05",
    role: "hab",
    labelZh: "测试舱",
    purposeZh: "测试",
    ring: "A",
    condition: "nominal",
    hasBreach: false,
    observed: {
      pressurePa: 101_325,
      temperatureK: 293,
      oxygenPartialPressurePa: 21_000,
      carbonDioxidePartialPressurePa: 40,
    },
    quality: {
      pressure: "good",
      temperature: "good",
      oxygen: "good",
      carbonDioxide: "good",
    },
    newestSampleAgeSeconds: 1,
    ...overrides,
  };
}

function makeHullConsequence(overrides = {}) {
  return {
    hullIntegrity: 0.97,
    activeBreachCount: 1,
    totalBreachAreaSquareMeters: 2.5e-5,
    jumpBlocked: true,
    jumpBlockReason: "活动船体破口禁止跃迁",
    thrustPerformanceByRing: { a: 0.85, b: 1 },
    events: [
      {
        id: "breach:test-1",
        zoneId: "A-05",
        ring: "a",
        cascadeStage: 0,
        unrepairedSeconds: 12,
        nextCascadeSeconds: 3600,
        appliedFaultKeys: [],
      },
    ],
    ...overrides,
  };
}

test("projectCaptainHullThreatObservation marks null telemetry unavailable", () => {
  const observation = projectCaptainHullThreatObservation(null);
  assert.equal(observation.availability, "unavailable");
  assert.equal(observation.hullIntegrity, null);
  assert.equal(observation.jumpBlocked, false);
  assert.deepEqual(observation.activeBreaches, []);
});

test("projectCaptainHullThreatObservation mirrors jumpBlocked telemetry and breach ids", () => {
  const hull = makeHullConsequence();
  const observation = projectCaptainHullThreatObservation(hull);
  assert.equal(observation.availability, "available");
  assert.equal(observation.jumpBlocked, true);
  assert.equal(observation.activeBreachCount, 1);
  assert.ok(observation.activeBreaches.some((breach) => breach.breachId === "breach:test-1"));
});

test("projectCaptainPressureZoneAlerts keeps nominal zones that still have a breach", () => {
  const compartments = {
    zones: [
      makeZone({
        zoneId: "A-05",
        condition: "nominal",
        hasBreach: true,
      }),
      makeZone({
        zoneId: "A-06",
        condition: "nominal",
        hasBreach: false,
      }),
    ],
  };
  const hull = makeHullConsequence({
    events: [
      {
        id: "breach:test-1",
        zoneId: "A-05",
        ring: "a",
        cascadeStage: 0,
        unrepairedSeconds: 12,
        nextCascadeSeconds: 3600,
        appliedFaultKeys: [],
      },
    ],
  });

  const alerts = projectCaptainPressureZoneAlerts(compartments, hull);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].zoneId, "A-05");
  assert.equal(alerts[0].condition, "nominal");
  assert.equal(alerts[0].hasBreach, true);
  assert.deepEqual(alerts[0].breachIds, ["breach:test-1"]);
});

test("captainHullThreatBlocksJump when activeBreachCount or compartment breaches are present", () => {
  assert.equal(
    captainHullThreatBlocksJump({
      hullConsequence: makeHullConsequence({
        jumpBlocked: false,
        activeBreachCount: 1,
      }),
      compartments: { activeBreaches: 0 },
    }),
    true,
  );
  assert.equal(
    captainHullThreatBlocksJump({
      hullConsequence: makeHullConsequence({
        jumpBlocked: false,
        activeBreachCount: 0,
        events: [],
      }),
      compartments: { activeBreaches: 2 },
    }),
    true,
  );
  assert.equal(
    captainHullThreatBlocksJump({
      hullConsequence: makeHullConsequence({
        jumpBlocked: false,
        activeBreachCount: 0,
        events: [],
      }),
      compartments: { activeBreaches: 0 },
    }),
    false,
  );
});

test("atmosphere reserve ledger semantics stay explicit", () => {
  assert.match(ATMOSPHERE_RESERVE_LEDGER_SEMANTICS, /atmosphereReserveKg/);
  assert.match(ATMOSPHERE_RESERVE_LEDGER_SEMANTICS, /set-atmosphere-supply/);
  assert.match(ATMOSPHERE_RESERVE_LEDGER_SEMANTICS, /不会自动进入舱区/);
});
