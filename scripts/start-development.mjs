import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  forwardTerminationSignals,
  installLocalLogCapture,
  pipeChildOutput,
} from "./local-log.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capture = installLocalLogCapture({ root, mode: "development" });
const cli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
const child = spawn(process.execPath, [cli, "dev", ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

pipeChildOutput(child);
forwardTerminationSignals(child);

child.on("error", (error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      scope: "local-runtime",
      event: "development.spawn.failed",
      details: { error: { name: error.name, message: error.message } },
    }),
  );
  capture.close();
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: code === 0 ? "info" : "warn",
      scope: "local-runtime",
      event: "development.process.closed",
      details: { code, signal },
    }),
  );
  capture.close();
  process.exitCode = code ?? (signal ? 1 : 0);
});

