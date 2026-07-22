import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Far Horizon mission shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-CN"/i);
  assert.match(html, /<title>远穹 · 星舰航程模拟<\/title>/i);
  assert.match(html, /远穹计划/);
  assert.match(html, /建立最高指令/);
  assert.match(html, /签发并移交全舰指挥权/);
  assert.match(html, /人工干预/);
  assert.match(html, /2,120/);
  assert.doesNotMatch(html, /react-loading-skeleton|Codex is working/i);
});

test("production source contains a real worker-backed simulator, not starter UI", async () => {
  const [page, layout, missionControl, simulationWorker, packageJson, css] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/mission-control.tsx", import.meta.url), "utf8"),
      readFile(new URL("../lib/sim/worker.ts", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);

  assert.match(page, /<MissionControl \/>/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(missionControl, /new Worker\(/);
  assert.match(missionControl, /SimulationWorkerCommand/);
  assert.match(missionControl, /runtimeSnapshot/);
  assert.match(simulationWorker, /SimulationEngine/);
  assert.match(simulationWorker, /applyExternalIntervention/);
  assert.match(css, /\.launch-layer/);
  assert.match(css, /\.sim-status-strip/);
  assert.match(css, /\.event-rail-toggle/);
  assert.match(css, /\.god-confirm-bar/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(missionControl, /environment:procedural/);
  assert.match(missionControl, /farhorizon-save/);
  assert.match(missionControl, /sim-status-strip/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(missionControl, /SkeletonPreview/);

  await assert.rejects(
    access(new URL("../app/_sites-preview/", import.meta.url)),
  );
  await access(new URL("../docs/PRODUCT_SPEC.md", import.meta.url));
  await access(new URL("../docs/ENGINE_ARCHITECTURE.md", import.meta.url));
  await access(new URL("../scripts/start-deepseek.mjs", import.meta.url));
  await access(new URL("../scripts/check-env.mjs", import.meta.url));
  await access(projectRoot);
});
