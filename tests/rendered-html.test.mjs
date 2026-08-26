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
  assert.match(html, /你决定它为何出发/);
  assert.match(html, /把全舰交给 AI 舰长之后/);
  assert.match(html, /og\.png/);
  assert.match(html, /人工干预/);
  assert.match(html, /2,120/);
  assert.doesNotMatch(html, /react-loading-skeleton|Codex is working/i);
  assert.doesNotMatch(html, /名乘员/);
  assert.doesNotMatch(html, /当前清醒/);
});

test("idle-list empty states distinguish pre-launch from launched-but-idle", async () => {
  const [aiView, peopleView, missionControl] = await Promise.all([
    readFile(new URL("../app/ui/views/ai-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/views/people-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/mission-control.tsx", import.meta.url), "utf8"),
  ]);

  // 「等待签发」只在任务尚未签发时成立。AI 观察页的航行志 / 部门异议 / 观察哨三处空态
  // 原先无条件渲染这句：任务跑起来、舰长已经在写航行志时，界面仍宣称在等签发，
  // 而「部门异议」更会一边列出各部门立场统计一边说等签发，自相矛盾。
  assert.match(aiView, /missionStarted: boolean/);
  assert.match(missionControl, /missionStarted=\{missionStarted\}/);
  assert.equal((aiView.match(/\{missionStarted \? \(/g) ?? []).length, 3);
  // 「等待签发」空态（航行志 / 部门异议 / 观察哨 / 收件箱）都必须受任务状态门控。
  assert.equal((aiView.match(/等待签发/g) ?? []).length, 4);

  // 乘员页传言板同理；离线与在线两个调用点都传入真实的 missionStarted。
  assert.match(peopleView, /missionStarted: boolean/);
  assert.match(peopleView, /missionStarted=\{missionStarted\}/);
  assert.match(peopleView, /未经证实的传言会出现在这里/);
});

test("production source contains a real worker-backed simulator, not starter UI", async () => {
  const [
    page,
    layout,
    missionControl,
    captainDecisionTrigger,
    godInterventions,
    simulationWorker,
    simulationInterventions,
    packageJson,
    css,
    peopleView,
    useLocalSave,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/mission-control.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/llm/captain-decision-trigger.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/mission-control/use-god-interventions.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/sim/worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sim/interventions.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/views/people-view.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/mission-control/use-local-save.ts", import.meta.url),
      "utf8",
    ),
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
  // 程序化事件仍以 environment:procedural 身份注入物理因果；构造逻辑已下沉到 interventions。
  assert.match(simulationInterventions, /environment:procedural/);
  assert.match(simulationWorker, /ProceduralWorldScheduler/);
  assert.match(simulationWorker, /SimulationTimeDirector/);
  // Local-save I/O now lives in the extracted use-local-save hook.
  assert.match(useLocalSave, /local-save-idb/);
  assert.match(useLocalSave, /putManualSave/);
  assert.match(useLocalSave, /migrateLocalStorageSaveOnce/);
  assert.match(missionControl, /TimeControlBar/);
  assert.match(missionControl, /sim-status-strip/);
  assert.match(missionControl, /showSecondarySimStatus/);
  assert.match(missionControl, /仿真已暂停 · 等待 AI 舰长研判/);
  assert.match(missionControl, /保真度锁定 · 有效推进倍率已受限/);
  assert.match(missionControl, /hullThreat/);
  assert.match(missionControl, /buildFullAuthorizedObservation/);
  assert.match(missionControl, /truthConditions/);
  assert.match(captainDecisionTrigger, /hull-threat:/);
  assert.match(simulationInterventions, /passenger-emergency/);
  assert.match(godInterventions, /不支持的因果事件类型/);
  assert.match(
    useLocalSave,
    /此外层存档格式为 LocalSave v18，已不再支持/,
  );
  assert.doesNotMatch(missionControl, /snapshot v16/);
  assert.match(missionControl, /knownAlertIds\.current\.clear\(\)/);
  assert.match(missionControl, /setCaptainDecisionLog\(\[\]\)/);
  assert.match(missionControl, /autoResolveOpenDepartmentDissents/);
  assert.match(missionControl, /onResolveDepartmentDissent/);

  const [alertBanner, aiConstants] = await Promise.all([
    readFile(
      new URL("../app/ui/components/alert-banner.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/ui/constants.ts", import.meta.url), "utf8"),
  ]);
  assert.match(alertBanner, /jump-ready:\$\{jumpCycle\}/);
  assert.match(alertBanner, /jumpsCompleted/);
  assert.doesNotMatch(alertBanner, /push\("jump-ready"/);
  assert.match(aiConstants, /model: "配置端点"/);
  assert.doesNotMatch(aiConstants, /DeepSeek V4 Pro/);
  assert.doesNotMatch(aiConstants, /处理 14 项请求/);

  assert.match(peopleView, /乘员遥测未联机/);
  assert.match(peopleView, /等待签发 · 人口与健康遥测未接入/);
  assert.doesNotMatch(peopleView, /population\.total \?\?/);
  assert.doesNotMatch(peopleView, /population\.awake \?\?/);
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
