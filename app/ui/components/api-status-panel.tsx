"use client";

import type { LlmRuntimeStatus } from "../types";
import { AI_ROSTER } from "../constants";

/**
 * API 状态面板 — 显示每个固定 LLM 端点的连接状态、重试和用量。
 */
export function ApiStatusPanel({
  status,
}: {
  status: LlmRuntimeStatus | null;
}) {
  if (!status) {
    return (
      <div className="api-status-panel">
        <div className="api-status-empty">
          正在连接本机 LLM 网关…
        </div>
      </div>
    );
  }

  return (
    <div className="api-status-panel">
      <div className="api-status-header">
        <span className="api-status-title">API GATEWAY</span>
        <span className={`api-status-ready ${status.ready ? "online" : "offline"}`}>
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
          <span>待处理票据</span>
          <strong>{status.pendingRoutineTickets}</strong>
        </div>
      </div>
    </div>
  );
}
