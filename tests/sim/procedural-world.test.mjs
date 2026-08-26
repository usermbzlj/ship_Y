import assert from "node:assert/strict";
import test from "node:test";

import { ProceduralWorldScheduler } from "../../lib/sim/procedural-world.ts";

test("nextEventSimulationSeconds ignores restored keys the schedule no longer defines", () => {
  const scheduler = new ProceduralWorldScheduler("procedural-stale-key");
  const snapshot = scheduler.snapshot();
  const legitimateNext = scheduler.nextEventSimulationSeconds();
  assert.ok(legitimateNext !== null && legitimateNext > 0);

  // Simulate an older save whose schedule contained a since-removed event type
  // that is already "due" in the past. Before the guard this made the Worker's
  // step loop spin forever: nextEventSimulationSeconds() reported it due, but
  // check() (which only walks the live schedule) never consumed it.
  const tampered = {
    ...snapshot,
    nextTriggerAt: {
      ...snapshot.nextTriggerAt,
      "retired-event-type": 1,
    },
  };
  const restored = ProceduralWorldScheduler.restore(tampered);

  // The stale key is dropped on restore and never advertised as the next event.
  assert.equal(restored.nextEventSimulationSeconds(), legitimateNext);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      restored.snapshot().nextTriggerAt,
      "retired-event-type",
    ),
    false,
  );

  // check() at a time past the stale key does not throw or hang, and returns
  // only real, schedulable events (none are due this early).
  assert.deepEqual(restored.check(10), []);
});
