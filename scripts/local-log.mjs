import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

function timestampForFile(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function writeChunk(streams, chunk, encoding) {
  const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding);
  for (const stream of streams) stream.write(value);
}

/**
 * Tees this Node process' stdout/stderr to logs/latest.log and one immutable
 * session file. App structured JSON from `createLogger` is sanitized at emit
 * time; this tee is intentionally raw so vinext/tool plaintext, stack traces,
 * and non-JSON console noise stay chronologically reconstructible. Do not
 * treat disk logs as fully auto-redacted.
 */
export function installLocalLogCapture({ root, mode }) {
  const logsDirectory = path.join(root, "logs");
  mkdirSync(logsDirectory, { recursive: true });
  const sessionFile = path.join(
    logsDirectory,
    `${mode}-${timestampForFile()}.log`,
  );
  const latestFile = path.join(logsDirectory, "latest.log");
  const sessionStream = createWriteStream(sessionFile, { flags: "a" });
  const latestStream = createWriteStream(latestFile, { flags: "w" });
  const streams = [sessionStream, latestStream];

  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) => {
    writeChunk(streams, chunk, typeof encoding === "string" ? encoding : undefined);
    return stdoutWrite(chunk, encoding, callback);
  };
  process.stderr.write = (chunk, encoding, callback) => {
    writeChunk(streams, chunk, typeof encoding === "string" ? encoding : undefined);
    return stderrWrite(chunk, encoding, callback);
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const stream of streams) stream.end();
  };
  process.once("exit", close);

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      scope: "local-runtime",
      event: "log.session.started",
      details: { mode, sessionFile, latestFile, pid: process.pid },
    }),
  );
  return { sessionFile, latestFile, close };
}

export function pipeChildOutput(child) {
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
}

export function forwardTerminationSignals(child) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
}

