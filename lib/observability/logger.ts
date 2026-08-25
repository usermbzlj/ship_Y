export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogEntry = {
  timestamp: string;
  level: Exclude<LogLevel, "silent">;
  scope: string;
  event: string;
  context?: Record<string, unknown>;
  details?: Record<string, unknown>;
};

export type LogSink = (entry: LogEntry) => void;

export type Logger = {
  debug(event: string, details?: Record<string, unknown>): void;
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
};

export type CreateLoggerOptions = {
  minLevel?: LogLevel;
  context?: Record<string, unknown>;
  sink?: LogSink;
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};
const MAX_LOG_BUFFER_ENTRIES = 500;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 80;
const MAX_STRING_LENGTH = 4_000;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /api[-_]?key|authorization|bearer|cookie|set[-_]?cookie|credential|password|secret|private[-_]?key|token(s)?$|system[-_]?prompt|prompt|messages|request[-_]?body|response[-_]?body|world[-_]?context|previous[-_]?rejection/i;
/**
 * Redacts secret-looking substrings anywhere inside a string (not just when the
 * whole value is a token). Covers bearer tokens, `sk-` keys, JWTs, and
 * `secret=`/`token=` style query parameters that can ride along in URLs, error
 * messages, and stack traces.
 */
function scrubSecretsFromString(value: string): string {
  let out = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, REDACTED)
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/gi, REDACTED)
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g,
      REDACTED,
    );
  out = out.replace(
    /\b(api[-_]?key|api[-_]?secret|access[-_]?token|refresh[-_]?token|token|secret|password)=([^&\s"'#]+)/gi,
    (_match, key: string) => `${key}=${REDACTED}`,
  );
  return out;
}

declare global {
  // Deliberately exposed for local diagnostics. Entries are already sanitized.
  var __FAR_HORIZON_LOGS__: LogEntry[] | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function sanitizeInternal(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return truncate(scrubSecretsFromString(value));
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return String(value);
  if (depth >= MAX_DEPTH) return "[max-depth]";

  if (value instanceof Error) {
    if (seen.has(value)) return "[circular-error]";
    seen.add(value);
    const errorRecord: Record<string, unknown> = {
      name: value.name,
      message: truncate(scrubSecretsFromString(value.message)),
      ...(value.stack
        ? { stack: truncate(scrubSecretsFromString(value.stack)) }
        : {}),
    };
    const errorWithCause = value as Error & { cause?: unknown; code?: unknown };
    if (errorWithCause.code !== undefined) {
      errorRecord.code = sanitizeInternal(errorWithCause.code, seen, depth + 1);
    }
    if (errorWithCause.cause !== undefined) {
      errorRecord.cause = sanitizeInternal(errorWithCause.cause, seen, depth + 1);
    }
    return errorRecord;
  }

  if (typeof value !== "object") return truncate(String(value));
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeInternal(item, seen, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`);
    }
    return items;
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  for (const [key, item] of entries) {
    result[key] = isSensitiveKey(key)
      ? REDACTED
      : sanitizeInternal(item, seen, depth + 1);
  }
  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    result.__truncatedKeys = Object.keys(value).length - MAX_OBJECT_KEYS;
  }
  return result;
}

/**
 * Converts unknown values into bounded, JSON-safe diagnostic data. Sensitive
 * fields are removed by key before any sink receives the entry.
 */
export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeInternal(value, new WeakSet<object>(), 0);
}

export function parseLogLevel(
  value: string | null | undefined,
  fallback: LogLevel = "info",
): LogLevel {
  const normalized = value?.trim().toLowerCase();
  return LOG_LEVELS.includes(normalized as LogLevel)
    ? (normalized as LogLevel)
    : fallback;
}

function configuredLogLevel(): LogLevel {
  if (typeof process === "undefined") return "info";
  const configured =
    typeof window === "undefined"
      ? process.env.LOG_LEVEL
      : process.env.NEXT_PUBLIC_LOG_LEVEL;
  if (!configured && process.env.NODE_TEST_CONTEXT) return "silent";
  return parseLogLevel(configured, process.env.NODE_ENV === "development" ? "debug" : "info");
}

function recentLogBuffer(): LogEntry[] {
  globalThis.__FAR_HORIZON_LOGS__ ??= [];
  return globalThis.__FAR_HORIZON_LOGS__;
}

function defaultSink(entry: LogEntry): void {
  const buffer = recentLogBuffer();
  buffer.push(entry);
  if (buffer.length > MAX_LOG_BUFFER_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_LOG_BUFFER_ENTRIES);
  }

  const method = entry.level === "debug" ? "debug" : entry.level;
  if (typeof window === "undefined") {
    console[method](JSON.stringify(entry));
  } else {
    console[method](`[far-horizon:${entry.scope}] ${entry.event}`, entry);
  }
}

function sanitizeRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const sanitized = sanitizeLogValue(value);
  return isRecord(sanitized) ? sanitized : undefined;
}

export function createLogger(
  scope: string,
  options: CreateLoggerOptions = {},
): Logger {
  const minLevel = options.minLevel ?? configuredLogLevel();
  const sink = options.sink ?? defaultSink;
  const baseContext = sanitizeRecord(options.context);

  const emit = (
    level: Exclude<LogLevel, "silent">,
    event: string,
    details?: Record<string, unknown>,
  ) => {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      event,
      ...(baseContext ? { context: baseContext } : {}),
      ...(details ? { details: sanitizeRecord(details) ?? {} } : {}),
    };
    sink(entry);
  };

  return {
    debug: (event, details) => emit("debug", event, details),
    info: (event, details) => emit("info", event, details),
    warn: (event, details) => emit("warn", event, details),
    error: (event, details) => emit("error", event, details),
    child: (context) =>
      createLogger(scope, {
        minLevel,
        sink,
        context: {
          ...(baseContext ?? {}),
          ...context,
        },
      }),
  };
}

export function getRecentLogEntries(): readonly LogEntry[] {
  return [...recentLogBuffer()];
}

export function clearRecentLogEntries(): void {
  recentLogBuffer().length = 0;
}
