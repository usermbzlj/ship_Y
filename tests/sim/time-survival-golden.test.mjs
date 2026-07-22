import assert from "node:assert/strict";
import test from "node:test";

const emitted = [];
globalThis.postMessage = (event) => {
  emitted.push(event);
};
await import("../../lib/sim/worker.ts");

const SEED = "time-survival-golden-v1";
const MEDIUM_SCALE = 3_600;

function dispatch(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  assert.equal(
    emitted.length,
    1,
    `expected exactly one worker event for ${command.type}, got ${emitted.length}`,
  );
  return emitted[0];
}

function initialize() {
  const ready = dispatch({
    type: "initialize",
    requestId: "golden-init",
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: SEED,
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: MEDIUM_SCALE,
    },
  });
  assert.equal(ready.type, "ready", ready.message);
  assert.equal(ready.payload.timeControl.paused, true);
  assert.deepEqual(ready.payload.timeControl.pauseTokens, ["ui"]);

  const released = dispatch({
    type: "set-time-control",
    requestId: "golden-release-ui",
    releasePauseTokens: ["ui"],
  });
  assert.equal(released.type, "ready", released.message);
  assert.equal(
    released.payload.timeControl.paused,
    false,
    "ui pause token must be released before golden stepping",
  );
  return released;
}

function step(requestId, realSeconds = 1, timeScale = MEDIUM_SCALE) {
  const event = dispatch({
    type: "step",
    requestId,
    realSeconds,
    timeScale,
  });
  assert.equal(event.type, "stepped", event.message ?? `step ${requestId} failed`);
  return event;
}

