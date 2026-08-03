import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPARTMENT_INBOX_MAX_MESSAGES_PER_DEPT,
  appendCaptainBriefingToDepartments,
  createDepartmentInboxSnapshot,
  markDepartmentInboxRead,
  recentMessagesForDepartment,
  renderDepartmentInboxPromptBlock,
  totalUnreadCount,
  unreadCountForDepartment,
  validateDepartmentInboxSnapshot,
} from "../../lib/llm/department-inbox.ts";

test("create/validate round-trip empty inbox snapshot v1", () => {
  const snapshot = createDepartmentInboxSnapshot();
  assert.equal(snapshot.snapshotVersion, 1);
  assert.equal(snapshot.channels.length, 7);
  assert.equal(validateDepartmentInboxSnapshot(snapshot)?.nextOrdinal, 1);
});

test("append briefing rings per department and tracks unread", () => {
  let snapshot = createDepartmentInboxSnapshot();
  snapshot = appendCaptainBriefingToDepartments(snapshot, {
    departmentIds: ["engineering", "life-support", "engineering"],
    body: "  先确认冷却泵状态再议跃迁  ",
    simulationSeconds: 100,
  });
  assert.equal(unreadCountForDepartment(snapshot, "engineering"), 1);
  assert.equal(unreadCountForDepartment(snapshot, "life-support"), 1);
  assert.equal(unreadCountForDepartment(snapshot, "medical"), 0);
  assert.equal(totalUnreadCount(snapshot), 2);
  assert.equal(
    recentMessagesForDepartment(snapshot, "engineering")[0].body,
    "先确认冷却泵状态再议跃迁",
  );

  for (let i = 0; i < DEPARTMENT_INBOX_MAX_MESSAGES_PER_DEPT + 3; i += 1) {
    snapshot = appendCaptainBriefingToDepartments(snapshot, {
      departmentIds: ["engineering"],
      body: `brief-${i}`,
      simulationSeconds: 200 + i,
    });
  }
  const engineering = snapshot.channels.find(
    (channel) => channel.departmentId === "engineering",
  );
  assert.equal(engineering.messages.length, DEPARTMENT_INBOX_MAX_MESSAGES_PER_DEPT);
  assert.equal(engineering.messages[0].body, "brief-3");
  assert.ok(validateDepartmentInboxSnapshot(snapshot));
});

test("inbox prompt injects unread then mark read clears unread", () => {
  let snapshot = appendCaptainBriefingToDepartments(
    createDepartmentInboxSnapshot(),
    {
      departmentIds: ["passenger-affairs"],
      body: "优先处理积压申诉",
      simulationSeconds: 50,
    },
  );
  const prompt = renderDepartmentInboxPromptBlock(snapshot, "passenger-affairs", {
    nowSimulationSeconds: 80,
  });
  assert.ok(prompt);
  assert.match(prompt, /<inbox>/);
  assert.match(prompt, /未读/);
  assert.match(prompt, /优先处理积压申诉/);

  snapshot = markDepartmentInboxRead(snapshot, "passenger-affairs");
  assert.equal(unreadCountForDepartment(snapshot, "passenger-affairs"), 0);
  const after = renderDepartmentInboxPromptBlock(snapshot, "passenger-affairs", {
    nowSimulationSeconds: 90,
  });
  assert.ok(after);
  assert.match(after, /已读/);
});

test("validate rejects malformed snapshots", () => {
  const snapshot = createDepartmentInboxSnapshot();
  assert.equal(
    validateDepartmentInboxSnapshot({
      ...snapshot,
      channels: snapshot.channels.slice(1),
    }),
    null,
  );
  assert.equal(validateDepartmentInboxSnapshot({ ...snapshot, nextOrdinal: 0 }), null);
});
