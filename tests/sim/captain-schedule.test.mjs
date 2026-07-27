import assert from "node:assert/strict";
import test from "node:test";

import {
  captainDecisionAdvancesRoutineSchedule,
  completedCaptainDecisionCoversDeadline,
  computeNextCaptainRoutineDeadline,
  isCaptainRoutineDue,
} from "../../lib/sim/captain-schedule.ts";

test("routine deadline is exact and advances linearly from completion", () => {
  assert.equal(isCaptainRoutineDue(64_799.999, 64_800), false);
  assert.equal(isCaptainRoutineDue(64_800, 64_800), true);
  assert.equal(computeNextCaptainRoutineDeadline(64_800, 21_600), 86_400);
});

test("a simultaneous urgent captain decision consumes the due routine boundary", () => {
  assert.equal(
    captainDecisionAdvancesRoutineSchedule({
      triggerKey: "jump-ready:0:3",
      simulationSeconds: 64_800,
      deadlineSimulationSeconds: 64_800,
    }),
    true,
  );
  assert.equal(
    captainDecisionAdvancesRoutineSchedule({
      triggerKey: "jump-ready:0:2",
      simulationSeconds: 63_340.56,
      deadlineSimulationSeconds: 64_800,
    }),
    false,
  );
});

test("a completed decision at the boundary identifies a recoverable orphan pause", () => {
  assert.equal(
    completedCaptainDecisionCoversDeadline(64_800, [
      {
        simulationSeconds: 64_800,
        status: "done",
      },
    ]),
    true,
  );
  assert.equal(
    completedCaptainDecisionCoversDeadline(64_800, [
      {
        simulationSeconds: 64_800,
        status: "thinking",
      },
    ]),
    false,
  );
});
