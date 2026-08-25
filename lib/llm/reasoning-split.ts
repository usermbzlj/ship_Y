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

/**
 * 匹配一个思维链标签：开标签 `<think ...>`、闭标签 `</think>` 或自闭合
 * `<think/>`。`g` 用于逐个扫描，`i` 忽略大小写。
 */
const TAG_PATTERN = new RegExp(`<(/)?(?:${TAG_ALTERNATION})\\b([^>]*)>`, "gi");

export interface SplitReasoningResult {
  /** 对外正文：已剥离内联思维链，可安全进入世界层、prompt 与存档。 */
  text: string;
  /** 抽出的思维链原文；没有内联标签时为 null。多段之间以空行相连。 */
  reasoning: string | null;
}

/**
 * 从模型正文中剥离内联思维链。
 *
 * 用带深度计数的扫描器逐个处理标签，正确应对嵌套（`<think><think>…</think>…</think>`）、
 * 自闭合（`<think/>` 视为零宽，不吞掉其后的正文）与被截断的开标签（其后全部视为思维链）。
 * 纯函数，不持有状态；输入非字符串时按空串处理，保证网关解析路径不抛错。
 * 若模型整条响应都是思维链，返回的 `text` 为空串——不用思维链顶替正文。
 */
export function splitInlineReasoning(raw: string): SplitReasoningResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { text: typeof raw === "string" ? raw : "", reasoning: null };
  }

  const pattern = new RegExp(TAG_PATTERN.source, "gi");
  const capturedBlocks: string[] = [];
  let text = "";
  let currentReasoning = "";
  let depth = 0;
  let lastIndex = 0;
  let matchedAny = false;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    matchedAny = true;
    const segment = raw.slice(lastIndex, match.index);
    if (depth > 0) currentReasoning += segment;
    else text += segment;
    lastIndex = pattern.lastIndex;

    const isClose = match[1] === "/";
    const attributes = match[2] ?? "";
    const isSelfClose = attributes.trimEnd().endsWith("/");

    if (isClose) {
      // 深度为 0 时遇到落单的闭标签：直接丢弃标签本身。
      if (depth > 0) {
        depth -= 1;
        if (depth === 0) {
          capturedBlocks.push(currentReasoning);
          currentReasoning = "";
        }
      }
    } else if (!isSelfClose) {
      depth += 1;
    }
  }

  if (!matchedAny) {
    return { text: raw, reasoning: null };
  }

  const tail = raw.slice(lastIndex);
  if (depth > 0) {
    // 开标签始终未闭合：其后（含 tail）全部计入思维链。
    currentReasoning += tail;
    capturedBlocks.push(currentReasoning);
  } else {
    text += tail;
  }

  const reasoning = capturedBlocks
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");

  return {
    text: text.trim(),
    reasoning: reasoning.length > 0 ? reasoning : null,
  };
}

/**
 * 递归地对任意 JSON 值内的每个字符串剥离内联思维链，返回清洗后的值与合并的思维链。
 * 用于工具调用参数：思维链模型可能把 `<think>` 写进 `record_captain_log.voice`、
 * `file_dissent.summary` 等字段，这些字段会进入玩家可见的航行志、异议账本、下一轮
 * prompt 与本地存档，必须在网关解析层就剥离。不含标签的字符串保持原样。
 */
export function scrubReasoningFromValue(value: unknown): {
  value: unknown;
  reasoning: string | null;
} {
  const captured: string[] = [];

  const walk = (input: unknown): unknown => {
    if (typeof input === "string") {
      const split = splitInlineReasoning(input);
      if (split.reasoning) captured.push(split.reasoning);
      return split.text;
    }
    if (Array.isArray(input)) {
      return input.map((entry) => walk(entry));
    }
    if (input !== null && typeof input === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(input)) {
        output[key] = walk(entry);
      }
      return output;
    }
    return input;
  };

  const scrubbed = walk(value);
  return {
    value: scrubbed,
    reasoning: captured.length > 0 ? captured.join("\n\n") : null,
  };
}
