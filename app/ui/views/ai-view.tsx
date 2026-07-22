"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  LlmRuntimeStatus,
  LlmCallPhase,
  CommandBusTelemetry,
  CaptainDecisionEntry,
  LlmObservationCall,
  SystemTone,
} from "../types";
import { AI_ROSTER } from "../constants";
import { formatCadence, formatDuration } from "../utils";
import { StatusPill } from "../components/status-pill";
import { TopologyGraph } from "../components/topology-graph";
import { ApiStatusPanel } from "../components/api-status-panel";

function DecisionStatusBadge({
  status,
}: {
  status: CaptainDecisionEntry["status"];
}) {
  const tone: SystemTone =
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

function agentDisplayName(agentId: string): string {
  return AI_ROSTER.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function CollapsibleText({
  text,
  label,
  lines = 3,
}: {
  text: string;
  label?: string;
  lines?: number;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (expanded) return;
    const el = textRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded, lines]);

  return (
    <div className="ai-collapse-block">
      {label ? <span className="decision-section-label">{label}</span> : null}
      <p
        ref={textRef}
        className={`ai-collapse-text${expanded ? " is-expanded" : ""}`}
        style={
          expanded
            ? undefined
            : {
                display: "-webkit-box",
                WebkitLineClamp: lines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
        }
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          className="ai-expand-btn"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开全文"}
        </button>
      )}
    </div>
  );
}

function DecisionTimeline({ entry }: { entry: CaptainDecisionEntry }) {
  const accepted = entry.receipts.filter((r) => r.status === "accepted").length;
  const rejected = entry.receipts.filter(
    (r) => r.status === "rejected" || r.status === "invalid",
  ).length;
  const steps = [
    {
      key: "think",
      label: "触发",
      active: true,
      detail: entry.status === "thinking" ? "进行中" : "已受理",
    },
    {
      key: "consult",
      label: "咨询",
      active: entry.consultations.length > 0 || entry.status !== "thinking",
      detail:
        entry.consultations.length > 0
          ? `${entry.consultations.length} 部门`
          : "—",
    },
    {
      key: "decide",
      label: "决议",
      active: Boolean(entry.captainText) || entry.status === "decided" ||
        entry.status === "executing" ||
        entry.status === "done",
      detail: entry.captainText ? "已形成" : "等待",
    },
    {
      key: "tools",
      label: "工具",
      active: entry.toolCalls.length > 0,
      detail:
        entry.toolCalls.length > 0 ? `${entry.toolCalls.length} 次` : "—",
    },
    {
      key: "receipt",
      label: "回执",
      active: entry.receipts.length > 0 || entry.status === "done",
      detail:
        entry.receipts.length > 0
          ? `✓${accepted}${rejected > 0 ? ` / ✗${rejected}` : ""}`
          : entry.status === "done"
            ? "无命令"
            : "—",
    },
  ];

  return (
    <ol className="decision-timeline" aria-label="决策步骤">
      {steps.map((step) => (
        <li
          key={step.key}
          className={`decision-step${step.active ? " is-active" : ""}`}
        >
          <span className="decision-step-label">{step.label}</span>
          <strong>{step.detail}</strong>
        </li>
      ))}
    </ol>
  );
}

function DecisionMetrics({ entry }: { entry: CaptainDecisionEntry }) {
  const accepted = entry.receipts.filter((r) => r.status === "accepted").length;
  const failed = entry.receipts.filter(
    (r) => r.status === "rejected" || r.status === "invalid",
  ).length;
  return (
    <div className="decision-metrics">
      <div>
        <span>咨询</span>
        <strong>{entry.consultations.length}</strong>
      </div>
      <div>
        <span>工具</span>
        <strong>{entry.toolCalls.length}</strong>
      </div>
      <div>
        <span>接受</span>
        <strong className="metric-ok">{accepted}</strong>
      </div>
      <div>
        <span>拒绝</span>
        <strong className={failed > 0 ? "metric-bad" : undefined}>
          {failed}
        </strong>
      </div>
    </div>
  );
}

