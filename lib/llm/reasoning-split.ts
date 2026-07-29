/**
 * 内联思维链拆分。
 *
 * 部分云端模型（DeepSeek、Qwen 等）在开启 thinking 时不走独立的 reasoning 字段，
 * 而是把思维链以 `<think>` / `<thinking>` 标签直接写进 `message.content`。
 * 这段文本一旦原样流入世界层，就会同时污染三处：
 *
 *   1. 舰桥日志与决策演出（玩家看到原始英文思维链，沉浸感当场破裂）；
 *   2. 下一轮 prompt（部门简报、会议记录、同僚立场都拼接原文）；
 *   3. 部门立场快照（随本地存档持久化）。
 *
 * 因此拆分放在网关解析层：`text` 只保留对外正文，抽出的思维链另存 `reasoning`，
 * 供 AI 观察层按「只展示模型实际返回内容」的原则如实呈现，而不是丢弃或伪造。
 */

/** 已知会被模型写成内联标签的思维链标签名。 */
const INLINE_REASONING_TAGS = ["think", "thinking"] as const;

const TAG_ALTERNATION = INLINE_REASONING_TAGS.join("|");

/** 成对出现：`<think ...> ... </think>`。 */
const PAIRED_PATTERN = new RegExp(
  `<(${TAG_ALTERNATION})\\b[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`,
  "gi",
);

/** 只有开标签、没有闭标签（响应被截断时常见），其后全部视为思维链。 */
const UNTERMINATED_PATTERN = new RegExp(
  `<(${TAG_ALTERNATION})\\b[^>]*>([\\s\\S]*)$`,
  "i",
);

export interface SplitReasoningResult {
  /** 对外正文：已剥离内联思维链，可安全进入世界层、prompt 与存档。 */
  text: string;
  /** 抽出的思维链原文；没有内联标签时为 null。多段之间以空行相连。 */
  reasoning: string | null;
}

/**
 * 从模型正文中剥离内联思维链。
 *
 * 纯函数，不持有状态；输入非字符串时按空串处理，保证网关解析路径不抛错。
 * 若模型整条响应都是思维链，返回的 `text` 为空串——这是对「模型没有给出正文」
 * 的如实表示，不用思维链顶替正文。
 */
export function splitInlineReasoning(raw: string): SplitReasoningResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { text: typeof raw === "string" ? raw : "", reasoning: null };
  }

  const captured: string[] = [];

  let stripped = raw.replace(PAIRED_PATTERN, (_match, _tag, inner: string) => {
    captured.push(inner);
    return "";
  });

  const unterminated = UNTERMINATED_PATTERN.exec(stripped);
  if (unterminated) {
    captured.push(unterminated[2] ?? "");
    stripped = stripped.slice(0, unterminated.index);
  }

  if (captured.length === 0) {
    return { text: raw, reasoning: null };
  }

  const reasoning = captured
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");

  return {
    text: stripped.trim(),
    reasoning: reasoning.length > 0 ? reasoning : null,
  };
}
