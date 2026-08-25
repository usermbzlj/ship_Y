import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateMinLegs,
  findStarCatalogEntry,
  routeDistanceLy,
} from "../../lib/astro/star-catalog.ts";

const emitted = [];
globalThis.postMessage = (event) => emitted.push(event);
await import("../../lib/sim/worker.ts");

function dispatch(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  assert.equal(emitted.length, 1);
  return emitted[0];
}

test("revise_mission uses the catalog Euclidean distance, not the model's self-reported figure", () => {
  dispatch({
    type: "initialize",
    requestId: "revise-distance:init",
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "安全抵达。",
      seed: "revise-mission-catalog-distance",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 3_600,
    },
  });
  let current = dispatch({
    type: "set-time-control",
    requestId: "revise-distance:release",
    releasePauseTokens: ["ui"],
  }).payload;

  const from = findStarCatalogEntry("太阳系");
  const to = findStarCatalogEntry("天仓五");
  assert.ok(from && to, "both endpoints must resolve in the catalog");
  const expectedDistance = routeDistanceLy(from.id, to.id);
  const expectedLegs = estimateMinLegs(expectedDistance);
  // The distance the model reports is a deliberate lie (far too short).
  const fabricatedDistance = 3;
  assert.ok(expectedDistance > fabricatedDistance + 1);

  const event = dispatch({
    type: "ship-command",
    requestId: "revise-distance:divert",
    commandId: "captain:revise-1",
    idempotencyKey: "captain:revise-1",
    issuedAtMicroseconds: Math.round(current.elapsedSeconds * 1_000_000),
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "revise-mission",
      actorAgentId: "captain",
      disposition: "divert",
      destination: "天仓五",
      objective: "转入安全港",
      route: [
        {
          id: "leg-1",
          label: "航段一",
          distanceFromPreviousLightYears: fabricatedDistance,
        },
      ],
      totalDistanceLightYears: fabricatedDistance,
      totalLegs: 1,
    },
  });
  assert.equal(event.type, "ship-command", event.message);

  const journey = dispatch({
    type: "snapshot",
    requestId: "revise-distance:snapshot",
  }).payload.snapshot.engine.state.journey;

  assert.equal(journey.destination, "天仓五");
  assert.ok(
    Math.abs(journey.totalDistanceLightYears - expectedDistance) < 1e-6,
    `expected catalog distance ${expectedDistance}, got ${journey.totalDistanceLightYears}`,
  );
  assert.notEqual(journey.totalDistanceLightYears, fabricatedDistance);
  assert.equal(journey.totalLegs, Math.max(1, expectedLegs));
  assert.ok(journey.totalLegs > 1);
});
