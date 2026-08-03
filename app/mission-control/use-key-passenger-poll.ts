"use client";

import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ShipState } from "@/lib/sim";
import type { CaptainOperationsSnapshot } from "@/lib/sim/captain-operations";
import type {
  CompartmentTelemetry,
  PassengerCircleTelemetry,
  SimulationWorkerCommand,
  ZoneMoodTelemetry,
} from "@/lib/sim/protocol";
import type {
  LlmInvokeRoutePayload,
  LlmRuntimeStatus,
  TimelineEvent,
} from "@/app/ui/types";
import {
  KeyPassengerPollScheduler,
  type KeyPassengerPrivateNote,
} from "@/lib/llm/key-passenger-polling";
import {
  FILE_GRIEVANCE_TOOL_NAME,
  PASSENGER_CIRCLE_LIMIT,
  SHARE_RUMOR_TOOL_NAME,
  markRumorsHeard,
  parseFileGrievanceToolCall,
  parseShareRumorToolCall,
  pruneStaleRumors,
  recordPassengerRumor,
  renderPassengerSocietyPromptBlock,
  selectOverheardRumors,
  type PassengerSocietySnapshot,
} from "@/lib/llm/passenger-society";
import {
  FILE_PASSENGER_GRIEVANCE_TOOL,
  SHARE_PASSENGER_RUMOR_TOOL,
} from "@/lib/llm/captain-world-tools";
import {
  passengerConditionBand,
  passengerStressBand,
  passengerTrustBand,
} from "@/lib/llm/captain-watch-metrics";
import {
  compactLlmTimelineText,
  formatDuration,
  prependTimelineEvent,
} from "@/app/ui/utils";
import { createLogger } from "@/lib/observability/logger";
import { observedFetch } from "@/lib/observability/observed-fetch";

const missionLog = createLogger("mission-control");

export type KeyPassengerCallCycle = {
  token: number;
  worldEpoch: number;
  pollId: string;
  passengerId: string;
  controller: AbortController;
};

export type KeyPassengerPollToast = (
  message: string,
  options?: { persistent?: boolean },
) => void;

export type UseKeyPassengerPollParams = {
  missionStarted: boolean;
  missionEnded: boolean;
  paused: boolean;
  engineState: ShipState | null;
  llmStatus: LlmRuntimeStatus | null;
  simulationSeconds: number;
  originSystemName: string;
  destinationSystemName: string;
  compartmentState: CompartmentTelemetry | null;
  operationsState: CaptainOperationsSnapshot | null;
  passengerCircles: PassengerCircleTelemetry[];
  zoneMood: ZoneMoodTelemetry[];
  showToast: KeyPassengerPollToast;
  updatePassengerSocietySnapshot: (value: PassengerSocietySnapshot) => void;
  setKeyPassengerPrivateNotes: Dispatch<
    SetStateAction<KeyPassengerPrivateNote[]>
  >;
  setEvents: Dispatch<SetStateAction<TimelineEvent[]>>;
  setLlmStatus: Dispatch<SetStateAction<LlmRuntimeStatus | null>>;
  latestStateRevision: MutableRefObject<number | null>;
  pendingLoad: { readonly current: unknown };
  pendingSaveBarrier: { readonly current: unknown };
  pendingSaves: { readonly current: { readonly size: number } };
  activeCaptainWorldCommandQueue: { readonly current: unknown };
  captainCallInFlight: MutableRefObject<boolean>;
  keyPassengerCallInFlight: MutableRefObject<boolean>;
  keyPassengerScheduler: MutableRefObject<KeyPassengerPollScheduler>;
  keyPassengerCallSequence: MutableRefObject<number>;
  worldEpoch: MutableRefObject<number>;
  activeKeyPassengerCall: MutableRefObject<KeyPassengerCallCycle | null>;
  passengerSocietySnapshotRef: MutableRefObject<PassengerSocietySnapshot>;
  latestSimulationSeconds: MutableRefObject<number>;
  eventId: MutableRefObject<number>;
  workerRef: MutableRefObject<Worker | null>;
  requestSequence: MutableRefObject<number>;
  commandRevision: MutableRefObject<number>;
};

/**
 * 关键乘客轻量轮询：单并发、不冻结等待 LLM waiting、经 observedFetch。
 */
