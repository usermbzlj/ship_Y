"use client";

import type { LlmRuntimeStatus } from "../types";
import { AI_ROSTER } from "../constants";

function agentName(agentId: string): string {
  return AI_ROSTER.find((agent) => agent.id === agentId)?.name ?? agentId;
}

/**
 * API 状态面板 — 端点连接状态、用量，以及最近调用摘要。
 */
export function ApiStatusPanel({
  status,
}: {
  status: LlmRuntimeStatus | null;
}) {
  if (!status) {
    return (
      <div className="api-status-panel">
        <div className="api-status-empty">正在连接本机 LLM 网关…</div>
      </div>
    );
  }

  const recentCalls = status.recentCalls ?? [];

  return (
    <div className="api-status-panel">
      <div className="api-status-header">
        <span className="api-status-title">API GATEWAY</span>
        <span
          className={`api-status-ready ${status.ready ? "online" : "offline"}`}
        >
          {status.ready ? "ONLINE" : "DEGRADED"}
        </span>
      </div>

      <div className="api-agent-grid">
        {status.agents.map((agent) => {
          const roster = AI_ROSTER.find((r) => r.id === agent.id);
          const stateColor =
            agent.state === "ready"
              ? "var(--green)"
              : agent.state === "retrying"
                ? "var(--amber)"
                : "var(--red)";
          return (
            <div className="api-agent-row" key={agent.id}>
              <span
                className="api-agent-dot"
                style={{ background: stateColor }}
              />
              <span className="api-agent-name">
                {roster?.name ?? agent.id}
              </span>
              <span className="api-agent-role">
                {roster?.role ?? agent.role}
              </span>
              <span className={`api-agent-state state-${agent.state}`}>
                {agent.state === "ready"
                  ? "就绪"
                  : agent.state === "retrying"
                    ? "重试中"
                    : "缺密钥"}
              </span>
              <span className="api-agent-cadence">
                {agent.routine.systemInfoIntervalSimSeconds >= 86_400
                  ? `${agent.routine.systemInfoIntervalSimSeconds / 86_400}d`
                  : agent.routine.systemInfoIntervalSimSeconds >= 3_600
                    ? `${agent.routine.systemInfoIntervalSimSeconds / 3_600}h`
                    : `${agent.routine.systemInfoIntervalSimSeconds / 60}m`}
              </span>
            </div>
          );
        })}
      </div>

      <div className="api-usage-bar">
        <div className="api-usage-item">
          <span>输入 Token</span>
          <strong>{status.usage.inputTokens.toLocaleString("zh-CN")}</strong>
        </div>
        <div className="api-usage-item">
          <span>输出 Token</span>
          <strong>{status.usage.outputTokens.toLocaleString("zh-CN")}</strong>
        </div>
        <div className="api-usage-item">
          <span>总计</span>
          <strong>{status.usage.totalTokens.toLocaleString("zh-CN")}</strong>
        </div>
        <div className="api-usage-item">
          <span>观察调用</span>
          <strong>{recentCalls.length}</strong>
        </div>
      </div>

      {recentCalls.length > 0 && (
        <div className="api-recent-calls" aria-label="最近 API 调用">
          <div className="api-recent-header">
            <span>RECENT CALLS</span>
            <strong>最新 {Math.min(6, recentCalls.length)} 条</strong>
          </div>
          {recentCalls.slice(0, 6).map((call) => (
            <div
              className={`api-recent-row outcome-${call.outcome}`}
              key={call.callId}
            >
              <span className={`api-recent-outcome outcome-${call.outcome}`}>
                {call.outcome === "ok"
                  ? "OK"
                  : call.outcome === "aborted"
                    ? "ABT"
                    : "ERR"}
              </span>
              <span className="api-recent-agent">
                {agentName(call.agentId)}
              </span>
              <span className="api-recent-intent">
                {call.metadataIntent ?? "—"}
              </span>
              <span className="api-recent-tokens">
                {call.usage
                  ? `${call.usage.totalTokens.toLocaleString("zh-CN")}t`
                  : `×${call.attempts}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
