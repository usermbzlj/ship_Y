import assert from "node:assert/strict";
import test from "node:test";

import {
  createPassengerSocietySnapshot,
  recordPassengerRumor,
} from "../../lib/llm/passenger-society.ts";

const emitted = [];
globalThis.postMessage = (event) => emitted.push(event);
await import("../../lib/sim/worker.ts");

function dispatchAll(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  return [...emitted];
}

function dispatch(command) {
  const events = dispatchAll(command);
  assert.equal(events.length, 1, JSON.stringify(events.map((e) => e.type)));
  return events[0];
}

function initialize() {
  return dispatch({
    type: "initialize",
    requestId: "society-rt:init",
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: "society-runtime-roundtrip",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 60,
    },
  });
}

test("passengerSociety round-trips through Runtime v21 snapshot", () => {
  initialize();

  let society = createPassengerSocietySnapshot();
  society = recordPassengerRumor(society, {
    originPassengerId: "p-origin",
    originDisplayName: "传言者",
    zoneId: "A-03",
    text: "听说下一区断电了",
    simulationSeconds: 12,
  }).snapshot;

  const synced = dispatch({
    type: "set-runtime-sidecars",
    requestId: "society-rt:sync",
    passengerSociety: society,
  });
  assert.equal(synced.type, "ready");
  assert.equal(synced.payload.passengerSociety.rumors.length, 1);
  assert.equal(synced.payload.passengerSociety.rumors[0].zoneId, "A-03");

  const saved = dispatch({
    type: "snapshot",
    requestId: "society-rt:snap",
  });
  assert.equal(saved.payload.snapshot.snapshotVersion, 21);
  assert.equal(saved.payload.snapshot.passengerSociety.rumors.length, 1);
  assert.equal(
    saved.payload.snapshot.passengerSociety.rumors[0].text,
    "听说下一区断电了",
  );

  const restored = dispatch({
    type: "restore",
    requestId: "society-rt:restore",
    snapshot: saved.payload.snapshot,
  });
  assert.equal(restored.type, "ready");
  assert.equal(restored.payload.passengerSociety.rumors.length, 1);
  assert.equal(restored.payload.passengerSociety.rumors[0].zoneId, "A-03");
  assert.equal(
    restored.payload.passengerSociety.nextOrdinal,
    society.nextOrdinal,
  );
});