test("golden: pause tokens gate elapsed, ration ledger matches food, snapshot restores", () => {
  const ready = initialize();
  const foodBefore = ready.payload.state.consumables.foodDryKg;
  assert.ok(foodBefore > 0, "initial foodDryKg must be positive");

  // 若干中等倍速步进 → elapsed 前进
  let last = step("golden-step-1");
  assert.equal(
    last.payload.elapsedSeconds,
    MEDIUM_SCALE,
    `after 1×${MEDIUM_SCALE}s step, elapsed must be ${MEDIUM_SCALE}`,
  );
  last = step("golden-step-2");
  assert.equal(
    last.payload.elapsedSeconds,
    MEDIUM_SCALE * 2,
    `after 2×${MEDIUM_SCALE}s steps, elapsed must be ${MEDIUM_SCALE * 2}`,
  );
  last = step("golden-step-3");
  const elapsedAfterRun = last.payload.elapsedSeconds;
  assert.equal(
    elapsedAfterRun,
    MEDIUM_SCALE * 3,
    `after 3×${MEDIUM_SCALE}s steps, elapsed must be ${MEDIUM_SCALE * 3}`,
  );

  // acquire ui → step → elapsed 不变
  const paused = dispatch({
    type: "set-time-control",
    requestId: "golden-acquire-ui",
    acquirePauseTokens: ["ui"],
  });
  assert.equal(paused.type, "ready", paused.message);
  assert.equal(paused.payload.timeControl.paused, true);
  assert.ok(
    paused.payload.timeControl.pauseTokens.includes("ui"),
    `expected ui in pauseTokens, got ${JSON.stringify(paused.payload.timeControl.pauseTokens)}`,
  );

  const frozen = step("golden-step-while-paused");
  assert.equal(
    frozen.payload.elapsedSeconds,
    elapsedAfterRun,
    `elapsed must stay ${elapsedAfterRun} while ui pause token is held, got ${frozen.payload.elapsedSeconds}`,
  );

  // release ui → 再 step → 前进
  const resumed = dispatch({
    type: "set-time-control",
    requestId: "golden-release-ui-again",
    releasePauseTokens: ["ui"],
  });
  assert.equal(resumed.type, "ready", resumed.message);
  assert.equal(resumed.payload.timeControl.paused, false);

  const advanced = step("golden-step-after-release");
  const elapsedAfterResume = advanced.payload.elapsedSeconds;
  assert.equal(
    elapsedAfterResume,
    elapsedAfterRun + MEDIUM_SCALE,
    `elapsed must advance by ${MEDIUM_SCALE} after releasing ui`,
  );

  // 口粮：步进后 foodDryKg 下降且与 survival.rationFoodConsumedKg 一致（单路径）
  const foodAfter = advanced.payload.state.consumables.foodDryKg;
  const foodDelta = foodBefore - foodAfter;
  const rationConsumed = advanced.payload.survival.rationFoodConsumedKg;
  assert.ok(foodDelta > 0, `foodDryKg must decrease after stepping (Δ=${foodDelta})`);
  assert.ok(
    rationConsumed > 0,
    `survival.rationFoodConsumedKg must be positive, got ${rationConsumed}`,
  );
  assert.ok(
    Math.abs(foodDelta - rationConsumed) < 1e-6,
    `foodDryKg Δ (${foodDelta}) must equal survival.rationFoodConsumedKg (${rationConsumed}) — single ration path`,
  );

  // snapshot → restore → 关键字段一致
  const saved = dispatch({
    type: "snapshot",
    requestId: "golden-snapshot",
  });
  assert.equal(saved.type, "snapshot", saved.message);
  const snapshot = saved.payload.snapshot;
  assert.equal(
    snapshot.engine.clock.elapsedMicroseconds,
    elapsedAfterResume * 1_000_000,
  );
  assert.equal(
    snapshot.timeDirector.owedSimSeconds,
    advanced.payload.timeControl.owedSimSeconds,
    "snapshot timeDirector.owedSimSeconds must match live timeControl",
  );
  assert.equal(
    snapshot.survival.ledger.rationFoodConsumedKg,
    rationConsumed,
    "snapshot survival.ledger.rationFoodConsumedKg must match live telemetry",
  );
  assert.equal(
    snapshot.survival.ledger.starvationExposurePersonSeconds,
    advanced.payload.survival.starvationExposurePersonSeconds,
    "snapshot survival.ledger.starvationExposurePersonSeconds must match live telemetry",
  );

  // 再推进一小步，确认世界已偏离快照，再 restore 拉回
  const drifted = step("golden-drift-before-restore");
  assert.ok(
    drifted.payload.elapsedSeconds > elapsedAfterResume,
    "pre-restore drift step must advance elapsed",
  );

  const restored = dispatch({
    type: "restore",
    requestId: "golden-restore",
    snapshot,
  });
  assert.equal(restored.type, "ready", restored.message);
  assert.equal(
    restored.payload.elapsedSeconds,
    elapsedAfterResume,
    `restore must recover elapsed=${elapsedAfterResume}, got ${restored.payload.elapsedSeconds}`,
  );
  assert.equal(
    restored.payload.timeControl.owedSimSeconds,
    snapshot.timeDirector.owedSimSeconds,
    `restore must recover timeDirector.owedSimSeconds=${snapshot.timeDirector.owedSimSeconds}`,
  );
  assert.equal(
    restored.payload.survival.rationFoodConsumedKg,
    snapshot.survival.ledger.rationFoodConsumedKg,
    "restore must recover survival.ledger.rationFoodConsumedKg",
  );
  assert.equal(
    restored.payload.survival.starvationExposurePersonSeconds,
    snapshot.survival.ledger.starvationExposurePersonSeconds,
    "restore must recover survival.ledger.starvationExposurePersonSeconds",
  );
  assert.equal(
    restored.payload.state.consumables.foodDryKg,
    snapshot.engine.state.consumables.foodDryKg,
    "restore must recover foodDryKg from engine state",
  );

  const afterRestore = dispatch({
    type: "snapshot",
    requestId: "golden-snapshot-after-restore",
  });
  assert.equal(afterRestore.type, "snapshot", afterRestore.message);
  assert.deepEqual(
    afterRestore.payload.snapshot.timeDirector,
    snapshot.timeDirector,
    "timeDirector must round-trip through snapshot → restore",
  );
  assert.deepEqual(
    afterRestore.payload.snapshot.survival.ledger,
    snapshot.survival.ledger,
    "survival.ledger must round-trip through snapshot → restore",
  );
  assert.deepEqual(
    afterRestore.payload.snapshot.proceduralWorld,
    snapshot.proceduralWorld,
    "proceduralWorld must round-trip through snapshot → restore",
  );
  assert.equal(
    afterRestore.payload.snapshot.engine.clock.elapsedMicroseconds,
    snapshot.engine.clock.elapsedMicroseconds,
    "engine clock elapsed must round-trip through snapshot → restore",
  );

  // 可选：timeScale 1 与 86400 各一步不崩
  const scaleOne = dispatch({
    type: "set-time-control",
    requestId: "golden-scale-1",
    timeScale: 1,
    releasePauseTokens: ["ui"],
  });
  assert.equal(scaleOne.type, "ready", scaleOne.message);
  const stepRealtime = step("golden-step-scale-1", 1, 1);
  assert.equal(stepRealtime.type, "stepped", stepRealtime.message);
  assert.equal(
    stepRealtime.payload.elapsedSeconds,
    elapsedAfterResume + 1,
    "1× realtime step must advance elapsed by 1s",
  );

  const scaleDay = dispatch({
    type: "set-time-control",
    requestId: "golden-scale-86400",
    timeScale: 86_400,
  });
  assert.equal(scaleDay.type, "ready", scaleDay.message);
  const stepDay = step("golden-step-scale-86400", 1, 86_400);
  assert.equal(stepDay.type, "stepped", stepDay.message);
  assert.ok(
    stepDay.payload.elapsedSeconds > stepRealtime.payload.elapsedSeconds,
    "86400× step must advance elapsed further without crashing",
  );
});
