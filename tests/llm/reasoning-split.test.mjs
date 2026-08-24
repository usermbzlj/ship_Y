import assert from "node:assert/strict";
import test from "node:test";

import {
  scrubReasoningFromValue,
  splitInlineReasoning,
} from "../../lib/llm/reasoning-split.ts";

test("leaves ordinary content untouched", () => {
  const raw = "各部门共识：跃迁前置条件不满足，应先恢复关键传感器。";
  const split = splitInlineReasoning(raw);
  assert.equal(split.text, raw);
  assert.equal(split.reasoning, null);
});

test("strips a paired <thinking> block and keeps the answer", () => {
  // 实际现场泄露形态：英文思维链在前，中文正文在后。
  const split = splitInlineReasoning(
    "<thinking> Let me analyze the situation carefully. Sensors are offline. </thinking>\n" +
      "工程部门结论：跃迁前置条件不满足。",
  );
  assert.equal(split.text, "工程部门结论：跃迁前置条件不满足。");
  assert.match(split.reasoning, /Let me analyze the situation carefully/);
  assert.doesNotMatch(split.text, /thinking/i);
});

test("strips the <think> spelling and tags carrying attributes", () => {
  const split = splitInlineReasoning(
    '<think type="internal">hidden</think>可见正文',
  );
  assert.equal(split.text, "可见正文");
  assert.equal(split.reasoning, "hidden");
});

test("strips multiple blocks and joins the captured reasoning", () => {
  const split = splitInlineReasoning(
    "<think>first</think>正文甲<think>second</think>正文乙",
  );
  assert.equal(split.text, "正文甲正文乙");
  assert.equal(split.reasoning, "first\n\nsecond");
});

test("treats an unterminated opening tag as reasoning through end of text", () => {
  // 响应被截断时模型只发出开标签，闭标签永远不会到达。
  const split = splitInlineReasoning("正文在前<thinking>被截断的思维链");
  assert.equal(split.text, "正文在前");
  assert.equal(split.reasoning, "被截断的思维链");
});

test("reports an empty answer rather than promoting reasoning into the text", () => {
  // 整条响应都是思维链时，如实表示「模型没有给出正文」，不用思维链顶替。
  const split = splitInlineReasoning("<thinking>only internal monologue</thinking>");
  assert.equal(split.text, "");
  assert.equal(split.reasoning, "only internal monologue");
});

test("tolerates empty and non-string input without throwing", () => {
  assert.deepEqual(splitInlineReasoning(""), { text: "", reasoning: null });
  assert.deepEqual(splitInlineReasoning(undefined), {
    text: "",
    reasoning: null,
  });
});

test("is case-insensitive about the tag name", () => {
  const split = splitInlineReasoning("<THINKING>x</THINKING>正文");
  assert.equal(split.text, "正文");
  assert.equal(split.reasoning, "x");
});

test("nested reasoning tags do not leak the inner close into the answer", () => {
  const split = splitInlineReasoning(
    "<think>outer<think>inner</think>still hidden</think>可见正文",
  );
  assert.equal(split.text, "可见正文");
  assert.doesNotMatch(split.text, /think|hidden|inner|outer/i);
  assert.match(split.reasoning, /outer/);
  assert.match(split.reasoning, /inner/);
  assert.match(split.reasoning, /still hidden/);
});

test("a self-closing reasoning tag does not swallow the visible answer", () => {
  const split = splitInlineReasoning("<think/>可见正文");
  assert.equal(split.text, "可见正文");
  assert.equal(split.reasoning, null);
});

test("scrubReasoningFromValue strips CoT from every string in tool arguments", () => {
  const { value, reasoning } = scrubReasoningFromValue({
    voice: "<think>should I be honest?</think>各位，我们必须改道。",
    summary: "常规陈述，无思维链。",
    nested: { note: "<thinking>secret</thinking>公开备注" },
    list: ["<think>hidden</think>可见项", "普通项"],
  });
  assert.equal(value.voice, "各位，我们必须改道。");
  assert.equal(value.summary, "常规陈述，无思维链。");
  assert.equal(value.nested.note, "公开备注");
  assert.deepEqual(value.list, ["可见项", "普通项"]);
  assert.match(reasoning, /should I be honest\?/);
  assert.match(reasoning, /secret/);
  assert.match(reasoning, /hidden/);
  const encoded = JSON.stringify(value);
  assert.doesNotMatch(encoded, /think|secret|hidden|should I be honest/i);
});
