import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logPath = path.join(root, "logs", "latest.log");
const lineArg = process.argv.find((arg) => arg.startsWith("--lines="));
const requested = Number.parseInt(lineArg?.slice("--lines=".length) ?? "200", 10);
const lineCount = Number.isInteger(requested) && requested > 0 ? requested : 200;

if (!existsSync(logPath)) {
  console.error(`No local runtime log exists yet: ${logPath}`);
  process.exitCode = 1;
} else {
  const lines = readFileSync(logPath, "utf8").split(/\r?\n/);
  // drop a trailing empty line from a final newline, then take the last N lines
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  console.log(lines.slice(Math.max(0, lines.length - lineCount)).join("\n"));
}