export function useKeyPassengerPoll(params: UseKeyPassengerPollParams): void {
  const {
    missionStarted,
    missionEnded,
    paused,
    engineState,
    llmStatus,
    simulationSeconds,
    originSystemName,
    destinationSystemName,
    compartmentState,
    operationsState,
    passengerCircles,
    zoneMood,
    showToast,
    updatePassengerSocietySnapshot,
    setKeyPassengerPrivateNotes,
    setEvents,
    setLlmStatus,
    latestStateRevision,
    pendingLoad,
    pendingSaveBarrier,
    pendingSaves,
    activeCaptainWorldCommandQueue,
    captainCallInFlight,
    keyPassengerCallInFlight,
    keyPassengerScheduler,
    keyPassengerCallSequence,
    worldEpoch,
    activeKeyPassengerCall,
    passengerSocietySnapshotRef,
    latestSimulationSeconds,
    eventId,
    workerRef,
    requestSequence,
    commandRevision,
  } = params;

  const syncPassengerSocietyToWorker = (
    snapshot: PassengerSocietySnapshot,
  ) => {
    const worker = workerRef.current;
    if (!worker) {
      return;
    }
    requestSequence.current += 1;
    const command: SimulationWorkerCommand = {
      type: "set-runtime-sidecars",
      requestId: `society-sync-${requestSequence.current}`,
      passengerSociety: snapshot,
    };
    worker.postMessage(command);
  };

  useEffect(() => {
    if (
      !missionStarted ||
      missionEnded ||
      paused ||
      !engineState ||
      !llmStatus?.ready ||
      latestStateRevision.current !== engineState.revision ||
      pendingLoad.current !== null ||
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0 ||
      activeCaptainWorldCommandQueue.current !== null ||
      captainCallInFlight.current ||
      keyPassengerCallInFlight.current
    ) {
      return;
    }

    const routineSecondsByPassenger = new Map(
      llmStatus.agents.map((agent) => [
        agent.id,
        agent.routine.systemInfoIntervalSimSeconds,
      ]),
    );
    const wallEpochMs = Date.now();
    const candidate = keyPassengerScheduler.current.selectNextDue(
      simulationSeconds,
      wallEpochMs,
      routineSecondsByPassenger,
    );
    if (!candidate) {
      return;
    }

    keyPassengerCallSequence.current += 1;
    const callToken = keyPassengerCallSequence.current;
    const callWorldEpoch = worldEpoch.current;
    const pollId = `passenger-poll:${callWorldEpoch}:${callToken}:${candidate.passengerId}`;
    const controller = new AbortController();
    const cycle: KeyPassengerCallCycle = {
      token: callToken,
      worldEpoch: callWorldEpoch,
      pollId,
      passengerId: candidate.passengerId,
      controller,
    };
    activeKeyPassengerCall.current = cycle;
    keyPassengerCallInFlight.current = true;
    keyPassengerScheduler.current.markDispatched(
      candidate.passengerId,
      simulationSeconds,
      wallEpochMs,
    );

    const isSamePassengerCycle = () => {
      const active = activeKeyPassengerCall.current;
      return (
        active?.token === callToken &&
        active.worldEpoch === callWorldEpoch &&
        active.pollId === pollId &&
        active.passengerId === candidate.passengerId &&
        worldEpoch.current === callWorldEpoch
      );
    };
    const timeout = window.setTimeout(() => {
      if (isSamePassengerCycle()) {
        controller.abort(new Error("关键乘客轻量调用超过 30 秒上限"));
      }
    }, 30_000);

    void (async () => {
      try {
        updatePassengerSocietySnapshot(
          pruneStaleRumors(passengerSocietySnapshotRef.current, {
            simulationSeconds,
          }),
        );
        syncPassengerSocietyToWorker(passengerSocietySnapshotRef.current);
        const passengerZoneId = candidate.observation.assignedZoneId;
        const circleTelemetry = passengerCircles.find(
          (circle) => circle.passengerId === candidate.passengerId,
        );
        const circle = (circleTelemetry?.members ?? [])
          .slice(0, PASSENGER_CIRCLE_LIMIT)
          .map((member) => ({
            passengerId: member.passengerId,
            displayName: member.displayName,
            relation: member.relation,
            lifeState: member.lifeState,
            conditionBand: passengerConditionBand(member.physicalHealth),
            sameZone: member.zoneId === passengerZoneId,
          }));
        const zoneMoodTelemetry = zoneMood.find(
          (zone) => zone.zoneId === passengerZoneId,
        );
        const zoneLabel =
          compartmentState?.zones.find(
            (zone) => zone.zoneId === passengerZoneId,
          )?.labelZh ?? passengerZoneId;
        const zoneMoodObservation = zoneMoodTelemetry
          ? {
              zoneId: zoneMoodTelemetry.zoneId,
              zoneLabel,
              awakeCount: zoneMoodTelemetry.awakeCount,
              stressBand: passengerStressBand(zoneMoodTelemetry.meanStress),
              trustBand: passengerTrustBand(zoneMoodTelemetry.meanTrust),
            }
          : null;
        const overheardRumors = selectOverheardRumors(
          passengerSocietySnapshotRef.current,
          {
            listenerPassengerId: candidate.passengerId,
            zoneId: passengerZoneId,
            simulationSeconds,
          },
        );
        if (overheardRumors.length > 0) {
          updatePassengerSocietySnapshot(
            markRumorsHeard(
              passengerSocietySnapshotRef.current,
              overheardRumors.map((rumor) => rumor.rumorId),
            ),
          );
          syncPassengerSocietyToWorker(passengerSocietySnapshotRef.current);
        }
        const recentPublicCommunications = (
          operationsState?.communications ?? []
        )
          .filter(
            (entry) =>
              entry.deliveredAtMicroseconds !== null &&
              (entry.kind === "announcement" ||
                entry.kind === "policy-explanation" ||
                entry.kind === "grievance-response"),
          )
          .slice(-3)
          .map((entry) => ({
            simulationSeconds:
              (entry.deliveredAtMicroseconds ?? entry.createdAtMicroseconds) /
              1_000_000,
            text: `${entry.subject}：${entry.message}`,
          }));
        const societyPrompt = renderPassengerSocietyPromptBlock(
          {
            circle,
            zoneMood: zoneMoodObservation,
            overheardRumors,
            recentPublicCommunications,
          },
          { nowSimulationSeconds: simulationSeconds },
        );
        const response = await observedFetch(
          "/api/llm/invoke",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              intent: "passenger-self",
              passengerId: candidate.passengerId,
              pollId,
              selfObservation: {
                ...candidate.observation,
                sampleAgeSeconds: candidate.sampleAgeSeconds,
              },
              publicContext: {
                origin: originSystemName,
                destination: destinationSystemName,
                elapsedSimulationSeconds: simulationSeconds,
              },
              previousOwnNote: candidate.previousOwnNote,
              ...(societyPrompt ? { society: societyPrompt } : {}),
              tools: [FILE_PASSENGER_GRIEVANCE_TOOL, SHARE_PASSENGER_RUMOR_TOOL],
            }),
          },
          { operation: "key-passenger.invoke" },
        );
        if (!isSamePassengerCycle() || controller.signal.aborted) {
          return;
        }
        const payload = (await response.json()) as LlmInvokeRoutePayload;
        if (!isSamePassengerCycle() || controller.signal.aborted) {
          return;
        }
        if (!response.ok || !payload.result) {
          throw new Error(
            payload.error?.message ??
              `关键乘客端点返回 HTTP ${response.status}`,
          );
        }
        if (payload.result.agentId !== candidate.passengerId) {
          throw new Error("关键乘客端点返回了不匹配的固定身份");
        }

        const privateText = compactLlmTimelineText(
          payload.result.text,
          512,
          "本轮没有提交新的个人需求。",
        );
        keyPassengerScheduler.current.markSucceeded(
          candidate.passengerId,
          latestSimulationSeconds.current,
          privateText,
        );
        setKeyPassengerPrivateNotes(
          keyPassengerScheduler.current.listPrivateNotes(),
        );

        for (const toolCall of payload.result.toolCalls) {
          if (!isSamePassengerCycle() || controller.signal.aborted) {
            return;
          }
          if (toolCall.name === SHARE_RUMOR_TOOL_NAME) {
            const parsed = parseShareRumorToolCall(toolCall.arguments);
            if (!parsed.ok) {
              const rumorEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: rumorEventId,
                  at: formatDuration(latestSimulationSeconds.current),
                  source: `关键乘客 / ${candidate.observation.displayName}`,
                  text: `share_passenger_rumor 未写入：${parsed.reason}`,
                  tone: "watch",
                }),
              );
              continue;
            }
            try {
              const recorded = recordPassengerRumor(
                passengerSocietySnapshotRef.current,
                {
                  originPassengerId: candidate.passengerId,
                  originDisplayName: candidate.observation.displayName,
                  zoneId: passengerZoneId,
                  text: parsed.draft.text,
                  simulationSeconds: latestSimulationSeconds.current,
                },
              );
              updatePassengerSocietySnapshot(recorded.snapshot);
              syncPassengerSocietyToWorker(recorded.snapshot);
            } catch (error) {
              const rumorEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: rumorEventId,
                  at: formatDuration(latestSimulationSeconds.current),
                  source: `关键乘客 / ${candidate.observation.displayName}`,
                  text: `share_passenger_rumor 未写入：${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  tone: "watch",
                }),
              );
            }
            continue;
          }
          if (toolCall.name === FILE_GRIEVANCE_TOOL_NAME) {
            const parsed = parseFileGrievanceToolCall(toolCall.arguments);
            if (!parsed.ok) {
              const grievanceEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: grievanceEventId,
                  at: formatDuration(latestSimulationSeconds.current),
                  source: `关键乘客 / ${candidate.observation.displayName}`,
                  text: `file_passenger_grievance 未提交：${parsed.reason}`,
                  tone: "watch",
                }),
              );
              continue;
            }
            const worker = workerRef.current;
            const expectedStateRevision = latestStateRevision.current;
            if (!worker || expectedStateRevision === null) {
              const grievanceEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: grievanceEventId,
                  at: formatDuration(latestSimulationSeconds.current),
                  source: `关键乘客 / ${candidate.observation.displayName}`,
                  text: "file_passenger_grievance 未提交：世界状态尚不可用。",
                  tone: "watch",
                }),
              );
              continue;
            }
            // 关键乘客申诉不申请暂停令牌、不阻塞轮询；世界继续推进。
            requestSequence.current += 1;
            const grievanceRequestId = `passenger-grievance-${requestSequence.current}`;
            const commandId = grievanceRequestId;
            const command: SimulationWorkerCommand = {
              type: "ship-command",
              requestId: grievanceRequestId,
              commandId,
              idempotencyKey: commandId,
              issuedAtMicroseconds: Math.round(
                latestSimulationSeconds.current * 1_000_000,
              ),
              expectedRevision: commandRevision.current,
              expectedStateRevision,
              command: {
                kind: "file-passenger-grievance",
                actorAgentId: candidate.passengerId,
                passengerId: candidate.passengerId,
                category: parsed.draft.category,
                summary: parsed.draft.summary,
              },
            };
            worker.postMessage(command);
          }
        }

        for (const ticket of payload.result.routineTickets ?? []) {
          if (!isSamePassengerCycle() || controller.signal.aborted) {
            return;
          }
          await observedFetch(
            "/api/llm/routine/consume",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                callId: ticket.callId,
                toolCallId: ticket.toolCallId,
              }),
            },
            { operation: "key-passenger.routine.consume" },
          );
        }
        if (!isSamePassengerCycle() || controller.signal.aborted) {
          return;
        }
        const refreshedStatus = await observedFetch(
          "/api/llm/status",
          {
            cache: "no-store",
            signal: controller.signal,
          },
          { operation: "key-passenger.status.refresh" },
        );
        if (
          isSamePassengerCycle() &&
          !controller.signal.aborted &&
          refreshedStatus.ok
        ) {
          const statusPayload = (await refreshedStatus.json()) as {
            llm?: LlmRuntimeStatus;
          };
          if (statusPayload.llm) {
            setLlmStatus({
              ...statusPayload.llm,
              recentCalls: statusPayload.llm.recentCalls ?? [],
            });
          }
        }
        showToast(
          `${candidate.observation.displayName} 的私人终端记录已更新。`,
        );
      } catch (error) {
        if (!isSamePassengerCycle()) {
          return;
        }
        missionLog.warn("passenger.poll.failed", {
          passengerId: candidate.passengerId,
          pollId,
          simulationSeconds: latestSimulationSeconds.current,
          error,
        });
        keyPassengerScheduler.current.markFailed(
          candidate.passengerId,
          latestSimulationSeconds.current,
        );
        const message = error instanceof Error ? error.message : String(error);
        showToast(
          `关键乘客 ${candidate.observation.displayName} 调用延后重试：${message}`,
        );
      } finally {
        window.clearTimeout(timeout);
        if (
          activeKeyPassengerCall.current?.token === callToken &&
          activeKeyPassengerCall.current.worldEpoch === callWorldEpoch
        ) {
          activeKeyPassengerCall.current = null;
          keyPassengerCallInFlight.current = false;
        }
      }
    })();
  }, [
    activeCaptainWorldCommandQueue,
    activeKeyPassengerCall,
    captainCallInFlight,
    commandRevision,
    compartmentState,
    destinationSystemName,
    engineState,
    eventId,
    keyPassengerCallInFlight,
    keyPassengerCallSequence,
    keyPassengerScheduler,
    latestSimulationSeconds,
    latestStateRevision,
    llmStatus,
    missionEnded,
    missionStarted,
    operationsState,
    originSystemName,
    passengerCircles,
    passengerSocietySnapshotRef,
    paused,
    pendingLoad,
    pendingSaveBarrier,
    pendingSaves,
    requestSequence,
    setEvents,
    setKeyPassengerPrivateNotes,
    setLlmStatus,
    showToast,
    simulationSeconds,
    updatePassengerSocietySnapshot,
    workerRef,
    worldEpoch,
    zoneMood,
  ]);
}
