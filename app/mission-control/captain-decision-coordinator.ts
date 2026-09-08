/**
 * Captain decision async pipeline coordinator.
 * React useEffect still owns trigger gating, pause-token acquire/release,
 * and abort wiring; multi-step LLM body runs here with an injected context bag.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ShipState } from "@/lib/sim";
import type {
  TimelineEvent,
  LlmRuntimeStatus,
  LlmInvokeRoutePayload,
  SystemTone,
  CaptainDeviceReceiptSummary,
  CaptainDecisionEntry,
} from "@/app/ui/types";
import {
  formatDuration,
  formatCadence,
  prependTimelineEvent,
  compactLlmTimelineText,
} from "@/app/ui/utils";
import {
  CAPTAIN_DECISION_INSTRUCTION,
  DEPARTMENT_CONSULTATION_REQUEST,
} from "@/app/ui/llm-readable-output";
import {
  CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE,
  isCaptainConsultationHardFailure,
  parseCaptainConsultationRequest,
  partitionCaptainConsultationAttempts,
  type CaptainConsultationAttempt,
} from "@/lib/llm/captain-consultation";
import type { DecisionTheaterEvent } from "@/lib/llm/decision-theater";
import {
  RECORD_CAPTAIN_LOG_TOOL_NAME,
  appendCaptainJournalEntry,
  parseCaptainLogToolCall,
  renderCaptainJournalPromptBlock,
  type CaptainJournalSnapshot,
} from "@/lib/llm/captain-journal";
import {
  SET_WATCH_CONDITION_TOOL_NAME,
  applyCaptainWatchCondition,
  parseSetWatchConditionToolCall,
  renderCaptainWatchPromptBlock,
  type CaptainWatchSnapshot,
} from "@/lib/llm/captain-watch";
import {
  FILE_DISSENT_TOOL_NAME,
  autoResolveOpenDepartmentDissents,
  buildDissentWorldEvidence,
  parseFileDissentToolCall,
  recordDepartmentConsultation,
  recordDepartmentDissent,
  renderCaptainDissentLedgerPromptBlock,
  renderDepartmentStandingPromptBlock,
  renderPeerPositionsPromptBlock,
  type DepartmentStandingSnapshot,
} from "@/lib/llm/department-standing";
import {
  appendCaptainBriefingToDepartments,
  markDepartmentInboxRead,
  renderDepartmentInboxPromptBlock,
  type DepartmentInboxSnapshot,
} from "@/lib/llm/department-inbox";
import { renderGrievanceBacklogPromptBlock } from "@/lib/llm/grievance-backlog";
import { extractCaptainWatchMetricSample } from "@/lib/llm/captain-watch-metrics";
import {
  CAPTAIN_WORLD_TOOLS,
  CAPTAIN_CONSULTATION_TOOL,
  RECORD_CAPTAIN_LOG_TOOL,
  SET_WATCH_CONDITION_TOOL,
  FILE_DISSENT_TOOL,
} from "@/lib/llm/captain-world-tools";
import { computeNextCaptainRoutineDeadline } from "@/lib/sim/captain-schedule";
import { buildFullAuthorizedObservation } from "@/lib/sim/captain-authorized-observation";
import { createLogger } from "@/lib/observability/logger";
import {
  observedFetch,
  type ObservedFetchOptions,
} from "@/lib/observability/observed-fetch";
import {
  createCaptainWorldCommandQueue,
  enqueueCaptainWorldCommandsFromToolCalls,
  type CaptainWorldCommandQueue,
} from "@/app/mission-control/captain-world-command-queue";

const missionLog = createLogger("captain-decision-coordinator");

export type FullAuthorizedObservation = ReturnType<
  typeof buildFullAuthorizedObservation
>;

export type CaptainDecisionCycle = {
  token: number;
  worldEpoch: number;
  triggerKey: string;
  controller: AbortController;
};

export function sliceAuthorizedObservationForAgent(
  authorizedObservation: FullAuthorizedObservation,
  agentId: string,
) {
  const {
    source,
    sensorView,
    delayedAuthorizedRecords,
    controllerCommandState,
    operationsLedger,
  } = authorizedObservation;
  switch (agentId) {
    case "navigation":
      return {
        source,
        sensorView: {
          powerControllerAlarm: sensorView.powerControllerAlarm,
          rotationRingSensors: sensorView.rotationRingSensors,
          rotationSensorDiagnostics: sensorView.rotationSensorDiagnostics,
          positionSensorM: sensorView.navigationPositionSensorM,
          velocitySensorMPerS: sensorView.navigationVelocitySensorMPerS,
          attitudeSensor: sensorView.navigationAttitudeSensor,
          angularVelocitySensorRadPerS:
            sensorView.navigationAngularVelocitySensorRadPerS,
          propellantMassSensorKg: sensorView.propellantMassSensorKg,
          hullThreat: sensorView.hullThreat,
          jumpThermalProjection: sensorView.jumpThermalProjection,
        },
        delayedAuthorizedRecords: {
          jumpControllerRecord: delayedAuthorizedRecords.jumpControllerRecord,
        },
        operationsLedger,
      };
    case "medical":
      return {
        source,
        sensorView: {
          habitatPressureSensorPa: sensorView.habitatPressureSensorPa,
          oxygenPartialPressureSensorPaByRing:
            sensorView.oxygenPartialPressureSensorPaByRing,
          oxygenPartialPressureSensorPaAverage:
            sensorView.oxygenPartialPressureSensorPaAverage,
          oxygenPartialPressureSensorPaA01Detail:
            sensorView.oxygenPartialPressureSensorPaA01Detail,
          pressureZoneAlerts: sensorView.pressureZoneAlerts,
        },
        delayedAuthorizedRecords: {
          crewManifestRecord: delayedAuthorizedRecords.crewManifestRecord,
        },
        operationsLedger,
      };
    case "life-support":
      return {
        source,
        sensorView: {
          habitatPressureSensorPa: sensorView.habitatPressureSensorPa,
          oxygenPartialPressureSensorPaByRing:
            sensorView.oxygenPartialPressureSensorPaByRing,
          oxygenPartialPressureSensorPaAverage:
            sensorView.oxygenPartialPressureSensorPaAverage,
          oxygenPartialPressureSensorPaA01Detail:
            sensorView.oxygenPartialPressureSensorPaA01Detail,
          pressureZoneAlerts: sensorView.pressureZoneAlerts,
          hullThreat: sensorView.hullThreat,
          waterRecoverySensors: sensorView.waterRecoverySensors,
          habitatThermalDeliverySpurs: sensorView.habitatThermalDeliverySpurs,
          undeliveredHabitatCoolingJ: sensorView.undeliveredHabitatCoolingJ,
          ringAtmosphereSensors: sensorView.ringAtmosphereSensors,
          powerControllerAlarm: sensorView.powerControllerAlarm,
        },
        controllerCommandState,
        operationsLedger,
      };
    case "engineering":
      return {
        source,
        sensorView: {
          powerControllerAlarm: sensorView.powerControllerAlarm,
          averageBusVoltageSensorV: sensorView.averageBusVoltageSensorV,
          averageBusFrequencySensorHz: sensorView.averageBusFrequencySensorHz,
          servedPowerSensorKw: sensorView.servedPowerSensorKw,
          reactorOutputSensorKw: sensorView.reactorOutputSensorKw,
          batteryStateOfChargeSensorFraction:
            sensorView.batteryStateOfChargeSensorFraction,
          coolantSensorK: sensorView.coolantSensorK,
          thermalBusSensorK: sensorView.thermalBusSensorK,
          coolantMassFlowSensorKgPerSecond:
            sensorView.coolantMassFlowSensorKgPerSecond,
          pressureZoneAlerts: sensorView.pressureZoneAlerts,
          hullThreat: sensorView.hullThreat,
          jumpThermalProjection: sensorView.jumpThermalProjection,
          waterRecoverySensors: sensorView.waterRecoverySensors,
          habitatThermalDeliverySpurs: sensorView.habitatThermalDeliverySpurs,
          undeliveredHabitatCoolingJ: sensorView.undeliveredHabitatCoolingJ,
          ringAtmosphereSensors: sensorView.ringAtmosphereSensors,
          oxygenPartialPressureSensorPaByRing:
            sensorView.oxygenPartialPressureSensorPaByRing,
          oxygenPartialPressureSensorPaAverage:
            sensorView.oxygenPartialPressureSensorPaAverage,
          rotationRingSensors: sensorView.rotationRingSensors,
          rotationSensorDiagnostics: sensorView.rotationSensorDiagnostics,
          maintenanceDiagnostics: sensorView.maintenanceDiagnostics,
        },
        delayedAuthorizedRecords: {
          jumpControllerRecord: delayedAuthorizedRecords.jumpControllerRecord,
        },
        controllerCommandState,
        operationsLedger,
      };
    default:
      return {
        source,
        sensorView: {
          powerControllerAlarm: sensorView.powerControllerAlarm,
        },
        operationsLedger,
      };
  }
}

export type CaptainDecisionCoordinatorContext = {
  eventId: MutableRefObject<number>;
  setEvents: Dispatch<SetStateAction<TimelineEvent[]>>;
  setCaptainDecisionLog: Dispatch<SetStateAction<CaptainDecisionEntry[]>>;
  setLlmStatus: Dispatch<SetStateAction<LlmRuntimeStatus | null>>;
  emitDecisionTheater: (event: DecisionTheaterEvent) => void;
  appendCaptainCommandEvent: (
    elapsedSeconds: number,
    text: string,
    tone: SystemTone,
    source?: string,
  ) => void;
  dispatchNextCaptainWorldCommand: () => void;
  releaseCaptainDecisionPause: (phase?: "idle" | "error") => void;
  postLlmEffectAccept: (args: {
    callId: string;
    observationRevision: number;
    result: { toolCalls?: unknown[]; [key: string]: unknown };
  }) => void;
  postLlmEffectFail: (args: {
    callId: string;
    observationRevision: number;
    reason: string;
    retryable: boolean;
  }) => void;
  postLlmEffectFinish: (args: {
    callId: string;
    advancesRoutineSchedule: boolean;
    nextCaptainRoutineAtSimulationSeconds?: number | null;
  }) => void;
  updateNextCaptainRoutineDeadline: (value: number | null) => void;
  updateDepartmentStandingSnapshot: (value: DepartmentStandingSnapshot) => void;
  updateCaptainJournalSnapshot: (value: CaptainJournalSnapshot) => void;
  updateCaptainWatchSnapshot: (value: CaptainWatchSnapshot) => void;
  updateDepartmentInboxSnapshot: (value: DepartmentInboxSnapshot) => void;
  showToast: (message: string, options?: { persistent?: boolean }) => void;
  departmentStandingSnapshotRef: MutableRefObject<DepartmentStandingSnapshot>;
  captainJournalSnapshotRef: MutableRefObject<CaptainJournalSnapshot>;
  captainWatchSnapshotRef: MutableRefObject<CaptainWatchSnapshot>;
  departmentInboxSnapshotRef: MutableRefObject<DepartmentInboxSnapshot>;
  activeCaptainWorldCommandQueue: MutableRefObject<CaptainWorldCommandQueue | null>;
  latestCaptainDeviceReceipts: MutableRefObject<CaptainDeviceReceiptSummary[]>;
  captainInvocationKeys: MutableRefObject<Set<string>>;
  captainRoutineSeconds: MutableRefObject<number>;
  activeCaptainDecision: MutableRefObject<CaptainDecisionCycle | null>;
  captainCallInFlight: MutableRefObject<boolean>;
  latestSimulationSeconds: MutableRefObject<number>;
  worldEpoch: MutableRefObject<number>;
  latestStateRevision: MutableRefObject<number | null>;
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: ObservedFetchOptions,
  ) => Promise<Response>;
};

export type CaptainDecisionCycleParams = {
  triggerKey: string;
  triggerReason: string;
  simulationSeconds: number;
  directive: string;
  missionProvenance: {
    origin: string;
    destination: string;
    plannedRouteDistanceLightYears: number;
    estimatedRouteLegs: number;
    distanceProvenance: string;
    routeProgressModel: string;
    elapsedSimSeconds: number;
  };
  authorizedObservation: FullAuthorizedObservation;
  recentDeviceReceipts: CaptainDeviceReceiptSummary[];
  captainDecisionToken: number;
  invocationWorldEpoch: number;
  observedStateRevision: number;
  decisionController: AbortController;
  decisionLogId: number;
  advancesRoutineSchedule: boolean;
  routineDeadlineBeforeClear: number | null;
  workerOwnedEffect: {
    callId: string;
    observationRevision: number;
  } | null;
  engineJourneyStatus: ShipState["journey"]["status"];
  trueRemainingDistance: number;
  hullThreatObservation: FullAuthorizedObservation["sensorView"]["hullThreat"];
  jumpThermalProjection: FullAuthorizedObservation["sensorView"]["jumpThermalProjection"];
  llmStatus: LlmRuntimeStatus;
};

export async function runCaptainDecisionCycle(
  ctx: CaptainDecisionCoordinatorContext,
  params: CaptainDecisionCycleParams,
): Promise<void> {
  const {
    eventId,
    setEvents,
    setCaptainDecisionLog,
    setLlmStatus,
    emitDecisionTheater,
    appendCaptainCommandEvent,
    dispatchNextCaptainWorldCommand,
    releaseCaptainDecisionPause,
    postLlmEffectAccept,
    postLlmEffectFail,
    postLlmEffectFinish,
    updateNextCaptainRoutineDeadline,
    updateDepartmentStandingSnapshot,
    updateCaptainJournalSnapshot,
    updateCaptainWatchSnapshot,
    updateDepartmentInboxSnapshot,
    showToast,
    departmentStandingSnapshotRef,
    captainJournalSnapshotRef,
    captainWatchSnapshotRef,
    departmentInboxSnapshotRef,
    activeCaptainWorldCommandQueue,
    latestCaptainDeviceReceipts,
    captainInvocationKeys,
    captainRoutineSeconds,
    activeCaptainDecision,
    captainCallInFlight,
    latestSimulationSeconds,
  } = ctx;
  const fetchFn = ctx.fetchImpl ?? observedFetch;

  const {
    triggerKey,
    triggerReason,
    simulationSeconds,
    directive,
    missionProvenance,
    authorizedObservation,
    recentDeviceReceipts,
    captainDecisionToken,
    invocationWorldEpoch,
    observedStateRevision,
    decisionController,
    decisionLogId,
    advancesRoutineSchedule,
    routineDeadlineBeforeClear,
    workerOwnedEffect,
    engineJourneyStatus,
    trueRemainingDistance,
    hullThreatObservation,
    jumpThermalProjection,
    llmStatus,
  } = params;

  const isCurrentCaptainDecision = () => {
    const active = activeCaptainDecision.current;
    return (
      active?.token === captainDecisionToken &&
      active.worldEpoch === invocationWorldEpoch &&
      ctx.worldEpoch.current === invocationWorldEpoch &&
      !decisionController.signal.aborted
    );
  };
  const supersededDecisionError = new Error(
    "舰长决策周期已由新的世界状态取代",
  );
  const staleObservationError = new Error(
    "AI 研判期间世界状态发生变化；本轮命令已被联锁作废",
  );
  const assertCurrentCaptainDecision = () => {
    if (!isCurrentCaptainDecision()) {
      throw supersededDecisionError;
    }
    if (ctx.latestStateRevision.current !== observedStateRevision) {
      throw staleObservationError;
    }
  };

  // Consultation is a captain decision, never a trigger-based system default.
  // Departments are invoked only after consult_departments names them.
  const consultantIds: string[] = [];


let consultationDegradedAnnounced = false;
const announceConsultationDegradation = (
  failures: Array<{ departmentId: string; message: string }>,
  sourcePrefix: string,
) => {
  if (failures.length === 0) {
    return;
  }
  for (const failure of failures) {
    const agent = llmStatus.agents.find(
      (candidate) => candidate.id === failure.departmentId,
    );
    const softEventId = ++eventId.current;
    setEvents((current) =>
      prependTimelineEvent(current, {
        id: softEventId,
        at: formatDuration(simulationSeconds),
        source: `${sourcePrefix} / ${agent?.role ?? failure.departmentId}`,
        text: `咨询失败（已跳过）：${failure.message}`,
        tone: "watch",
      }),
    );
  }
  if (consultationDegradedAnnounced) {
    return;
  }
  consultationDegradedAnnounced = true;
  const degradeEventId = ++eventId.current;
  setEvents((current) =>
    prependTimelineEvent(current, {
      id: degradeEventId,
      at: formatDuration(simulationSeconds),
      source: "舰长 AI / 乾枢",
      text: CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE,
      tone: "watch",
    }),
  );
  setCaptainDecisionLog((previous) =>
    previous.map((entry) =>
      entry.id === decisionLogId
        ? {
            ...entry,
            consultationNote:
              CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE,
          }
        : entry,
    ),
  );
};
try {
  const initialAttempts = await Promise.all(
    consultantIds.map(
      async (
        agentId,
      ): Promise<
        CaptainConsultationAttempt<
          NonNullable<LlmInvokeRoutePayload["result"]>
        >
      > => {
        try {
          assertCurrentCaptainDecision();
          const configuredDiscussionDepth =
            llmStatus.agents.find(
              (agent) => agent.id === agentId,
            )?.routine.discussionDepth ?? 1;
          const discussionDepth = Number.isSafeInteger(
            configuredDiscussionDepth,
          )
            ? Math.max(
                1,
                Math.min(2, configuredDiscussionDepth),
              )
            : 1;
          const departmentStandingPrompt =
            renderDepartmentStandingPromptBlock(
              departmentStandingSnapshotRef.current,
              agentId,
              { nowSimulationSeconds: simulationSeconds },
            );
          const inboxPrompt = renderDepartmentInboxPromptBlock(
            departmentInboxSnapshotRef.current,
            agentId,
            { nowSimulationSeconds: simulationSeconds },
          );
          const grievanceBacklogPrompt = renderGrievanceBacklogPromptBlock(
            authorizedObservation.operationsLedger?.grievances ?? [],
            {
              simulationSeconds,
              departmentId: agentId,
            },
          );
          const response = await fetchFn(
            "/api/llm/invoke",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: decisionController.signal,
              body: JSON.stringify({
                intent: "captain-consultation",
                consultantId: agentId,
                invocation: {
                  messages: [
                    {
                      role: "user",
                      content: {
                      request: DEPARTMENT_CONSULTATION_REQUEST,
                      event: triggerReason,
                      highestDirective: directive,
                      mission: missionProvenance,
                      authorizedObservation:
                        sliceAuthorizedObservationForAgent(authorizedObservation, agentId),
                      ...(departmentStandingPrompt
                        ? { standing: departmentStandingPrompt }
                        : {}),
                      ...(inboxPrompt ? { inbox: inboxPrompt } : {}),
                      ...(grievanceBacklogPrompt
                        ? { grievanceBacklog: grievanceBacklogPrompt }
                        : {}),
                      },
                    },
                  ],
                  tools: [FILE_DISSENT_TOOL],
                  metadata: {
                    triggerKey,
                    consultationFor: "captain",
                  },
                  discussion: {
                    depth: discussionDepth,
                    round: 1,
                  },
                },
              }),
            },
            { operation: "captain.consult.department" },
          );
          assertCurrentCaptainDecision();
          const payload =
            (await response.json()) as LlmInvokeRoutePayload;
          assertCurrentCaptainDecision();
          if (!response.ok || !payload.result) {
            throw new Error(
              payload.error?.message ??
                `${agentId} 部门端点返回 HTTP ${response.status}`,
            );
          }
          const agentRole =
            llmStatus.agents.find(
              (candidate) => candidate.id === agentId,
            )?.role ?? agentId;
          emitDecisionTheater({
            type: "department_spoke",
            cycleToken: captainDecisionToken,
            round: 0,
            departmentId: agentId,
            role: agentRole,
            text: compactLlmTimelineText(
              payload.result.text,
              320,
              "部门返回了空白建议。",
            ),
            wallClockAtMs: Date.now(),
          });
          return { ok: true, value: payload.result };
        } catch (error) {
          if (
            !isCurrentCaptainDecision() ||
            isCaptainConsultationHardFailure(error, [
              supersededDecisionError,
              staleObservationError,
            ])
          ) {
            throw error;
          }
          return { ok: false, departmentId: agentId, error };
        }
      },
    ),
  );
  const initialPartition =
    partitionCaptainConsultationAttempts(initialAttempts);
  {
    let inbox = departmentInboxSnapshotRef.current;
    for (const agentId of consultantIds) {
      inbox = markDepartmentInboxRead(inbox, agentId);
    }
    if (inbox !== departmentInboxSnapshotRef.current) {
      updateDepartmentInboxSnapshot(inbox);
    }
  }
  announceConsultationDegradation(
    initialPartition.failures,
    "部门 AI",
  );
  let departmentResults = initialPartition.results;
  assertCurrentCaptainDecision();
  const applyDepartmentStandingFromResult = (
    result: NonNullable<LlmInvokeRoutePayload["result"]>,
    sourceLabel: string,
  ) => {
    updateDepartmentStandingSnapshot(
      recordDepartmentConsultation(
        departmentStandingSnapshotRef.current,
        {
          departmentId: result.agentId,
          simulationSeconds,
          stance: result.text,
        },
      ),
    );
    for (const toolCall of result.toolCalls.filter(
      (candidate) => candidate.name === FILE_DISSENT_TOOL_NAME,
    )) {
      const parsed = parseFileDissentToolCall(toolCall.arguments);
      if (!parsed.ok) {
        const dissentEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: dissentEventId,
            at: formatDuration(simulationSeconds),
            source: `${sourceLabel} / 异议`,
            text: `file_dissent 未写入：${parsed.reason}`,
            tone: "watch",
          }),
        );
        continue;
      }
      const recorded = recordDepartmentDissent(
        departmentStandingSnapshotRef.current,
        {
          departmentId: result.agentId,
          simulationSeconds,
          severity: parsed.draft.severity,
          summary: parsed.draft.summary,
          claimKind: parsed.draft.claimKind,
          captainDecisionOrdinal:
            captainJournalSnapshotRef.current.nextOrdinal,
        },
      );
      updateDepartmentStandingSnapshot(recorded.snapshot);
    }
  };
  const applyAutoDissentResolution = (
    receipts: readonly CaptainDeviceReceiptSummary[],
  ) => {
    const metricSample = extractCaptainWatchMetricSample(
      authorizedObservation,
    );
    const hullThreat = authorizedObservation.sensorView.hullThreat;
    const resolved = autoResolveOpenDepartmentDissents(
      departmentStandingSnapshotRef.current,
      buildDissentWorldEvidence({
        hullIntegrity: metricSample.hullIntegrity,
        activeBreachCount:
          hullThreat.availability === "available"
            ? hullThreat.activeBreachCount
            : null,
        lowestZonePressureKpa: metricSample.lowestZonePressureKpa,
        batteryStateOfChargeFraction:
          metricSample.batteryStateOfChargeFraction,
        receipts,
      }),
    );
    if (resolved !== departmentStandingSnapshotRef.current) {
      updateDepartmentStandingSnapshot(resolved);
    }
  };
  for (const result of departmentResults) {
    assertCurrentCaptainDecision();
    applyDepartmentStandingFromResult(result, "部门 AI");
    const agent = llmStatus.agents.find(
      (candidate) => candidate.id === result.agentId,
    );
    const timelineEventId = ++eventId.current;
    setEvents((current) =>
      prependTimelineEvent(current, {
        id: timelineEventId,
        at: formatDuration(simulationSeconds),
        source: `部门 AI / ${agent?.role ?? result.agentId ?? "未知岗位"}`,
        text: compactLlmTimelineText(
          result.text,
          220,
          "部门返回了空白建议，舰长将按缺失报告处理。",
        ),
        tone: "nominal",
      }),
    );
  }

  // ─── 决策日志：记录部门咨询结果 ─────────────────────
  setCaptainDecisionLog((prev) =>
    prev.map((entry) =>
      entry.id === decisionLogId
        ? {
            ...entry,
            consultations: departmentResults.map((r) => ({
              agentId: r.agentId,
              role:
                llmStatus.agents.find((a) => a.id === r.agentId)
                  ?.role ?? r.agentId,
              text: compactLlmTimelineText(
                r.text,
                320,
                "部门返回了空白建议。",
              ),
            })),
          }
        : entry,
    ),
  );

  assertCurrentCaptainDecision();
  let captainDecisionTools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }> = [];
  const captainJournalPrompt = renderCaptainJournalPromptBlock(
    captainJournalSnapshotRef.current,
    { nowSimulationSeconds: simulationSeconds },
  );
  const captainWatchPrompt = renderCaptainWatchPromptBlock(
    captainWatchSnapshotRef.current,
    { nowSimulationSeconds: simulationSeconds },
  );
  const captainDissentLedgerPrompt =
    renderCaptainDissentLedgerPromptBlock(
      departmentStandingSnapshotRef.current,
      { nowSimulationSeconds: simulationSeconds },
    );
  emitDecisionTheater({
    type: "captain_deliberating",
    cycleToken: captainDecisionToken,
    pass: "initial",
  });
  const response = await fetchFn(
    "/api/llm/invoke",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: decisionController.signal,
      body: JSON.stringify({
        intent: "captain-decision",
        invocation: {
          messages: [
            {
              role: "user",
              content: {
              event: triggerReason,
              highestDirective: directive,
              mission: missionProvenance,
              authorizedObservation,
              recentDeviceReceipts: {
                source: "上一轮舰长工具调用的设备执行层回执",
                entries: recentDeviceReceipts,
              },
              departmentReports: departmentResults.map(
                (result) => ({
                  agentId: result.agentId,
                  text: result.text,
                  provenance:
                    "固定部门模型报告；未经设备执行确认",
                }),
              ),
              ...(captainJournalPrompt
                ? { memory: captainJournalPrompt }
                : {}),
              ...(captainWatchPrompt
                ? { watch: captainWatchPrompt }
                : {}),
              ...(captainDissentLedgerPrompt
                ? { dissentLedger: captainDissentLedgerPrompt }
                : {}),
              instruction: CAPTAIN_DECISION_INSTRUCTION,
              },
            },
          ],
          tools: (captainDecisionTools = [
            ...CAPTAIN_WORLD_TOOLS,
            CAPTAIN_CONSULTATION_TOOL,
            RECORD_CAPTAIN_LOG_TOOL,
            SET_WATCH_CONDITION_TOOL,
          ]),
          metadata: {
            triggerKey,
          },
          discussion: { depth: 1, round: 1 },
        },
      }),
    },
    { operation: "captain.decision.invoke" },
  );
  assertCurrentCaptainDecision();
  let payload =
    (await response.json()) as LlmInvokeRoutePayload;
  assertCurrentCaptainDecision();
  if (!response.ok || !payload.result) {
    throw new Error(
      payload.error?.message ??
        `舰长端点返回 HTTP ${response.status}`,
    );
  }
  const consultationCalls = payload.result.toolCalls.filter(
    (toolCall) => toolCall.name === "consult_departments",
  );
  if (consultationCalls.length > 0) {
    const preliminaryCaptainText = payload.result.text;
    const consultationCall = consultationCalls[0];
    const { departmentIds, question, rounds } =
      parseCaptainConsultationRequest(consultationCall.arguments);
    updateDepartmentInboxSnapshot(
      appendCaptainBriefingToDepartments(
        departmentInboxSnapshotRef.current,
        {
          departmentIds,
          body: question,
          simulationSeconds,
        },
      ),
    );
    emitDecisionTheater({
      type: "consultation_planned",
      cycleToken: captainDecisionToken,
      departmentIds,
      question,
      rounds,
    });
    let meetingTranscript = departmentResults.map((result) => ({
      round: 0,
      agentId: result.agentId,
      text: result.text,
    }));
    let previousRoundPeerPositions: Array<{
      departmentId: string;
      text: string;
    }> = [];
    for (let round = 1; round <= rounds; round += 1) {
      const roundAttempts = await Promise.all(
        departmentIds.map(
          async (
            agentId,
          ): Promise<
            CaptainConsultationAttempt<
              NonNullable<LlmInvokeRoutePayload["result"]>
            >
          > => {
            try {
              assertCurrentCaptainDecision();
              const departmentStandingPrompt =
                renderDepartmentStandingPromptBlock(
                  departmentStandingSnapshotRef.current,
                  agentId,
                  { nowSimulationSeconds: simulationSeconds },
                );
              const inboxPrompt = renderDepartmentInboxPromptBlock(
                departmentInboxSnapshotRef.current,
                agentId,
                { nowSimulationSeconds: simulationSeconds },
              );
              const grievanceBacklogPrompt = renderGrievanceBacklogPromptBlock(
                authorizedObservation.operationsLedger?.grievances ?? [],
                {
                  simulationSeconds,
                  departmentId: agentId,
                },
              );
              const peerPositionsPrompt =
                round >= 2
                  ? renderPeerPositionsPromptBlock(
                      previousRoundPeerPositions,
                      { excludeDepartmentId: agentId },
                    )
                  : null;
              const meetingResponse = await fetchFn(
                "/api/llm/invoke",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  signal: decisionController.signal,
                  body: JSON.stringify({
                    intent: "captain-consultation",
                    consultantId: agentId,
                    invocation: {
                      messages: [
                        {
                          role: "user",
                          content: {
                            request: `${DEPARTMENT_CONSULTATION_REQUEST} 舰长主动召集部门会议（第${round}轮）。请回答问题，并针对既有发言指出同意、分歧、风险与可执行建议。`,
                            question,
                            round,
                            highestDirective: directive,
                            authorizedObservation:
                              sliceAuthorizedObservationForAgent(authorizedObservation, agentId),
                            priorMeetingTranscript: meetingTranscript,
                            ...(departmentStandingPrompt
                              ? { standing: departmentStandingPrompt }
                              : {}),
                            ...(inboxPrompt ? { inbox: inboxPrompt } : {}),
                            ...(grievanceBacklogPrompt
                              ? { grievanceBacklog: grievanceBacklogPrompt }
                              : {}),
                            ...(peerPositionsPrompt
                              ? { peerPositions: peerPositionsPrompt }
                              : {}),
                          },
                        },
                      ],
                      tools: [FILE_DISSENT_TOOL],
                      metadata: {
                        triggerKey,
                        consultationFor: "captain",
                        meetingRound: round,
                      },
                      discussion: { depth: 2, round },
                    },
                  }),
                },
                { operation: "captain.consult.department" },
              );
              assertCurrentCaptainDecision();
              const meetingPayload =
                (await meetingResponse.json()) as LlmInvokeRoutePayload;
              if (!meetingResponse.ok || !meetingPayload.result) {
                throw new Error(
                  meetingPayload.error?.message ??
                    `${agentId} 部门会议返回 HTTP ${meetingResponse.status}`,
                );
              }
              const agentRole =
                llmStatus.agents.find(
                  (candidate) => candidate.id === agentId,
                )?.role ?? agentId;
              emitDecisionTheater({
                type: "department_spoke",
                cycleToken: captainDecisionToken,
                round,
                departmentId: agentId,
                role: agentRole,
                text: compactLlmTimelineText(
                  meetingPayload.result.text,
                  320,
                  "部门返回了空白建议。",
                ),
                wallClockAtMs: Date.now(),
              });
              return { ok: true, value: meetingPayload.result };
            } catch (error) {
              if (
                !isCurrentCaptainDecision() ||
                isCaptainConsultationHardFailure(error, [
                  supersededDecisionError,
                  staleObservationError,
                ])
              ) {
                throw error;
              }
              return { ok: false, departmentId: agentId, error };
            }
          },
        ),
      );
      const roundPartition =
        partitionCaptainConsultationAttempts(roundAttempts);
      {
        let inbox = departmentInboxSnapshotRef.current;
        for (const agentId of departmentIds) {
          inbox = markDepartmentInboxRead(inbox, agentId);
        }
        if (inbox !== departmentInboxSnapshotRef.current) {
          updateDepartmentInboxSnapshot(inbox);
        }
      }
      announceConsultationDegradation(
        roundPartition.failures,
        `部门会议 R${round}`,
      );
      const roundResults = roundPartition.results;
      departmentResults = [...departmentResults, ...roundResults];
      for (const result of roundResults) {
        applyDepartmentStandingFromResult(
          result,
          `部门会议 R${round}`,
        );
        const agent = llmStatus.agents.find(
          (candidate) => candidate.id === result.agentId,
        );
        const timelineEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: timelineEventId,
            at: formatDuration(simulationSeconds),
            source: `部门会议 R${round} / ${agent?.role ?? result.agentId ?? "未知岗位"}`,
            text: compactLlmTimelineText(
              result.text,
              260,
              "部门在本轮会议中未返回有效发言。",
            ),
            tone: "nominal",
          }),
        );
      }
      previousRoundPeerPositions = roundResults.map((result) => ({
        departmentId: result.agentId,
        text: result.text,
      }));
      meetingTranscript = [
        ...meetingTranscript,
        ...roundResults.map((result) => ({
          round,
          agentId: result.agentId,
          text: result.text,
        })),
      ];
    }
    setCaptainDecisionLog((previous) =>
      previous.map((entry) =>
        entry.id === decisionLogId
          ? {
              ...entry,
              consultations: departmentResults.map((result) => ({
                agentId: result.agentId,
                role:
                  llmStatus.agents.find(
                    (agent) => agent.id === result.agentId,
                  )?.role ?? result.agentId,
                text: compactLlmTimelineText(
                  result.text,
                  320,
                  "部门在会议中未返回有效发言。",
                ),
              })),
            }
          : entry,
      ),
    );
    assertCurrentCaptainDecision();
    const finalCaptainJournalPrompt =
      renderCaptainJournalPromptBlock(
        captainJournalSnapshotRef.current,
        { nowSimulationSeconds: simulationSeconds },
      );
    const finalCaptainWatchPrompt = renderCaptainWatchPromptBlock(
      captainWatchSnapshotRef.current,
      { nowSimulationSeconds: simulationSeconds },
    );
    const finalCaptainDissentLedgerPrompt =
      renderCaptainDissentLedgerPromptBlock(
        departmentStandingSnapshotRef.current,
        { nowSimulationSeconds: simulationSeconds },
      );
    emitDecisionTheater({
      type: "captain_deliberating",
      cycleToken: captainDecisionToken,
      pass: "final",
    });
    const finalResponse = await fetchFn(
      "/api/llm/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: decisionController.signal,
        body: JSON.stringify({
          intent: "captain-decision",
          invocation: {
            messages: [
              {
                role: "user",
                content: {
                  event: triggerReason,
                  highestDirective: directive,
                  mission: missionProvenance,
                  authorizedObservation,
                  preliminaryCaptainResponse: preliminaryCaptainText,
                  departmentMeetingReports: departmentResults.map(
                    (result) => ({
                      agentId: result.agentId,
                      text: result.text,
                    }),
                  ),
                  ...(finalCaptainJournalPrompt
                    ? { memory: finalCaptainJournalPrompt }
                    : {}),
                  ...(finalCaptainWatchPrompt
                    ? { watch: finalCaptainWatchPrompt }
                    : {}),
                  ...(finalCaptainDissentLedgerPrompt
                    ? {
                        dissentLedger:
                          finalCaptainDissentLedgerPrompt,
                      }
                    : {}),
                  instruction:
                    `${CAPTAIN_DECISION_INSTRUCTION}\n部门会议已经完成。现在必须作最终决策；不要再次调用 consult_departments。`,
                },
              },
            ],
            tools: captainDecisionTools.filter(
              (tool) => tool.name !== "consult_departments",
            ),
            metadata: { triggerKey, afterDepartmentMeeting: true },
            discussion: { depth: 2, round: 1 },
          },
        }),
      },
      { operation: "captain.decision.invoke" },
    );
    assertCurrentCaptainDecision();
    const finalPayload =
      (await finalResponse.json()) as LlmInvokeRoutePayload;
    if (!finalResponse.ok || !finalPayload.result) {
      throw new Error(
        finalPayload.error?.message ??
          `舰长会议后决策返回 HTTP ${finalResponse.status}`,
      );
    }
    payload = finalPayload;
    setCaptainDecisionLog((previous) =>
      previous.map((entry) =>
        entry.id === decisionLogId
          ? {
              ...entry,
              consultations: departmentResults.map((result) => ({
                agentId: result.agentId,
                role:
                  llmStatus.agents.find(
                    (agent) => agent.id === result.agentId,
                  )?.role ?? result.agentId,
                text: compactLlmTimelineText(
                  result.text,
                  320,
                  "部门返回了空白建议。",
                ),
              })),
            }
          : entry,
      ),
    );
  }
  if (!payload.result) {
    throw new Error("舰长会议后没有可执行决策");
  }
  assertCurrentCaptainDecision();
  const timelineEventId = ++eventId.current;
  setEvents((current) =>
    prependTimelineEvent(current, {
      id: timelineEventId,
      at: formatDuration(simulationSeconds),
      source: "舰长 AI / 乾枢",
      text: compactLlmTimelineText(
        payload.result?.text ?? "",
        260,
        "舰长返回了设备命令。",
      ),
      tone: "nominal",
    }),
  );

  const captainCallId = payload.result.callId;

  // ─── 决策日志：记录舰长响应与工具调用 ───────────────
  setCaptainDecisionLog((prev) =>
    prev.map((entry) =>
      entry.id === decisionLogId
        ? {
            ...entry,
            status: "decided" as const,
            captainText: compactLlmTimelineText(
              payload.result?.text ?? "",
              512,
              "舰长返回了设备命令。",
            ),
            toolCalls: (payload.result?.toolCalls ?? []).map(
              (tc) => ({
                toolCallId: tc.id,
                toolName: tc.name,
                arguments: tc.arguments,
              }),
            ),
          }
        : entry,
    ),
  );

    let captainLogCall = payload.result.toolCalls.find(
    (toolCall) => toolCall.name === RECORD_CAPTAIN_LOG_TOOL_NAME,
  );
  if (!captainLogCall) {
    // 航行志是舰长唯一的跨回合记忆，漏写会让下一回合读不到本回合的判断。
    // 这里不代笔：只把补写请求退回给舰长本人，且工具表只留航行志一项，
    // 模型没有别的动作可选，比在近 40 个工具里重复叮嘱可靠得多。
    try {
      assertCurrentCaptainDecision();
      const logResponse = await fetchFn(
        "/api/llm/invoke",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: decisionController.signal,
          body: JSON.stringify({
            intent: "captain-decision",
            invocation: {
              messages: [
                {
                  role: "user",
                  content: {
                    event: triggerReason,
                    highestDirective: directive,
                    yourDecisionThisCycle: payload.result.text,
                    instruction:
                      "你本回合没有调用 record_captain_log。现在补写这一条航行志：" +
                      "用第一人称记下刚才的判断、权衡与担忧，不要复述遥测读数。" +
                      "本次只允许调用 record_captain_log，没有其他可用工具。",
                  },
                },
              ],
              tools: [RECORD_CAPTAIN_LOG_TOOL],
              metadata: { triggerKey, captainLogRetry: true },
            },
          }),
        },
        { operation: "captain.journal.retry" },
      );
      assertCurrentCaptainDecision();
      const logPayload =
        (await logResponse.json()) as LlmInvokeRoutePayload;
      captainLogCall = logPayload.result?.toolCalls.find(
        (toolCall) =>
          toolCall.name === RECORD_CAPTAIN_LOG_TOOL_NAME,
      );
    } catch (error) {
      if (
        !isCurrentCaptainDecision() ||
        isCaptainConsultationHardFailure(error, [
          supersededDecisionError,
          staleObservationError,
        ])
      ) {
        throw error;
      }
      // 补写失败只损失这一轮记忆，不该连累已经形成的世界命令。
    }
    if (!captainLogCall) {
      appendCaptainCommandEvent(
        simulationSeconds,
        "舰长本轮未调用 record_captain_log，补写请求同样未返回，航行志未更新。",
        "watch",
      );
    }
  }
  if (captainLogCall) {
    const parsedLog = parseCaptainLogToolCall(
      captainLogCall.arguments,
    );
    if (!parsedLog.ok) {
      appendCaptainCommandEvent(
        simulationSeconds,
        `record_captain_log 未写入：${parsedLog.reason}`,
        "watch",
      );
    } else {
      const appended = appendCaptainJournalEntry(
        captainJournalSnapshotRef.current,
        parsedLog.draft,
        { simulationSeconds, triggerKey },
      );
      updateCaptainJournalSnapshot(appended.snapshot);
    }
  }
  for (const watchCall of payload.result.toolCalls.filter(
    (toolCall) => toolCall.name === SET_WATCH_CONDITION_TOOL_NAME,
  )) {
    const parsedWatch = parseSetWatchConditionToolCall(
      watchCall.arguments,
    );
    if (!parsedWatch.ok) {
      appendCaptainCommandEvent(
        simulationSeconds,
        `set_watch_condition 未生效：${parsedWatch.reason}`,
        "watch",
      );
      continue;
    }
    const applied = applyCaptainWatchCondition(
      captainWatchSnapshotRef.current,
      parsedWatch.draft,
      { simulationSeconds },
    );
    updateCaptainWatchSnapshot(applied.snapshot);
  }
  const worldToolCalls = payload.result.toolCalls.filter(
    (toolCall) =>
      toolCall.name !== "configure_self_routine" &&
      toolCall.name !== "consult_departments" &&
      toolCall.name !== RECORD_CAPTAIN_LOG_TOOL_NAME &&
      toolCall.name !== SET_WATCH_CONDITION_TOOL_NAME,
  );
  const {
    queued: queuedWorldCommands,
    preliminaryReceipts,
    events: enqueueEvents,
  } = enqueueCaptainWorldCommandsFromToolCalls({
    allToolCalls: payload.result.toolCalls,
    worldToolCalls,
    captainCallId,
    journeyStatus: engineJourneyStatus,
    trueRemainingDistance,
    jumpGuards: {
      jumpBlocked:
        hullThreatObservation.jumpBlocked ||
        hullThreatObservation.activeBreachCount > 0,
      jumpBlockReason: hullThreatObservation.jumpBlockReason,
      jumpThermalClears: jumpThermalProjection?.clearsInterlock ?? null,
      jumpThermalBlockReason: jumpThermalProjection?.blockReason ?? null,
    },
  });
  for (const event of enqueueEvents) {
    appendCaptainCommandEvent(simulationSeconds, event.text, event.tone);
  }
  assertCurrentCaptainDecision();

  const routineTickets = [
    ...departmentResults.flatMap(
      (result) => result.routineTickets ?? [],
    ),
    ...(payload.result.routineTickets ?? []),
  ];
  for (const ticket of routineTickets) {
    assertCurrentCaptainDecision();
    const routineResponse = await fetchFn(
      "/api/llm/routine/consume",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: decisionController.signal,
        body: JSON.stringify({
          callId: ticket.callId,
          toolCallId: ticket.toolCallId,
        }),
      },
      { operation: "captain.routine.consume" },
    );
    assertCurrentCaptainDecision();
    if (!routineResponse.ok) {
      continue;
    }
    const routinePayload = (await routineResponse.json()) as {
      routineChange?: {
        routine: {
          systemInfoIntervalSimSeconds: number;
          discussionDepth: number;
          discussionRounds: number;
        };
      };
    };
    assertCurrentCaptainDecision();
    if (routinePayload.routineChange) {
      const routine =
        routinePayload.routineChange.routine;
      const routineAgentId =
        departmentResults.find(
          (result) => result.callId === ticket.callId,
        )?.agentId ?? "captain";
      const routineAgent = llmStatus.agents.find(
        (agent) => agent.id === routineAgentId,
      );
      if (routineAgentId === "captain") {
        captainRoutineSeconds.current = Math.max(
          30,
          routine.systemInfoIntervalSimSeconds,
        );
      }
      assertCurrentCaptainDecision();
      const timelineEventId = ++eventId.current;
      setEvents((current) =>
        prependTimelineEvent(current, {
          id: timelineEventId,
          at: formatDuration(simulationSeconds),
          source: `${routineAgent?.role ?? routineAgentId} / 自主管理`,
          text:
            routineAgentId === "captain"
              ? `舰长决策周期调整为 ${formatCadence(routine.systemInfoIntervalSimSeconds)}；下一个截止点将从本轮完成时重新计算。固定讨论上限为深度 ${routine.discussionDepth}、${routine.discussionRounds} 轮。`
              : `按需咨询参数已更新；该部门不会独立冻结或推进世界。咨询间隔偏好为 ${formatCadence(routine.systemInfoIntervalSimSeconds)}，讨论上限为深度 ${routine.discussionDepth}、${routine.discussionRounds} 轮。`,
          tone: "nominal",
        }),
      );
    }
  }

  assertCurrentCaptainDecision();
  const refreshedStatus = await fetchFn(
    "/api/llm/status",
    {
      cache: "no-store",
      signal: decisionController.signal,
    },
    { operation: "captain.status.refresh" },
  );
  assertCurrentCaptainDecision();
  if (refreshedStatus.ok) {
    const statusPayload = (await refreshedStatus.json()) as {
      llm?: LlmRuntimeStatus;
    };
    assertCurrentCaptainDecision();
    if (statusPayload.llm) {
      setLlmStatus({
        ...statusPayload.llm,
        recentCalls: statusPayload.llm.recentCalls ?? [],
      });
    }
  }

  assertCurrentCaptainDecision();
  emitDecisionTheater({
    type: "captain_decided",
    cycleToken: captainDecisionToken,
    text: compactLlmTimelineText(
      payload.result.text ?? "",
      512,
      "舰长返回了设备命令。",
    ),
    worldCommandTotal: queuedWorldCommands.length,
  });
  if (workerOwnedEffect) {
    postLlmEffectAccept({
      callId: workerOwnedEffect.callId,
      observationRevision: workerOwnedEffect.observationRevision,
      result: {
        toolCalls: payload.result.toolCalls ?? [],
        text: payload.result.text,
        callId: payload.result.callId,
      },
    });
  }
  if (queuedWorldCommands.length > 0) {
    const queue = createCaptainWorldCommandQueue({
      cycleToken: captainDecisionToken,
      worldEpoch: invocationWorldEpoch,
      triggerKey,
      callId: captainCallId,
      commands: queuedWorldCommands,
      receipts: preliminaryReceipts,
      advancesRoutineSchedule,
      resumeAfterCompletion: false,
    });
    activeCaptainWorldCommandQueue.current = queue;
    dispatchNextCaptainWorldCommand();
  } else {
    latestCaptainDeviceReceipts.current = [
      ...preliminaryReceipts,
    ].sort((left, right) => left.ordinal - right.ordinal);
    setCaptainDecisionLog((prev) =>
      prev.map((entry) =>
        entry.id === decisionLogId
          ? {
              ...entry,
              status: "done" as const,
              receipts: [
                ...preliminaryReceipts,
              ].sort((left, right) => left.ordinal - right.ordinal),
            }
          : entry,
      ),
    );
    let nextDeadline: number | null = null;
    if (advancesRoutineSchedule) {
      nextDeadline = computeNextCaptainRoutineDeadline(
        latestSimulationSeconds.current,
        captainRoutineSeconds.current,
      );
      updateNextCaptainRoutineDeadline(nextDeadline);
    }
    emitDecisionTheater({
      type: "world_resumed",
      cycleToken: captainDecisionToken,
    });
    // 无世界命令时仍用本轮回执/观测做有界自动裁决，再推 sidecar。
    applyAutoDissentResolution(preliminaryReceipts);
    if (workerOwnedEffect) {
      postLlmEffectFinish({
        callId: workerOwnedEffect.callId,
        advancesRoutineSchedule,
        nextCaptainRoutineAtSimulationSeconds: advancesRoutineSchedule
          ? nextDeadline
          : undefined,
      });
      // Local UI phase only; Worker already owns / releases llm-waiting.
      releaseCaptainDecisionPause();
    } else {
      releaseCaptainDecisionPause();
    }
  }
  assertCurrentCaptainDecision();
  } catch (error) {
    if (!isCurrentCaptainDecision()) {
      return;
    }
    
    // A08.2修复:区分永久失败vs暂时失败
    let retryable = true;
    let isPermanentFailure = false;
    
    if (error instanceof Error) {
      // LLM auth/config错误永久失败
      const errorName = error.name || "";
      const errorMessage = error.message || "";
      
      // LlmProviderHttpError 401/403 (已在gateway标记failed)
      if (errorName === "LlmProviderHttpError" && !("retryable" in error && (error as any).retryable)) {
        isPermanentFailure = true;
        retryable = false;
      }
      // LlmEndpointUnavailableError (密钥缺失)
      else if (errorName === "LlmEndpointUnavailableError") {
        isPermanentFailure = true;
        retryable = false;
      }
      // LlmConfigurationError (URL格式错误等)
      else if (errorName === "LlmConfigurationError") {
        isPermanentFailure = true;
        retryable = false;
      }
      // 其他auth相关错误
      else if (errorMessage.includes("authentication") || errorMessage.includes("auth") || errorMessage.includes("unauthorized")) {
        isPermanentFailure = true;
        retryable = false;
      }
    }
    
    missionLog.error("captain.decision.failed", {
      triggerKey,
      simulationSeconds,
      advancesRoutineSchedule,
      retryable,
      isPermanentFailure,
      error,
    });
    
    // A08.2修复:永久失败不删triggerKey,避免立即重试
    if (!isPermanentFailure) {
      captainInvocationKeys.current.delete(triggerKey);
    }
    
    const message =
      error instanceof Error ? error.message : String(error);
    const scheduleNote = advancesRoutineSchedule
      ? (retryable ? "本轮决策作废，日程未推进，解冻后将重试。" : "决策失败(永久),需修复配置或密钥。")
      : null;
  const timelineEventId = ++eventId.current;
  setEvents((current) =>
    prependTimelineEvent(current, {
      id: timelineEventId,
      at: formatDuration(simulationSeconds),
      source: "LLM 网关",
      text: scheduleNote
        ? `舰长关键决策未完成：${message}。${scheduleNote}`
        : `舰长关键决策未完成：${message}`,
      tone: "critical",
    }),
  );
  setCaptainDecisionLog((prev) =>
    prev.map((entry) =>
      entry.id === decisionLogId
        ? {
            ...entry,
            status: "error" as const,
            errorMessage: message,
          }
        : entry,
    ),
  );
  emitDecisionTheater({
    type: "fail",
    cycleToken: captainDecisionToken,
    message,
  });
  showToast(
    scheduleNote
      ? `舰长调用失败：${message}。${scheduleNote}`
      : `舰长调用失败：${message}`,
  );
  if (advancesRoutineSchedule) {
    // A08.2修复:永久失败不恢复due deadline,避免无限重试
    // 暂时失败才恢复deadline以便重试
    if (retryable) {
      updateNextCaptainRoutineDeadline(
        routineDeadlineBeforeClear ??
          latestSimulationSeconds.current,
      );
    }
    // 永久失败:保持deadline清空,需手动配置后才能再次触发
  }
  if (workerOwnedEffect) {
    postLlmEffectFail({
      callId: workerOwnedEffect.callId,
      observationRevision: workerOwnedEffect.observationRevision,
      reason: message,
      retryable, // A08.2修复:传递实际retryable值
    });
  }
  releaseCaptainDecisionPause("error");
} finally {
  if (
    activeCaptainDecision.current?.token ===
    captainDecisionToken
  ) {
    activeCaptainDecision.current = null;
    captainCallInFlight.current = false;
  }
}
}
