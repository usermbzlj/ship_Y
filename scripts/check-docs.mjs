import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function walkMarkdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    return extname(entry.name).toLowerCase() === ".md" ? [path] : [];
  });
}

function relativeToRoot(path) {
  return path.slice(root.length + 1).replaceAll("\\", "/");
}

const markdownFiles = [resolve(root, "README.md"), ...walkMarkdown(resolve(root, "docs"))];
const markdownByPath = new Map(
  markdownFiles.map((path) => [path, readFileSync(path, "utf8")]),
);

for (const [path, contents] of markdownByPath) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of contents.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    } else {
      target = target.split(/\s+["']/u, 1)[0];
    }
    if (!target || target.startsWith("#") || /^[a-z][a-z\d+.-]*:/iu.test(target)) {
      continue;
    }
    target = target.split("#", 1)[0].split("?", 1)[0];
    try {
      target = decodeURIComponent(target);
    } catch {
      failures.push(`${relativeToRoot(path)}: 无法解码链接 ${match[1]}`);
      continue;
    }
    const resolvedTarget = resolve(dirname(path), target);
    if (!existsSync(resolvedTarget)) {
      failures.push(`${relativeToRoot(path)}: 链接目标不存在 ${match[1]}`);
    }
  }
}

const allMarkdown = [...markdownByPath.values()].join("\n");
for (const [pattern, message] of [
  [/时间倍率五档/u, "仍存在过时的五档时间倍率描述"],
  [/航程 \/ 舰体 \/ 乘员 \/ AI \/ 上帝 五视图/u, "仍存在旧版五视图名称"],
  [/任务控制台 UX 2\.0/u, "仍存在旧版任务控制台 UX 状态"],
  [/IndexedDB[^\n]{0,40}未实现/u, "仍声称 IndexedDB 未实现（手动单槽已落地）"],
  [/DeepSeek V4 Pro/u, "文档或常量不应硬编码虚构供应商型号展示名"],
]) {
  if (pattern.test(allMarkdown)) failures.push(message);
}

const status = readFileSync(resolve(root, "docs/PROJECT_STATUS.md"), "utf8");
const versionChecks = [
  [resolve(root, "app/ui/types.ts"), /version:\s*(\d+);/u, "本地存档封装"],
  [resolve(root, "lib/sim/protocol.ts"), /snapshotVersion:\s*(?:\d+\s*\|\s*)*(\d+);/u, "Worker 运行时"],
  [resolve(root, "lib/sim/water.ts"), /WATER_RECOVERY_SNAPSHOT_VERSION\s*=\s*(\d+)/u, "水回收"],
  [resolve(root, "lib/sim/cooling.ts"), /COOLING_SNAPSHOT_VERSION\s*=\s*(\d+)/u, "冷却"],
  [resolve(root, "lib/sim/maintenance.ts"), /MAINTENANCE_SNAPSHOT_VERSION\s*=\s*(\d+)/u, "维修"],
  [resolve(root, "lib/sim/captain-operations.ts"), /CAPTAIN_OPERATIONS_SNAPSHOT_VERSION\s*=\s*(\d+)/u, "舰长运营"],
];

const runtimeVersionMatch = readFileSync(
  resolve(root, "lib/sim/protocol.ts"),
  "utf8",
).match(/snapshotVersion:\s*(?:\d+\s*\|\s*)*(\d+);/u);
const runtimeVersion = runtimeVersionMatch?.[1] ?? null;

const localSaveVersionMatch = readFileSync(
  resolve(root, "app/ui/types.ts"),
  "utf8",
).match(/version:\s*(\d+);/u);
const localSaveVersion = localSaveVersionMatch?.[1] ?? null;

for (const [path, pattern, label] of versionChecks) {
  const match = readFileSync(path, "utf8").match(pattern);
  if (!match) {
    failures.push(`无法从 ${relativeToRoot(path)} 读取${label}版本`);
  } else if (!status.includes(`| ${label} | \`v${match[1]}\``)) {
    failures.push(`docs/PROJECT_STATUS.md 未同步${label} v${match[1]}`);
  }
}

const currentStateDocs = [
  resolve(root, "docs/PROJECT_STATUS.md"),
  resolve(root, "docs/PRODUCT_SPEC.md"),
  resolve(root, "docs/ENGINE_ARCHITECTURE.md"),
  resolve(root, "README.md"),
];

