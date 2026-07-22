/**
 * 舰载 LLM 可读输出契约与消毒：禁止舰长日志 / 伪表格 / 遥测复读墙。
 * 契约文案的真相源在 lib/llm/prompts；此处再导出供 UI 使用。
 */

export {
  CAPTAIN_DECISION_INSTRUCTION,
  DEPARTMENT_CONSULTATION_REQUEST,
  LLM_OUTPUT_STYLE_CONTRACT,
} from "../../lib/llm/prompts/index.ts";

const REPORT_TITLE_RE =
  /舰长日志|例行系统状态|系统总览|详细评估|状态评估/;

const TELEMETRY_SUBSYSTEM_RE =
  /反应堆|储能|生命保障|电网|舱压|冷却|推进|跃迁|氧气|二氧化碳|温度|湿度|辐射|水回收|居住环/;

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(trimmed)) {
    return true;
  }
  const pipes = (trimmed.match(/\|/g) ?? []).length;
  return pipes >= 2;
}

/** 一行内 ≥3 个被空白隔开的孤立「·」视为伪表行 */
function isDotPseudoTableRow(line: string): boolean {
  const isolated = line.match(/(?:^|\s)·(?=\s|$)/g);
  return (isolated?.length ?? 0) >= 3;
}

/** 伪表/表行：整行丢弃；混排时只保留符号簇之前的短结论 */
function prosePrefixBeforePseudoTable(line: string): string {
  const trimmed = line.trim();
  if (isMarkdownTableRow(trimmed)) {
    if (trimmed.startsWith("|") || /^\|?\s*:?-{3,}/.test(trimmed)) {
      return "";
    }
  }
  if (isDotPseudoTableRow(line)) {
    const cut = line.search(/\s·\s/);
    if (cut <= 0) return "";
    const prefix = line.slice(0, cut).trim();
    // 「反应堆 · 82% · …」这类整行遥测表直接丢弃
    if (!prefix || TELEMETRY_SUBSYSTEM_RE.test(prefix)) return "";
    if (prefix.length < 6) return "";
    return prefix;
  }
  if (!isMarkdownTableRow(line)) {
    return line;
  }
  const pipeCut = line.search(/\s\|/);
  if (pipeCut <= 0) return "";
  return line.slice(0, pipeCut).trim();
}

function firstValidSentence(text: string): string {
  const cleaned = text
    .replace(/^[\s,，、:：;；…—\-·.。]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const match = cleaned.match(/^[\s\S]*?[。！？!?]/);
  if (match) return match[0].trim();
  const beforeList = cleaned.split(/\s+\d+[.)]\s+/)[0]?.trim() ?? cleaned;
  return beforeList;
}

function collapseReportBody(text: string): string {
  const match = text.match(REPORT_TITLE_RE);
  if (!match || match.index === undefined) {
    // 无标题但仍是遥测墙：砍到第一句或伪表前
    const cut = text.search(/(?:\s---\s|\s\d+[.)]\s+|\s·\s*(?:系统|状态|备注|反应堆))/);
    const head = cut >= 0 ? text.slice(0, cut) : text;
    return firstValidSentence(head) || firstValidSentence(text);
  }

  const prefix = text.slice(0, match.index).trim();
  let after = text.slice(match.index + match[0].length);
  after = after.replace(/^[\s:：…—\-·.。，,、第\d秒小时（）()]+/, " ");

  const hr = after.search(/\n?\s*---\s*\n?/);
  if (hr >= 0) after = after.slice(0, hr);

  const tableBreak = after.search(
    /\s(?:\d+[.)]\s+|·\s*(?:系统|状态|备注|反应堆|储能|生命)|\|\s*[-:])/,
  );
  if (tableBreak >= 0) after = after.slice(0, tableBreak);

  const paragraph = (after.split(/\n\s*\n/)[0] ?? after)
    .split("\n")
    .filter((line) => !/^\s*\d+[.)]\s+/.test(line))
    .join(" ");

  const overview = paragraph.match(
    /(?:系统总览|结论|摘要)\s*[:：]?\s*([^。！？!?]+[。！？!?]?)/,
  );
  let core =
    (overview?.[1] ? firstValidSentence(overview[1]) : "") ||
    firstValidSentence(paragraph) ||
    firstValidSentence(after);

  // 「好的，舰长日志…」这类前缀无信息，丢弃寒暄
  const usefulPrefix = prefix.replace(/^(好的|收到|明白|了解)[，,、\s]*/u, "");
  if (usefulPrefix && usefulPrefix.length <= 24 && !REPORT_TITLE_RE.test(usefulPrefix)) {
    core = [usefulPrefix.replace(/[，,、\s]+$/g, ""), core]
      .filter(Boolean)
      .join("，");
  }

  return core || usefulPrefix || firstValidSentence(text);
}

/** 检测是否为遥测/仪表复读墙，供调用方截断 */
export function isTelemetryDump(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (REPORT_TITLE_RE.test(normalized)) return true;
  // 按行判断伪表，避免整段多行文本被误判成「一行表」
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (
    lines.some(
      (line) => isMarkdownTableRow(line.trim()) || isDotPseudoTableRow(line),
    )
  ) {
    return true;
  }
  const subsystems = normalized.match(
    new RegExp(TELEMETRY_SUBSYSTEM_RE.source, "g"),
  );
  const numbers = normalized.match(
    /\d+(?:\.\d+)?\s*(?:%|℃|°C|kPa|MPa|MW|kW|MWh|kWh|kg|t|人|K|RPM|G)?/g,
  );
  return (subsystems?.length ?? 0) >= 3 && (numbers?.length ?? 0) >= 4;
}

/**
 * 删除表格/伪表/报告体分节，压缩空白。
 * 不把 `|` 换成 ` · `。
 */
export function sanitizeLlmReadableText(value: string): string {
  if (!value) return "";

  let text = value.replace(/\r\n/g, "\n");

  // 先抽结论，再剥表，避免整段单行伪表被删光
  if (REPORT_TITLE_RE.test(text)) {
    text = collapseReportBody(text);
  }

  const keptLines = text
    .split("\n")
    .map(prosePrefixBeforePseudoTable)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (isMarkdownTableRow(trimmed)) return false;
      if (isDotPseudoTableRow(trimmed)) return false;
      return true;
    });
  text = keptLines.join("\n");

  text = text
    .replace(/\|+/g, " ")
    .replace(/(?:\s·){2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  // 清表后仍是遥测墙 / 过长报告，才压成一句
  const stillDump =
    REPORT_TITLE_RE.test(text) ||
    ((text.match(new RegExp(TELEMETRY_SUBSYSTEM_RE.source, "g"))?.length ??
      0) >= 3 &&
      (text.match(
        /\d+(?:\.\d+)?\s*(?:%|℃|°C|kPa|MPa|MW|kW|MWh|kWh|kg|t|人|K|RPM|G)?/g,
      )?.length ?? 0) >= 4);
  if (stillDump || text.length > 180) {
    text = firstValidSentence(text) || text.slice(0, 80).trim();
  }

  return text;
}

/** 把 LLM 返回文本消毒并压缩为时间线摘要（表格只删、不转伪表） */
export function compactLlmTimelineText(
  value: string,
  maximumLength: number,
  fallback: string,
): string {
  const plainText = sanitizeLlmReadableText(value)
    .replace(/```[A-Za-z0-9_-]*\s*/g, "")
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[\*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plainText) return fallback;
  if (plainText.length <= maximumLength) return plainText;
  return `${plainText.slice(0, Math.max(1, maximumLength - 1)).trimEnd()}…`;
}
