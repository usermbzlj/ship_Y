import assert from "node:assert/strict";
import test from "node:test";

import {
  AFFAIRS_DEPARTMENT_ID,
  GRIEVANCE_BACKLOG_AGE_SECONDS,
  GRIEVANCE_BACKLOG_STRESS_CAP,
  GRIEVANCE_BACKLOG_STRESS_PER,
  computeGrievanceBacklogStressDeltas,
  listAgedOpenGrievances,
  renderGrievanceBacklogPromptBlock,
} from "../../lib/llm/grievance-backlog.ts";

const base = {
  id: "g1",
  category: "food",
  summary: "口粮分配不透明",
  filedAtMicroseconds: 0,
  status: "open",
  filedByPassengerId: "p-1",
};

test("aged open grievances appear after threshold; answered clears penalty set", () => {
  const young = {
    ...base,
    id: "g-young",
    filedAtMicroseconds: (GRIEVANCE_BACKLOG_AGE_SECONDS - 60) * 1_000_000,
  };
  const old = {
    ...base,
    id: "g-old",
    filedAtMicroseconds: 0,
  };
  const answered = {
    ...base,
    id: "g-answered",
    status: "answered",
    filedAtMicroseconds: 0,
  };
  const closed = {
    ...base,
    id: "g-closed",
    status: "closed",
    filedAtMicroseconds: 0,
  };
  const now = GRIEVANCE_BACKLOG_AGE_SECONDS + 120;
  const aged = listAgedOpenGrievances(
    [young, old, answered, closed],
    now,
  );
  assert.deepEqual(
    aged.map((entry) => entry.id),
    ["g-old"],
  );
});

test("stress deltas are deterministic, capped, and skip null passenger ids", () => {
  const grievances = [
    {
      ...base,
      id: "g-a",
      filedByPassengerId: "p-a",
      filedAtMicroseconds: 0,
    },
    {
      ...base,
      id: "g-b",
      filedByPassengerId: "p-b",
      filedAtMicroseconds: 0,
    },
    {
      ...base,
      id: "g-seed",
      filedByPassengerId: null,
      filedAtMicroseconds: 0,
    },
    {
      ...base,
      id: "g-c",
      filedByPassengerId: "p-a",
      filedAtMicroseconds: 0,
    },
    {
      ...base,
      id: "g-d",
      filedByPassengerId: "p-a",
      filedAtMicroseconds: 0,
    },
    {
      ...base,
      id: "g-e",
      filedByPassengerId: "p-a",
      filedAtMicroseconds: 0,
    },
  ];
  const zones = { "p-a": "A-01", "p-b": "B-02" };
  const first = computeGrievanceBacklogStressDeltas(grievances, {
    simulationSeconds: GRIEVANCE_BACKLOG_AGE_SECONDS + 1,
    resolvePassengerZone: (id) => zones[id] ?? null,
  });
  const second = computeGrievanceBacklogStressDeltas(grievances, {
    simulationSeconds: GRIEVANCE_BACKLOG_AGE_SECONDS + 1,
    resolvePassengerZone: (id) => zones[id] ?? null,
  });
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.equal(first[0].zoneId, "A-01");
  assert.equal(first[1].zoneId, "B-02");
  assert.equal(first[1].stressDelta, GRIEVANCE_BACKLOG_STRESS_PER);
  assert.ok(first[0].stressDelta <= GRIEVANCE_BACKLOG_STRESS_CAP);
  assert.equal(first[0].stressDelta, GRIEVANCE_BACKLOG_STRESS_CAP);
});

test("affairs prompt block only for passenger-affairs; clears when answered", () => {
  const grievances = [
    {
      ...base,
      id: "g-old",
      filedAtMicroseconds: 0,
      status: "open",
    },
  ];
  const now = GRIEVANCE_BACKLOG_AGE_SECONDS + 10;
  const affairs = renderGrievanceBacklogPromptBlock(grievances, {
    simulationSeconds: now,
    departmentId: AFFAIRS_DEPARTMENT_ID,
  });
  assert.ok(affairs);
  assert.match(affairs, /<grievance_backlog>/);
  assert.match(affairs, /g-old|口粮分配不透明/);

  const engineering = renderGrievanceBacklogPromptBlock(grievances, {
    simulationSeconds: now,
    departmentId: "engineering",
  });
  assert.equal(engineering, null);

  const cleared = renderGrievanceBacklogPromptBlock(
    [{ ...grievances[0], status: "answered" }],
    {
      simulationSeconds: now,
      departmentId: AFFAIRS_DEPARTMENT_ID,
    },
  );
  assert.equal(cleared, null);
});
