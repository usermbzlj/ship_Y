import assert from "node:assert/strict";
import test from "node:test";

import {
  compactLlmTimelineText,
  isTelemetryDump,
  sanitizeLlmReadableText,
} from "../../app/ui/llm-readable-output.ts";

test("sanitizeLlmReadableText removes markdown table rows", () => {
  const input = [
    "结论：维持巡航。",
    "| 系统 | 数值 |",
    "| --- | --- |",
    "| 反应堆 | 82% |",
    "| 储能 | 1.2 MWh |",
    "等待跃迁窗口。",
  ].join("\n");

  const out = sanitizeLlmReadableText(input);
  assert.match(out, /结论：维持巡航/);
  assert.match(out, /等待跃迁窗口/);
  assert.doesNotMatch(out, /\|/);
  assert.doesNotMatch(out, /反应堆/);
  assert.doesNotMatch(out, /1\.2 MWh/);
});

test("sanitizeLlmReadableText removes · · · pseudo-table rows", () => {
  const input = [
    "建议：暂缓跃迁。",
    "反应堆 · 82% · 储能 · 1.2 · 生命保障 · 正常",
    "等待舰长指令。",
  ].join("\n");

  const out = sanitizeLlmReadableText(input);
  assert.match(out, /建议：暂缓跃迁/);
  assert.match(out, /等待舰长指令/);
  assert.doesNotMatch(out, / · /);
  assert.doesNotMatch(out, /82%/);
});

test("sanitizeLlmReadableText collapses 舰长日志 report body after ---", () => {
  const input = [
    "好的，舰长日志更新如下：航线保持稳定。",
    "",
    "---",
    "1. 状态评估",
    "反应堆输出正常，储能充足。",
    "2. 详细评估",
    "生命保障读数在标称范围。",
  ].join("\n");

  const out = sanitizeLlmReadableText(input);
  assert.match(out, /航线保持稳定/);
  assert.doesNotMatch(out, /状态评估/);
  assert.doesNotMatch(out, /详细评估/);
  assert.doesNotMatch(out, /生命保障读数/);
  assert.ok(out.length < 80);
});

test("compactLlmTimelineText no longer fabricates · pseudo-tables from pipes", () => {
  const input =
    "结论：待命。\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n下一步观察电网。";
  const out = compactLlmTimelineText(input, 260, "空");
  assert.doesNotMatch(out, / · /);
  assert.doesNotMatch(out, /\|/);
  assert.match(out, /结论：待命/);
});

test("isTelemetryDump detects subsystem number walls", () => {
  assert.equal(
    isTelemetryDump(
      "反应堆 80% 储能 1.2MWh 生命保障正常 电网 3.1MW 冷却 22℃ 舱压 101kPa",
    ),
    true,
  );
  assert.equal(isTelemetryDump("建议维持当前航线，等待下一窗口。"), false);
});

test("sanitize collapses real captain-log telemetry wall into short verdict", () => {
  const input =
    "好的，舰长日志，第21600秒（6小时）例行系统状态更新。 系统总览： 远穹号一切正常。所有关键系统稳定，人员安全，储能正在为首次跃迁充电。以下是详细评估和决策。 --- 1. 状态评估 · 系统 · 状态 · 备注 · · · 反应堆 · 稳定 · 6台聚变模块均在线，总输出约 900 MW。 · · 储能 · 充电中 · 电池组荷电状态 39.7%。 · · 生命保障 · 正常 · 居住环气压 101.3 kPa。";
  const out = sanitizeLlmReadableText(input);
  assert.match(out, /一切正常|关键系统稳定|跃迁充电/);
  assert.doesNotMatch(out, /900 MW/);
  assert.doesNotMatch(out, /39\.7%/);
  assert.doesNotMatch(out, /状态评估/);
  assert.ok(out.length < 80, `expected short text, got: ${out}`);
});
