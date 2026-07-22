"use client";

import type {
  LlmRuntimeStatus,
  LlmCallPhase,
  CommandBusTelemetry,
  CaptainDecisionEntry,
} from "../types";
import { AI_ROSTER } from "../constants";
import { formatCadence, formatDuration } from "../utils";
import { StatusPill } from "../components/status-pill";
import { TopologyGraph } from "../components/topology-graph";
import { ApiStatusPanel } from "../components/api-status-panel";

function DecisionStatusBadge({ status }: { status: CaptainDecisionEntry["status"] }) {
  const tone =
    status === "error"
      ? "critical"
      : status === "done"
        ? "nominal"
        : "watch";
  const label =
    status === "thinking"
      ? "思考中"
      : status === "decided"
        ? "已决策"
        : status === "executing"
          ? "执行中"
          : status === "done"
            ? "完成"
            : "异常";
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

function DecisionCard({ entry }: { entry: CaptainDecisionEntry }) {
  return (
    <article className="decision-card">
      <div className="decision-header">
        <div className="decision-trigger">
          <strong>{entry.triggerReason}</strong>
          <span className="decision-time">
            {formatDuration(entry.simulationSeconds)}
          </span>
        </div>
        <DecisionStatusBadge status={entry.status} />
      </div>

      {entry.consultations.length > 0 && (
        <div className="decision-consultations">
          <span className="decision-section-label">部门咨询</span>
          {entry.consultations.map((consultation) => (
            <div className="consultation-item" key={consultation.agentId}>
              <span className="consultation-role">{consultation.role}</span>
              <p>{consultation.text}</p>
            </div>
          ))}
        </div>
      )}

      {entry.captainText && (
        <div className="decision-response">
          <span className="decision-section-label">舰长决策</span>
          <p>{entry.captainText}</p>
        </div>
      )}

      {entry.toolCalls.length > 0 && (
        <div className="decision-tools">
          <span className="decision-section-label">
            工具调用 ({entry.toolCalls.length})
          </span>
          <div className="tool-call-list">
            {entry.toolCalls.map((toolCall) => {
              const receipt = entry.receipts.find(
                (r) => r.toolCallId === toolCall.toolCallId,
              );
              const receiptTone =
                receipt?.status === "accepted"
                  ? "nominal"
                  : receipt?.status === "rejected" || receipt?.status === "invalid"
                    ? "critical"
                    : "watch";
              return (
                <div className="tool-call-item" key={toolCall.toolCallId}>
                  <code>{toolCall.toolName}</code>
                  {receipt && (
                    <span className={`tool-receipt receipt-${receipt.status}`}>
                      {receipt.status === "accepted"
                        ? "✓ 接受"
                        : receipt.status === "rejected"
                          ? "✗ 拒绝"
                          : receipt.status === "invalid"
                            ? "✗ 无效"
                            : receipt.status === "skipped"
                              ? "— 跳过"
                              : "… 限制"}
                    </span>
                  )}
                  {receipt?.summary && (
                    <small>{receipt.summary}</small>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {entry.errorMessage && (
        <div className="decision-error">
          <span>⚠ {entry.errorMessage}</span>
        </div>
      )}
    </article>
  );
}

export function AiView({
  status,
  callPhase,
  commandBus,
  decisionLog,
}: {
  status: LlmRuntimeStatus | null;
  callPhase: LlmCallPhase;
  commandBus: CommandBusTelemetry | null;
  decisionLog: CaptainDecisionEntry[];
}) {
  const configuredSlotCount =
    status?.agents.filter((agent) => agent.state !== "missing-secret")
      .length ?? 0;
  const configuredDepartmentCount =
    status?.agents.filter(
      (agent) =>
        AI_ROSTER.some((department) => department.id === agent.id) &&
        agent.state !== "missing-secret",
    ).length ?? 0;
  return (
    <section className="view-grid ai-view" aria-label="固定多模型观察">
      <div className="panel ai-roster-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">FIXED INTELLIGENCE / 固定拓扑</span>
            <h2>舰载智能组织</h2>
          </div>
          <StatusPill tone={status?.ready ? "nominal" : "watch"}>
            8 部门 + 32 关键乘客
          </StatusPill>
        </div>
        <div className="ai-roster">
          {AI_ROSTER.map((agent, index) => {
            const runtime = status?.agents.find(
              (candidate) => candidate.id === agent.id,
            );
            const runtimeLabel =
              runtime?.state === "ready"
                ? "端点就绪"
                : runtime?.state === "retrying"
                  ? "持续重试中"
                  : runtime?.state === "missing-secret"
                    ? "缺少服务端密钥"
                    : "检测配置";
            return (
              <article
                className={`ai-agent ${index === 0 ? "ai-captain" : ""} agent-${runtime?.state ?? "checking"}`}
                key={agent.id}
              >
                <div className="ai-glyph">
                  {index === 0 ? "C" : `D${index}`}
                </div>
                <div>
                  <span>{agent.role}</span>
                  <strong>{agent.name}</strong>
                  <p>{runtimeLabel}</p>
                </div>
                <div className="ai-agent-meta">
                  <span>{agent.model}</span>
                  <small>
                    系统信息：
                    {runtime
                      ? formatCadence(
                          runtime.routine.systemInfoIntervalSimSeconds,
                        )
                      : agent.cadence}
                  </small>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="panel topology-panel-ai">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">TOPOLOGY / 固定组织拓扑</span>
            <h2>通信网络</h2>
          </div>
        </div>
        <TopologyGraph status={status} callPhase={callPhase} />
      </div>

      <div className="panel decision-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CAPTAIN DECISION LOG / 舰长决策时间线</span>
            <h2>决策观察</h2>
          </div>
          <span className="live-mark">
            {callPhase === "waiting"
              ? "CALLING"
              : callPhase === "error"
                ? "BLOCKED"
                : status?.ready
                  ? "READY"
                  : "LOCAL"}
          </span>
        </div>

        <div className="decision-stream">
          {decisionLog.length === 0 ? (
            <div className="decision-empty">
              <p>尚无舰长决策记录。</p>
              <p>
                {status?.ready
                  ? "舰长将在例行周期或关键事件触发时做出决策。"
                  : "模型端点未就绪，决策暂停。"}
              </p>
            </div>
          ) : (
            decisionLog.map((entry) => (
              <DecisionCard key={entry.id} entry={entry} />
            ))
          )}
        </div>

        <div className="usage-grid">
          <div>
            <span>固定槽位</span>
            <strong>{status?.fixedAgentCount ?? 8}</strong>
          </div>
          <div>
            <span>已配置部门</span>
            <strong>{configuredDepartmentCount} / 8</strong>
          </div>
          <div>
            <span>累计 Token</span>
            <strong>
              {status?.usage.totalTokens.toLocaleString("zh-CN") ?? "0"}
            </strong>
          </div>
          <div>
            <span>命令总线 Revision</span>
            <strong>{commandBus?.revision ?? 0}</strong>
          </div>
        </div>

        <div className="command-audit">
          <div>
            <span>RECENT COMMANDS</span>
            <strong>{commandBus?.recentAudit.length ?? 0} 条</strong>
          </div>
          {(commandBus?.recentAudit ?? [])
            .slice()
            .reverse()
            .slice(0, 6)
            .map((entry) => (
              <article key={entry.sequence}>
                <span>
                  #{entry.sequence} · {entry.actor}
                </span>
                <strong>{entry.kind}</strong>
                <small
                  className={
                    entry.status === "succeeded"
                      ? "audit-success"
                      : "audit-rejected"
                  }
                >
                  {entry.status === "succeeded"
                    ? `接受 · r${entry.revisionAfter}`
                    : `拒绝 · r${entry.revisionBefore}`}
                </small>
              </article>
            ))}
          {(commandBus?.recentAudit.length ?? 0) === 0 && (
            <p>尚无世界内设备命令。</p>
          )}
        </div>
      </div>

      <ApiStatusPanel status={status} />
    </section>
  );
}
