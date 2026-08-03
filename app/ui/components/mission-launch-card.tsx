"use client";

import { MAX_JUMP_LEG_LY } from "@/lib/astro/star-catalog";
import type { LlmRuntimeStatus } from "@/app/ui/types";

export type MissionLaunchStarSystem = {
  id: string;
  name: string;
  port: string;
};

export type MissionLaunchCardProps = {
  origin: string;
  destination: string;
  directive: string;
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onDirectiveChange: (value: string) => void;
  starSystems: readonly MissionLaunchStarSystem[];
  missionDistanceLightYears: number;
  estimatedRouteLegs: number;
  llmStatus: LlmRuntimeStatus | null;
  hasManualSave: boolean;
  hasAutosave?: boolean;
  onStart: () => void;
  onRequestLoad: () => void;
};

/**
 * 舰桥授权台 — 任务开始前的最高指令签发对话框。
 * 纯展示 + 受控表单；编排逻辑留在 mission-control。
 */
export function MissionLaunchCard({
  origin,
  destination,
  directive,
  onOriginChange,
  onDestinationChange,
  onDirectiveChange,
  starSystems,
  missionDistanceLightYears,
  estimatedRouteLegs,
  llmStatus,
  hasManualSave,
  hasAutosave = false,
  onStart,
  onRequestLoad,
}: MissionLaunchCardProps) {
  return (
    <div
      className="launch-layer mission-launch-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-dialog-title"
    >
      <div className="launch-card mission-launch-card">
        <aside className="launch-briefing" aria-label="远穹号任务说明">
          <div className="launch-briefing-brand">
            <span className="launch-briefing-code">CIVILIAN ARK / Y-01</span>
            <strong>远穹计划</strong>
            <small>FAR HORIZON</small>
          </div>
          <div className="launch-briefing-statement">
            <span>你不亲自驾驶这艘船。</span>
            <h2>你决定它为何出发。</h2>
            <p>
              签发任务后，固定编制的 AI 舰长体系接管全舰。你将站在舰桥之外，观察每一次判断如何穿过权限、设备与物理世界。
            </p>
          </div>
          <div className="launch-briefing-specs">
            <div>
              <span>权威物理域</span>
              <strong>09</strong>
            </div>
            <div>
              <span>固定智能节点</span>
              <strong>40</strong>
            </div>
            <div>
              <span>持续个体</span>
              <strong>2,120</strong>
            </div>
          </div>
          <div className="launch-briefing-footer">
            <span>COMMAND DECK / AUTHORITY 00</span>
            <i aria-hidden="true" />
            <span>HUMAN ORIGIN</span>
          </div>
        </aside>

        <div className="launch-console">
          <div className="launch-card-heading">
            <span className="launch-number">00</span>
            <div>
              <span className="eyebrow">MISSION AUTHORITY / 人类签发</span>
              <h2 id="launch-dialog-title">建立最高指令</h2>
              <p>这是航程开始后唯一不可忽略的人类任务契约。</p>
            </div>
          </div>
          <div className="route-form">
            <label>
              出发地
              <select
                value={origin}
                onChange={(event) => onOriginChange(event.target.value)}
              >
                {starSystems.map((system) => (
                  <option value={system.id} key={system.id}>
                    {system.name} · {system.port}
                  </option>
                ))}
              </select>
            </label>
            <span className="route-arrow">→</span>
            <label>
              目的地
              <select
                value={destination}
                onChange={(event) => onDestinationChange(event.target.value)}
              >
                {starSystems.map((system) => (
                  <option value={system.id} key={system.id}>
                    {system.name} · {system.port}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="launch-route-meta">
            航路 {missionDistanceLightYears.toFixed(2)} ly · 单段跃迁上限{" "}
            {MAX_JUMP_LEG_LY} ly · 至少 {estimatedRouteLegs} 段
          </p>
          <label className="directive-field">
            最高指令
            <textarea
              value={directive}
              onChange={(event) => onDirectiveChange(event.target.value)}
              rows={4}
            />
          </label>
          <div className="launch-summary">
            <div>
              <span>载员</span>
              <strong>2,120</strong>
            </div>
            <div>
              <span>航路节点</span>
              <strong>
                {String(estimatedRouteLegs + 1).padStart(2, "0")}
              </strong>
            </div>
            <div>
              <span>压力分区</span>
              <strong>48</strong>
            </div>
            <div>
              <span>舰长权限</span>
              <strong>最高</strong>
            </div>
          </div>
          <div
            className={`llm-preflight ${llmStatus?.ready ? "ready" : "warning"}`}
          >
            <span>CAPTAIN MESH</span>
            <strong>
              {llmStatus?.ready
                ? "8 个固定部门端点已就绪"
                : "关键 AI 尚未接通；物理引擎可启动，但航程将暂停等待"}
            </strong>
            {!llmStatus?.ready && (
              <div className="llm-guidance">
                配置云端密钥后重启开发服务。DeepSeek 快捷启动：
                <code>npm run dev:deepseek</code>
                ；或复制 <code>.env.example</code> 为 <code>.env.local</code>{" "}
                填写 <code>SHIP_*_LLM_API_KEY</code>。详见 README「配置云端 LLM」。
              </div>
            )}
          </div>
          {(hasManualSave || hasAutosave) && (
            <button
              className="launch-load-button"
              onClick={onRequestLoad}
              type="button"
            >
              {hasManualSave ? "读取本机存档" : "读取自动存档"}
            </button>
          )}
          <button
            className="launch-button"
            onClick={onStart}
            type="button"
            data-testid="launch-mission"
          >
            <span>签发并移交全舰指挥权</span>
            <strong>EXECUTE DIRECTIVE</strong>
          </button>
        </div>
      </div>
    </div>
  );
}
