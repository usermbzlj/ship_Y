import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = path.join(root, "tests");
const heavyRelativePaths = new Set([
  "sim/captain-authority-worker.test.mjs",
  "sim/long-voyage-conservation-smoke.test.mjs",
  "sim/time-survival-golden.test.mjs",
  "sim/worker-runtime.test.mjs",
]);

function collectTestFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      files.push(absolute);
    }
  }
  return files;
}

const suiteArg = process.argv.find((arg) => arg.startsWith("--suite="));
const suite = suiteArg?.slice("--suite=".length) ?? "fast";
if (suite !== "fast" && suite !== "heavy") {
  throw new Error(`Unsupported test suite: ${suite}`);
}

const selected = collectTestFiles(testsRoot)
  .filter((file) => {
    const relative = path.relative(testsRoot, file).split(path.sep).join("/");
    return suite === "heavy"
      ? heavyRelativePaths.has(relative)
      : !heavyRelativePaths.has(relative);
  })
  .sort();

// Test files import `.ts` sources directly and rely on TypeScript type
// stripping. That is on by default from Node 22.18 / 23.6, but the project's
// engines floor is 22.13.0, so enable it explicitly on older runtimes.
function supportsDefaultTypeStripping([major, minor]) {
  if (major > 23) return true;
  if (major === 23) return minor >= 6;
  if (major === 22) return minor >= 18;
  return false;
}
const nodeVersion = process.versions.node.split(".").map(Number);
const typeStrippingFlags = supportsDefaultTypeStripping(nodeVersion)
  ? []
  : ["--experimental-strip-types", "--no-warnings=ExperimentalWarning"];

console.log(
  `Running ${suite} suite: ${selected.length} files (${suite === "heavy" ? "serial" : "concurrency=4"})`,
);
const result = spawnSync(
  process.execPath,
  [
    ...typeStrippingFlags,
    "--test",
    `--test-concurrency=${suite === "heavy" ? 1 : 4}`,
    ...selected,
  ],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