const migrationWindowRe = /读取|归一|可读取|迁移|仍接受|读取旧|从 `v\d+` 升/u;

function isMigrationWindow(text, matchIndex, matchLength) {
  const window = text.slice(
    Math.max(0, matchIndex - 40),
    Math.min(text.length, matchIndex + matchLength + 40),
  );
  return migrationWindowRe.test(window);
}

// Current-state docs must not claim an older Worker runtime as "current".
// Archived handoffs under docs/archive/handoff/ may still describe older runtime versions.
if (runtimeVersion) {
  for (const docPath of currentStateDocs) {
    if (!existsSync(docPath)) continue;
    const text = markdownByPath.get(docPath) ?? readFileSync(docPath, "utf8");
    const rel = relativeToRoot(docPath);
    for (const match of text.matchAll(
      /运行时(?:快照)?(?:仍\s*)?`v(\d+)`|内含运行时快照 `v(\d+)`|snapshotVersion:\s*(\d+)/gu,
    )) {
      const claimed = match[1] ?? match[2] ?? match[3];
      if (claimed && claimed !== runtimeVersion) {
        // Allow adjacent migration lists like v16/v17 when documenting compatibility.
        if (isMigrationWindow(text, match.index ?? 0, match[0].length)) continue;
        failures.push(
          `${rel}: 当前态文档声称运行时 v${claimed}，代码为 v${runtimeVersion}`,
        );
      }
    }
  }
}

// Current-state docs must not claim a wrong LocalSave envelope as "current".
// Archive docs and migration windows (读取/归一/可读取/迁移) are skipped.
if (localSaveVersion) {
  for (const docPath of currentStateDocs) {
    if (!existsSync(docPath)) continue;
    const text = markdownByPath.get(docPath) ?? readFileSync(docPath, "utf8");
    const rel = relativeToRoot(docPath);
    for (const match of text.matchAll(
      /本地存档封装\s*`v(\d+)`|外层\s+LocalSave\s*`v(\d+)`|LocalSave\s*`v(\d+)`|本地存档封装\s*`version:\s*(\d+)`|`version:\s*(\d+)`/gu,
    )) {
      const claimed =
        match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
      if (claimed && claimed !== localSaveVersion) {
        if (isMigrationWindow(text, match.index ?? 0, match[0].length)) continue;
        failures.push(
          `${rel}: 当前态文档声称 LocalSave v${claimed}，代码为 v${localSaveVersion}`,
        );
      }
    }
  }
}

try {
  JSON.parse(readFileSync(resolve(root, "config/llm.example.json"), "utf8"));
} catch (error) {
  failures.push(`config/llm.example.json 不是有效 JSON：${error.message}`);
}

const envExample = readFileSync(resolve(root, ".env.example"), "utf8");
for (const key of [
  "SHIP_CAPTAIN_LLM_API_KEY",
  "SHIP_NAVIGATION_LLM_API_KEY",
  "SHIP_ENGINEERING_LLM_API_KEY",
  "SHIP_LIFE_SUPPORT_LLM_API_KEY",
  "SHIP_MEDICAL_LLM_API_KEY",
  "SHIP_PASSENGER_AFFAIRS_LLM_API_KEY",
  "SHIP_SECURITY_LLM_API_KEY",
  "SHIP_PASSENGER_SERVICE_LLM_API_KEY",
  "SHIP_GOD_ASSIST_LLM_API_KEY",
]) {
  if (!new RegExp(`^${key}=\\s*$`, "mu").test(envExample)) {
    failures.push(`.env.example 缺少空值模板 ${key}`);
  }
}

if (existsSync(resolve(root, ".git")) && statSync(resolve(root, ".git")).isDirectory()) {
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean),
  );
  for (const privatePath of [
    ".env.local",
    "config/llm.local.json",
    "deepseek-credentials.txt",
    ".openai/hosting.json",
  ]) {
    if (tracked.has(privatePath)) failures.push(`本机私有文件被 Git 跟踪：${privatePath}`);
  }
}

if (failures.length > 0) {
  console.error("文档与示例配置检查失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`文档检查通过：${markdownFiles.length} 个 Markdown 文件，链接与版本摘要一致。`);
}
