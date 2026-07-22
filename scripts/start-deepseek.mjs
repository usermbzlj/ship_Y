import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const BASE_URL_LINE = /^\s*Base URL\s*[:=\uFF1A]/;
const API_KEY_LINE = /^\s*API Key\s*[:=\uFF1A]/;
const URL_IN_LINE = /https?:\/\/\S+/;

function parseArgs(argv) {
  const options = {
    port: 3000,
    host: "127.0.0.1",
    model: "deepseek-v4-flash",
    thinking: "disabled",
    credential: "",
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg.startsWith("--model=")) {
      options.model = arg.slice("--model=".length);
    } else if (arg.startsWith("--thinking=")) {
      options.thinking = arg.slice("--thinking=".length);
    } else if (arg.startsWith("--credential=")) {
      options.credential = arg.slice("--credential=".length);
    }
  }

  return options;
}

function findCredentialFile() {
  const candidates = readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => join(projectRoot, entry.name));

  for (const filePath of candidates) {
    const text = readFileSync(filePath, "utf8");
    if (BASE_URL_LINE.test(text) && API_KEY_LINE.test(text)) {
      return filePath;
    }
  }

  throw new Error(
    "No local .txt credential file with Base URL and API Key lines was found.",
  );
}

function parseCredentials(credentialPath) {
  const lines = readFileSync(credentialPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const baseUrlLine = lines.find((line) => BASE_URL_LINE.test(line));
  const apiKeyLine = lines.find((line) => API_KEY_LINE.test(line));

  const baseUrlMatch = baseUrlLine ? URL_IN_LINE.exec(baseUrlLine) : null;
  const apiKey = apiKeyLine
    ? apiKeyLine.replace(/^\s*API Key\s*[:=\uFF1A]\s*/, "").trim()
    : "";

  if (!baseUrlMatch || !apiKey) {
    throw new Error(
      "Credential file must contain 'Base URL: https://...' and 'API Key: ...' lines.",
    );
  }

  return {
    baseUrl: baseUrlMatch[0].replace(/\/+$/, ""),
    apiKey,
  };
}

function maxTokensForAgent(agentId) {
  if (agentId === "captain") {
    return 1200;
  }
  if (agentId === "passenger-service") {
    return 500;
  }
  return 700;
}

function configureAgents(configuration, { baseUrl, apiKey, model, thinking }) {
  for (const agent of configuration.agents) {
    agent.endpoint.url = `${baseUrl}/chat/completions`;
    agent.endpoint.bodyTemplate.model = model;
    agent.endpoint.bodyTemplate.thinking = { type: thinking };
    agent.endpoint.bodyTemplate.max_tokens = maxTokensForAgent(agent.id);

    if (thinking === "enabled") {
      agent.endpoint.bodyTemplate.reasoning_effort = "high";
    } else {
      delete agent.endpoint.bodyTemplate.reasoning_effort;
    }

    agent.endpoint.requestTimeoutMs = 120000;

    for (const secretHeader of agent.endpoint.secretHeaders ?? []) {
      process.env[secretHeader.secretRef] = apiKey;
    }
  }
}

function main() {
  const options = parseArgs(process.argv);

  const credentialPath = options.credential
    ? resolve(options.credential)
    : findCredentialFile();
  const { baseUrl, apiKey } = parseCredentials(credentialPath);

  const configurationPath = join(projectRoot, "config", "llm.example.json");
  const configuration = JSON.parse(readFileSync(configurationPath, "utf8"));

  configureAgents(configuration, {
    baseUrl,
    apiKey,
    model: options.model,
    thinking: options.thinking,
  });

  process.env.LLM_CONFIG_JSON = JSON.stringify(configuration);
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "true";

  const provider = new URL(baseUrl).hostname;
  console.log(
    `Far Horizon LLM: provider=${provider} model=${options.model} thinking=${options.thinking} fixed-slots=40`,
  );
  console.log(
    `Credential remains process-local; starting http://${options.host}:${options.port}`,
  );

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(
    npm,
    ["run", "dev", "--", "--host", options.host, "--port", String(options.port)],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}

main();
