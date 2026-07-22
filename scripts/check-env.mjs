import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const MIN_NODE_VERSION = [22, 13, 0];

const DEFAULT_SECRET_REFS = [
  "SHIP_CAPTAIN_LLM_API_KEY",
  "SHIP_NAVIGATION_LLM_API_KEY",
  "SHIP_ENGINEERING_LLM_API_KEY",
  "SHIP_LIFE_SUPPORT_LLM_API_KEY",
  "SHIP_MEDICAL_LLM_API_KEY",
  "SHIP_PASSENGER_AFFAIRS_LLM_API_KEY",
  "SHIP_SECURITY_LLM_API_KEY",
  "SHIP_PASSENGER_SERVICE_LLM_API_KEY",
];

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function meetsMinVersion(actual, minimum) {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > minimum[index]) {
      return true;
    }
    if (actual[index] < minimum[index]) {
      return false;
    }
  }
  return true;
}

/** Load KEY=VALUE pairs from a dotenv file into process.env if unset. */
function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return false;
  }

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, name)) {
      process.env[name] = value;
    }
  }
  return true;
}

function checkNodeVersion() {
  const version = parseVersion(process.version);
  const ok = meetsMinVersion(version, MIN_NODE_VERSION);
  const required = MIN_NODE_VERSION.join(".");
  const actual = version.join(".");
  console.log(`Node ${actual}: ${ok ? "ok" : `needs >= ${required}`}`);
  return ok;
}

function loadExampleConfig() {
  const configPath = join(projectRoot, "config", "llm.example.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  if (!config.fixedTopology || !Array.isArray(config.agents)) {
    throw new Error(
      "config/llm.example.json must include fixedTopology and agents.",
    );
  }

  console.log(
    `config/llm.example.json: ok (topology=${config.fixedTopology.kind}, agents=${config.agents.length})`,
  );
  return config;
}

function checkLocalConfigFile() {
  const localPath = join(projectRoot, "config", "llm.local.json");
  if (!existsSync(localPath)) {
    console.log("config/llm.local.json: not found");
    return null;
  }

  const config = JSON.parse(readFileSync(localPath, "utf8"));
  const model = config.agents?.[0]?.endpoint?.bodyTemplate?.model ?? "?";
  const thinking = config.agents?.[0]?.endpoint?.bodyTemplate?.thinking;
  const url = config.agents?.[0]?.endpoint?.url ?? "?";
  console.log(
    `config/llm.local.json: ok (agents=${config.agents?.length ?? "?"}, model=${model}, thinking=${JSON.stringify(thinking)}, host=${safeHost(url)})`,
  );
  return config;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

function checkLlmConfigJson() {
  const raw = process.env.LLM_CONFIG_JSON;
  if (!raw || raw.trim().length === 0) {
    console.log("LLM_CONFIG_JSON: not set");
    return false;
  }

  const config = JSON.parse(raw);
  const model = config.agents?.[0]?.endpoint?.bodyTemplate?.model ?? "?";
  const thinking = config.agents?.[0]?.endpoint?.bodyTemplate?.thinking;
  console.log(
    `LLM_CONFIG_JSON: ok (agents=${Array.isArray(config.agents) ? config.agents.length : "?"}, model=${model}, thinking=${JSON.stringify(thinking)})`,
  );
  return true;
}

function checkSecrets() {
  const results = DEFAULT_SECRET_REFS.map((name) => ({
    name,
    present: Boolean(process.env[name] && process.env[name].length > 0),
  }));

  for (const { name, present } of results) {
    console.log(`${name}: ${present ? "present" : "missing"}`);
  }

  return results;
}

function main() {
  const envLocalPath = join(projectRoot, ".env.local");
  const loadedEnvLocal = loadDotEnvFile(envLocalPath);
  console.log(
    `.env.local: ${loadedEnvLocal ? "loaded (secrets not printed)" : "not found"}`,
  );

  const nodeOk = checkNodeVersion();
  loadExampleConfig();
  checkLocalConfigFile();
  const llmConfigSet = checkLlmConfigJson();
  const secretResults = checkSecrets();

  const missingSecrets = secretResults.filter(({ present }) => !present).length;
  const allSecretsPresent = missingSecrets === 0;
  const physicsReady = nodeOk;
  const aiReady = physicsReady && llmConfigSet && allSecretsPresent;

  console.log("");
  console.log(`Ready for physics-only: ${physicsReady ? "yes" : "no"}`);
  console.log(`Ready for AI: ${aiReady ? "yes" : "no"}`);
  if (!allSecretsPresent) {
    console.log(`Missing secrets: ${missingSecrets}`);
  }

  process.exit(0);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
