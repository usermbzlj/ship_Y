"use client";

import type { LlmRuntimeStatus } from "../types";
import { AI_ROSTER } from "../constants";

/**
 * 固定多 LLM 拓扑组织图 — SVG 可视化 8 部门 + 32 关键乘客网络。
 * 实时显示每个节点状态（idle/thinking/waiting/retrying）。
 */

type NodeState = "ready" | "retrying" | "missing-secret" | "checking" | "thinking";

interface TopologyNode {
  id: string;
  label: string;
  name: string;
  x: number;
  y: number;
  state: NodeState;
  isCaptain?: boolean;
}

const STATE_COLORS: Record<NodeState, string> = {
  ready: "#73af96",
  retrying: "#e6ad48",
  "missing-secret": "#d26053",
  checking: "#68787b",
  thinking: "#96c0bd",
};

export function TopologyGraph({
  status,
  callPhase,
}: {
  status: LlmRuntimeStatus | null;
  callPhase: "idle" | "waiting" | "error";
}) {
  const captainState: NodeState =
    callPhase === "waiting"
      ? "thinking"
      : status?.agents.find((a) => a.id === "captain")?.state ?? "checking";

  const nodes: TopologyNode[] = [
    // 舰长居中
    {
      id: "captain",
      label: "舰长",
      name: "乾枢",
      x: 200,
      y: 140,
      state: captainState,
      isCaptain: true,
    },
    // 部门环绕
    ...AI_ROSTER.filter((a) => a.id !== "captain").map((agent, index) => {
      const angle = (index / 7) * Math.PI * 2 - Math.PI / 2;
      const radius = 105;
      const runtime = status?.agents.find((a) => a.id === agent.id);
      return {
        id: agent.id,
        label: agent.role,
        name: agent.name,
        x: 200 + Math.cos(angle) * radius,
        y: 140 + Math.sin(angle) * radius * 0.75,
        state: (runtime?.state ?? "checking") as NodeState,
      };
    }),
  ];

  return (
    <div className="topology-graph-container">
      <svg
        viewBox="0 0 400 280"
        className="topology-svg"
        aria-label="固定多 LLM 组织拓扑图"
      >
        {/* 通信边 */}
        {nodes
          .filter((n) => !n.isCaptain)
          .map((node) => (
            <line
              key={`edge-${node.id}`}
              x1={200}
              y1={140}
              x2={node.x}
              y2={node.y}
              className={`topology-edge edge-${node.state}`}
              strokeWidth={node.state === "thinking" ? 1.5 : 0.5}
            />
          ))}

        {/* 关键乘客环 */}
        <ellipse
          cx={200}
          cy={140}
          rx={170}
          ry={120}
          className="topology-passenger-ring"
          fill="none"
          strokeDasharray="3 6"
        />
        <text x={200} y={268} className="topology-ring-label" textAnchor="middle">
          32 关键乘客 LLM
        </text>

        {/* 节点 */}
        {nodes.map((node) => (
          <g key={node.id} className="topology-node-group">
            <circle
              cx={node.x}
              cy={node.y}
              r={node.isCaptain ? 14 : 9}
              fill={STATE_COLORS[node.state]}
              fillOpacity={0.15}
              stroke={STATE_COLORS[node.state]}
              strokeWidth={node.isCaptain ? 2 : 1}
              className={node.state === "thinking" ? "node-thinking" : ""}
            />
            {node.state === "thinking" && (
              <circle
                cx={node.x}
                cy={node.y}
                r={node.isCaptain ? 18 : 13}
                fill="none"
                stroke={STATE_COLORS.thinking}
                strokeWidth={0.5}
                strokeOpacity={0.5}
                className="node-pulse"
              />
            )}
            <text
              x={node.x}
              y={node.y + (node.isCaptain ? 26 : 20)}
              textAnchor="middle"
              className="topology-node-label"
            >
              {node.name}
            </text>
            <text
              x={node.x}
              y={node.y + (node.isCaptain ? 36 : 30)}
              textAnchor="middle"
              className="topology-node-role"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="topology-legend">
        {Object.entries(STATE_COLORS).map(([state, color]) => (
          <span key={state} className="legend-item">
            <i style={{ background: color }} />
            {state === "ready"
              ? "就绪"
              : state === "thinking"
                ? "思考中"
                : state === "retrying"
                  ? "重试"
                  : state === "missing-secret"
                    ? "缺密钥"
                    : "检测中"}
          </span>
        ))}
      </div>
    </div>
  );
}