function DecisionCard({ entry }: { entry: CaptainDecisionEntry }) {
  const [showConsultations, setShowConsultations] = useState(false);
  const detailsId = useId();

  return (
    <article className={`decision-card status-${entry.status}`}>
      <div className="decision-header">
        <div className="decision-trigger">
          <strong>{entry.triggerReason}</strong>
          <span className="decision-time">
            {formatDuration(entry.simulationSeconds)}
          </span>
        </div>
        <DecisionStatusBadge status={entry.status} />
      </div>

      <DecisionTimeline entry={entry} />
      <DecisionMetrics entry={entry} />

      {entry.consultations.length > 0 && (
        <div className="decision-consultations">
          <button
            type="button"
            className="decision-section-toggle"
            aria-expanded={showConsultations}
            aria-controls={detailsId}
            onClick={() => setShowConsultations((value) => !value)}
          >
            <span className="decision-section-label">
              部门咨询 · {entry.consultations.length}
            </span>
            <span>{showConsultations ? "收起" : "展开"}</span>
          </button>
          {showConsultations && (
            <div id={detailsId} className="consultation-list">
              {entry.consultations.map((consultation) => (
                <div className="consultation-item" key={consultation.agentId}>
                  <span className="consultation-role">
                    {consultation.role}
                  </span>
                  <CollapsibleText text={consultation.text} lines={2} />
                </div>
              ))}
            </div>
          )}
          {!showConsultations && (
            <div className="consultation-chips">
              {entry.consultations.map((consultation) => (
                <span key={consultation.agentId} className="consultation-chip">
                  {consultation.role}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {entry.captainText && (
        <div className="decision-response">
          <CollapsibleText
            label="舰长决策"
            text={entry.captainText}
            lines={3}
          />
        </div>
      )}

      {entry.toolCalls.length > 0 && (
        <div className="decision-tools">
          <span className="decision-section-label">
            工具与回执 · {entry.toolCalls.length}
          </span>
          <div className="tool-call-list">
            {entry.toolCalls.map((toolCall) => {
              const receipt = entry.receipts.find(
                (r) => r.toolCallId === toolCall.toolCallId,
              );
              return (
                <div className="tool-call-item" key={toolCall.toolCallId}>
                  <code>{toolCall.toolName}</code>
                  {receipt && (
                    <span className={`tool-receipt receipt-${receipt.status}`}>
                      {receipt.status === "accepted"
                        ? "接受"
                        : receipt.status === "rejected"
                          ? "拒绝"
                          : receipt.status === "invalid"
                            ? "无效"
                            : receipt.status === "skipped"
                              ? "跳过"
                              : "限制"}
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

function CallObservationRow({ call }: { call: LlmObservationCall }) {
  const [expanded, setExpanded] = useState(false);
  const rosterName = agentDisplayName(call.agentId);
  const summary =
    call.outcome === "ok"
      ? call.responseSummary || "（无文本，仅工具）"
      : call.errorSummary || "调用失败";

  return (
    <article className={`obs-call outcome-${call.outcome}`}>
      <div className="obs-call-meta">
        <span className={`obs-outcome outcome-${call.outcome}`}>
          {call.outcome === "ok"
            ? "成功"
            : call.outcome === "aborted"
              ? "中止"
              : "失败"}
        </span>
        <strong>{rosterName}</strong>
        <span className="obs-intent">
          {call.metadataIntent ?? call.agentId}
        </span>
        <span className="obs-attempts">×{call.attempts}</span>
        {call.usage && (
          <span className="obs-tokens">
            {call.usage.totalTokens.toLocaleString("zh-CN")} tok
          </span>
        )}
      </div>
      <p className={`obs-summary${expanded ? " is-expanded" : ""}`}>
        {summary}
      </p>
      {(call.toolNames?.length ?? 0) > 0 && (
        <div className="obs-tools">
          {call.toolNames!.map((name) => (
            <code key={name}>{name}</code>
          ))}
        </div>
      )}
      <button
        type="button"
        className="ai-expand-btn"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "收起提示摘要" : "查看提示摘要"}
      </button>
      {expanded && (
        <pre className="obs-prompt">{call.promptSummary || "（空）"}</pre>
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
  const [logTab, setLogTab] = useState<"decisions" | "calls">("decisions");
  const recentCalls = status?.recentCalls ?? [];
  const configuredDepartmentCount =
    status?.agents.filter(
      (agent) =>
        AI_ROSTER.some((department) => department.id === agent.id) &&
        agent.state !== "missing-secret",
    ).length ?? 0;
  const readyCount =
    status?.agents.filter((agent) => agent.state === "ready").length ?? 0;
  const retryingCount =
    status?.agents.filter((agent) => agent.state === "retrying").length ?? 0;
  const missingCount =
    status?.agents.filter((agent) => agent.state === "missing-secret")
      .length ?? 0;

  return (
    <section className="view-grid ai-view" aria-label="固定多模型观察">
      <div className="panel ai-roster-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">FIXED INTELLIGENCE / 固定拓扑</span>
            <h2>舰载智能组织</h2>
          </div>
          <StatusPill tone={status?.ready ? "nominal" : "watch"}>
            就绪 {readyCount}/{status?.agents.length ?? 0}
          </StatusPill>
        </div>

        <div className="ai-health-strip" aria-label="端点健康摘要">
          <div>
            <span>就绪</span>
            <strong className="metric-ok">{readyCount}</strong>
          </div>
          <div>
            <span>重试</span>
            <strong className={retryingCount > 0 ? "metric-watch" : undefined}>
              {retryingCount}
            </strong>
          </div>
          <div>
            <span>缺密钥</span>
            <strong className={missingCount > 0 ? "metric-bad" : undefined}>
              {missingCount}
            </strong>
          </div>
          <div>
            <span>部门配置</span>
            <strong>{configuredDepartmentCount}/8</strong>
          </div>
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
            const tone =
              runtime?.state === "ready"
                ? "nominal"
                : runtime?.state === "retrying"
                  ? "watch"
                  : runtime?.state === "missing-secret"
                    ? "critical"
                    : "watch";
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
                  <StatusPill tone={tone}>
                    {runtime?.state === "ready"
                      ? "READY"
                      : runtime?.state === "retrying"
                        ? "RETRY"
                        : runtime?.state === "missing-secret"
                          ? "SECRET"
                          : "CHECK"}
                  </StatusPill>
                  <span>{agent.model}</span>
                  <small>
                    周期{" "}
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
            <span className="eyebrow">OBSERVABILITY / 可观察日志</span>
            <h2>决策与 API 观察</h2>
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

        <div className="ai-log-tabs" role="tablist" aria-label="观察日志切换">
          <button
            type="button"
            role="tab"
            aria-selected={logTab === "decisions"}
            className={`ai-log-tab${logTab === "decisions" ? " active" : ""}`}
            onClick={() => setLogTab("decisions")}
          >
            舰长决策
            <em>{decisionLog.length}</em>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={logTab === "calls"}
            className={`ai-log-tab${logTab === "calls" ? " active" : ""}`}
            onClick={() => setLogTab("calls")}
          >
            API 调用
            <em>{recentCalls.length}</em>
          </button>
        </div>

        {logTab === "decisions" ? (
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
        ) : (
          <div className="obs-call-stream">
            {recentCalls.length === 0 ? (
              <div className="decision-empty">
                <p>尚无 API 调用观察记录。</p>
                <p>成功或失败的网关调用会以脱敏摘要显示在此。</p>
              </div>
            ) : (
              recentCalls.map((call) => (
                <CallObservationRow key={call.callId} call={call} />
              ))
            )}
          </div>
        )}

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
            <span>命令 Revision</span>
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
