// Audit probes: execute source functions with injected UI/storage dependencies.
// No browser, external provider, or user's actual save storage is touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import * as normalization from '../../lib/persist/local-save-normalize.ts';
import * as polling from '../../lib/llm/key-passenger-polling.ts';
import * as persistence from '../../lib/persist/local-save-idb.ts';
import { createMemoryIdbFactory } from '../../tests/persist/idb-memory.mjs';
import { FixedLlmServerRuntime } from '../../lib/llm/index.ts';
import { expandFarHorizonFixedTopology } from '../../lib/llm/fixed-topology.ts';
import { buildCausalInterventionRequest } from '../../lib/sim/causal-event-catalog.ts';
import { createCaptainJournalSnapshot } from '../../lib/llm/captain-journal.ts';
import { createCaptainWatchSnapshot } from '../../lib/llm/captain-watch.ts';
import { createDepartmentStandingSnapshot } from '../../lib/llm/department-standing.ts';
import { createPassengerSocietySnapshot } from '../../lib/llm/passenger-society.ts';
import { createDepartmentInboxSnapshot } from '../../lib/llm/department-inbox.ts';
import * as catalog from '../../lib/astro/star-catalog.ts';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../../', import.meta.url));
const results = [];
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const parsed = (name) => ts.createSourceFile(name, source(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(name, predicate) {
  let found;
  function walk(node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, walk); }
  walk(parsed(name));
  assert.ok(found, `Source node not found: ${name}`);
  return found;
}
function evaluate(code, globals = {}) {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const context = { exports, structuredClone, console, Error, Map, Set, ...globals };
  vm.runInNewContext(js, context);
  return exports;
}
function probe(id, details) { results.push({ id, ...details }); console.log(JSON.stringify(results.at(-1))); }

const alertNode = findNode('app/ui/components/alert-banner.tsx', n => ts.isFunctionDeclaration(n) && n.name?.text === 'detectAlerts');
const { detectAlerts } = evaluate(alertNode.getText());
const seen = new Set();
function thermal(temp, sec) {
  const alerts = detectAlerts(null, null, { observed: { averageCoolantTemperatureK: temp } }, null, sec, seen);
  for (const alert of alerts) seen.add(alert.id);
  return alerts;
}
const first = thermal(390, 0), recovered = thermal(300, 60), repeated = thermal(390, 120);
assert.equal(first.length, 1); assert.equal(recovered.length, 0); assert.equal(repeated.length, 0);
probe('A01', { firstAlert: first[0].id, recoveryNotifications: recovered.length, repeatedCriticalAlerts: repeated.length });

const emitted = [];
globalThis.postMessage = event => emitted.push(event);
await import('../../lib/sim/worker.ts');
function dispatch(command) { emitted.length = 0; globalThis.onmessage({ data: command }); return emitted.at(-1); }
const ready = dispatch({ type: 'initialize', requestId: 'audit-init', mission: {
  origin: '太阳系', destination: '鲸鱼座 τ', directive: '审计隔离任务', seed: 'audit-2026-09-08', totalDistanceLightYears: 11.9, totalLegs: 3, timeScale: 1800,
} });
assert.equal(ready.type, 'ready');
const runtime = dispatch({ type: 'snapshot', requestId: 'audit-snapshot' }).payload.snapshot;
const broken = structuredClone(runtime);
broken.engine.snapshotVersion = -1;
const fixture = { version: 24, activeView: 'voyage', missionStarted: true, paused: false, timeScale: 1800,
  simulationSeconds: 0, origin: 'sol', destination: 'tau-ceti', directive: '审计隔离任务', events: [],
  keyPassengerLlm: new polling.KeyPassengerPollScheduler().snapshot(), runtimeSnapshot: broken };
assert.equal((await normalization.normalizeLoadedLocalSave(fixture, { captainRoutineSeconds: 3600 })).ok, true);

const updates = {}, posts = [];
const hookReact = { useCallback: fn => fn, useEffect: () => {}, useState: value => [value, () => {}] };
const requireMock = name => {
  if (name === 'react') return hookReact;
  if (name.endsWith('local-save-normalize')) return normalization;
  if (name.endsWith('local-save-idb')) return { ...persistence, getManualSave: async () => fixture };
  if (name.endsWith('key-passenger-polling')) return polling;
  if (name.endsWith('use-autosave')) return { useAutosave() {} };
  if (name.endsWith('utils')) return { formatDuration: String };
  if (name.endsWith('logger')) return { createLogger: () => ({ warn() {}, error() {}, info() {} }) };
  throw new Error(`Unexpected import ${name}`);
};
const { useLocalSave: executeHookWithInjectedReact } = evaluate(source('app/mission-control/use-local-save.ts'), { require: requireMock });
const iface = findNode('app/mission-control/use-local-save.ts', n => ts.isTypeAliasDeclaration(n) && n.name.text === 'UseLocalSaveDeps');
const deps = {};
for (const member of iface.type.members) {
  const name = member.name.text;
  if (member.type?.getText().includes('MutableRefObject')) deps[name] = { current: null };
  else deps[name] = (...args) => { updates[name] = args; };
}
Object.assign(deps, { missionStarted: true, missionEnded: false, paused: false, timeScale: 1800, simulationSeconds: 0,
  origin: 'sol', destination: 'tau-ceti', directive: 'existing-world', events: [], activeView: 'voyage', llmStatusReady: true,
  engineState: ready.payload.state, llmCallPhase: 'idle', timeControl: ready.payload.timeControl,
});
deps.pendingSaves.current = new Map();
deps.worldEpoch.current = 1;
deps.captainRoutineSeconds.current = 3600;
deps.workerRef.current = { postMessage: command => posts.push(command) };
deps.latestStateRevision.current = ready.payload.state.revision;
deps.nextRequestId = prefix => `${prefix}-audit`;
const api = executeHookWithInjectedReact(deps);
api.confirmLoadGame('manual');
for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
assert.equal(posts.length, 1); assert.equal(posts[0].type, 'restore');
assert.ok(updates.updateCaptainJournalSnapshot);
const rejection = dispatch(posts[0]);
assert.equal(rejection.type, 'error');
probe('A02', { outerValidation: 'accepted', sidecarUpdatedBeforeWorkerAck: true, epochBefore: 1, epochAfter: deps.worldEpoch.current,
  workerReply: rejection.type, workerMessage: rejection.message });

const startNode = findNode('app/mission-control.tsx', n => ts.isVariableDeclaration(n) && n.name.getText() === 'startMission');
let commands = 0, toasts = 0;
const start = evaluate(`export const startMission = ${startNode.initializer.getText()}`, {
  missionStartRequestedRef: { current: true }, workerRef: { current: { postMessage() { commands++; } } }, showToast() { toasts++; },
}).startMission;
start();
assert.equal(commands, 0); assert.equal(toasts, 0);
probe('A03', { afterStartedMissionThenLoadingPrelaunchConfig: { initializeCommands: commands, feedbackMessages: toasts },
  scope: 'executes exact start handler at its retained latch state; config-load source never resets latch' });

const keyNode = findNode('app/mission-control.tsx', n => ts.isVariableDeclaration(n) && n.name.getText() === 'handleKeyDown');
let pauseToggles = 0, prevented = false;
const handler = evaluate(`export const handleKeyDown = ${keyNode.initializer.getText()}`, {
  missionStarted: true, missionEnded: false, llmCallPhase: 'idle', setPaused() { pauseToggles++; }, audio: { playClick() {} },
}).handleKeyDown;
handler({ target: { tagName: 'BUTTON', isContentEditable: false }, code: 'Space', preventDefault() { prevented = true; } });
assert.equal(pauseToggles, 1); assert.equal(prevented, true);
probe('A04', { focusedElement: 'BUTTON', buttonDefaultPrevented: prevented, simulationPauseToggles: pauseToggles });

const factory = createMemoryIdbFactory();
const storageMap = new Map();
const localStorage = { getItem: k => storageMap.get(k) ?? null, setItem: (k, v) => storageMap.set(k, v), removeItem: k => storageMap.delete(k) };
const adapters = { idbFactory: factory, localStorage };
await persistence.putManualSave({ version: 24, simulationSeconds: 100 }, adapters);
const brokenFactory = { open() { throw new Error('Injected IDB unavailable during fallback'); } };
await persistence.putManualSaveToLocalStorageFallback({ version: 24, simulationSeconds: 200 }, { idbFactory: brokenFactory, localStorage });
const selected = await persistence.getManualSave(adapters);
assert.equal(selected.simulationSeconds, 100);
probe('A05', { oldIdbSeconds: 100, newFallbackSeconds: 200, readAfterIdbRecoversSeconds: selected.simulationSeconds });

const malformed = await normalization.normalizeLoadedLocalSave({ ...fixture, missionStarted: false, runtimeSnapshot: null,
  timeScale: -1, events: [null] }, { captainRoutineSeconds: 3600 });
assert.equal(malformed.ok, true);
probe('A06', { negativeTimeScaleAndNullEventAccepted: malformed.ok, scope: 'legacy/unsealed or re-sealed malformed save' });

const interventionNode = findNode('app/mission-control/use-god-interventions.ts', n => ts.isVariableDeclaration(n) && n.name.getText() === 'submitIntervention');
const erased = [], interventionPosts = [], pendingInterventions = { current: new Map() };
const globals = {
  pendingSaveBarrier: { current: null }, pendingSaves: { current: new Map() }, missionStarted: true,
  workerRef: { current: { postMessage: cmd => interventionPosts.push(cmd) } }, showToast() {}, nextRequestId: () => 'audit-intervene',
  cancelCaptainDecision() {}, cancelKeyPassengerCall() {}, keyPassengerScheduler: { current: { resetObservations() {} } },
  latestCaptainDeviceReceipts: { current: [] }, setLlmCallPhase() {}, worldEpoch: { current: 1 }, pendingInterventions,
  godAssistSessionRef: { current: null }, createCaptainJournalSnapshot, createCaptainWatchSnapshot, createDepartmentStandingSnapshot,
  createPassengerSocietySnapshot, createDepartmentInboxSnapshot,
};
for (const name of ['CaptainJournal', 'CaptainWatch', 'DepartmentStanding', 'PassengerSociety', 'DepartmentInbox']) {
  globals[`update${name}Snapshot`] = () => erased.push(name);
}
const submit = evaluate(`export const submit = ${interventionNode.initializer.getText()}`, globals).submit;
const completion = submit(buildCausalInterventionRequest('micrometeoroid'), 'audit');
assert.equal(erased.length, 5);
const interveneReply = dispatch(interventionPosts[0]);
assert.equal(interveneReply.type, 'intervention', interveneReply.message);
pendingInterventions.current.get('audit-intervene').resolve();
await completion;
probe('A07', { intervention: 'micrometeoroid', workerReply: interveneReply.type, sidecarsResetBeforeAcknowledgement: erased,
  scope: 'React memory reset verified; telemetry can subsequently restore society/inbox from Worker' });

let providerCalls = 0;
const server = new FixedLlmServerRuntime(expandFarHorizonFixedTopology(JSON.parse(source('config/llm.example.json'))), {
  readEnvironment: () => 'audit-invalid-secret', fetch: async () => { providerCalls++; return new Response('unauthorized', { status: 401 }); },
});
const readyBefore = server.status().ready;
await assert.rejects(server.invoke({ agentId: 'captain', messages: [{ role: 'user', content: 'audit' }] }));
const readyAfter = server.status().ready;
assert.equal(readyBefore, true); assert.equal(readyAfter, true); assert.equal(providerCalls, 1);
probe('A08', { simulatedProviderStatus: 401, readyBefore, readyAfter, providerCalls, realNetworkRequests: 0 });

const beforeReturn = dispatch({ type: 'inspect', requestId: 'audit-before-return' }).payload;
const returned = dispatch({ type: 'ship-command', requestId: 'audit-return', commandId: 'audit-return', idempotencyKey: 'audit-return',
  issuedAtMicroseconds: 0, expectedRevision: beforeReturn.commandBus.revision, expectedStateRevision: beforeReturn.state.revision,
  command: { kind: 'revise-mission', actorAgentId: 'captain', disposition: 'return', destination: '太阳系', objective: '返回出发地',
    route: [{ id: 'return', label: '返回', distanceFromPreviousLightYears: 0.1 }], totalDistanceLightYears: 0.1, totalLegs: 1 } });
assert.equal(returned.type, 'ship-command', returned.message);
assert.equal(returned.payload.state.journey.destination, '太阳系');
assert.ok(returned.payload.state.journey.totalDistanceLightYears > 11);
probe('A09', { completedJumpsBeforeReturn: beforeReturn.state.journey.jumpsCompleted, secondsBeforeReturn: beforeReturn.elapsedSeconds,
  destinationAfterReturn: returned.payload.state.journey.destination, distanceToReturnLightYears: returned.payload.state.journey.totalDistanceLightYears });

let renderedMapDestination;
const lengthNode = findNode('app/ui/constants.ts', n => ts.isVariableDeclaration(n) && n.name.getText() === 'SHIP_DESIGN_LENGTH_M');
const { VoyageView } = evaluate(source('app/ui/views/voyage-view.tsx'), { require(name) {
  if (name === 'react') return hookReact;
  if (name === 'react/jsx-runtime') return jsxRuntime;
  if (name.endsWith('star-catalog')) return catalog;
  if (name === '../constants') return { STAR_SYSTEMS: catalog.STAR_SYSTEMS, OFFLINE_SYSTEMS: [], SHIP_DESIGN_LENGTH_M: Number(lengthNode.initializer.getText().replaceAll('_', '')) };
  if (name.endsWith('star-map')) return { StarMap: props => { renderedMapDestination = props.destinationId; return null; } };
  if (name.endsWith('status-pill')) return { StatusPill: props => props.children };
  if (name.endsWith('survival-pressure')) return { SurvivalPressure: () => null };
  throw new Error(`Unexpected view import ${name}`);
} });
const returnPayload = returned.payload;
const html = renderToStaticMarkup(VoyageView({ origin: 'sol', destination: 'tau-ceti', missionStarted: true, directive: '审计隔离任务',
  state: returnPayload.state, cooling: returnPayload.cooling, electrical: returnPayload.electrical, compartments: returnPayload.compartments,
  navigation: returnPayload.navigation, rotation: returnPayload.rotation.observed, survival: returnPayload.survival }));
assert.equal(renderedMapDestination, 'tau-ceti');
const renderedHeading = html.match(/<h2>(.*?)<\/h2>/)?.[1];
probe('A10', { workerDestination: returnPayload.state.journey.destination, renderedHeading, starMapDestinationId: renderedMapDestination,
  scope: 'actual VoyageView JSX rendered with leaf map/status widgets substituted; no visual/browser claim' });

const snapshotBytes = Buffer.byteLength(JSON.stringify(runtime));
const telemetryBytes = Buffer.byteLength(JSON.stringify(ready));
const cloneStart = performance.now();
for (let i = 0; i < 5; i++) structuredClone(ready);
probe('M01', { initialSnapshotJsonBytes: snapshotBytes, initialTelemetryJsonBytes: telemetryBytes, averageTelemetryCloneMs: (performance.now() - cloneStart) / 5,
  scope: 'Node serialization/clone diagnostic, not browser transfer or rendering measurement' });
fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2));
