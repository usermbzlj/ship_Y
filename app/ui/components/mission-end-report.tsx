"use client";

import type { ShipState } from "@/lib/sim";
import type { FinalJourneyReport } from "@/lib/sim/protocol";
import { formatDuration } from "@/app/ui/utils";

export type MissionEndReportProps = {
  simulationSeconds: number;
  finalReport: FinalJourneyReport | null;
  engineState: ShipState | null;
  onSave: () => void;
  onDismiss: () => void;
};

/**
 * 航程安全抵达后的结束报告覆盖层。
 */
export function MissionEndReport({
  simulationSeconds,
  finalReport,
  engineState,
  onSave,
  onDismiss,
}: MissionEndReportProps) {
  return (
    <div
      className="end-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-report-title"
    >
      <section className="end-report" aria-label="航程结束报告">
        <div className="end-report-heading">
          <span className="end-seal">ARRIVAL</span>
          <div>
            <span className="eyebrow">
              MISSION COMPLETE / 人类接管边界
            </span>
            <h2 id="end-report-title">目标安全区已确认</h2>
            <p>
              最后一段跃迁完成，远穹号具备移交后续驾驶的基本条件。
              按最高指令，本次游戏航程在此结束。
            </p>
          </div>
        </div>

        <div className="end-metrics">
          <div>
            <span>实际航程</span>
            <strong>{formatDuration(simulationSeconds)}</strong>
          </div>
          <div>
            <span>完成跃迁</span>
            <strong>
              {finalReport?.jumpsCompleted ??
                engineState?.journey.jumpsCompleted ??
                0}
            </strong>
          </div>
          <div>
            <span>幸存乘员</span>
            <strong>
              {(finalReport?.survivors ?? 2_120).toLocaleString("zh-CN")}
            </strong>
          </div>
          <div>
            <span>个人评价</span>
            <strong>
              {(finalReport?.evaluationCount ?? 2_120).toLocaleString("zh-CN")}
            </strong>
          </div>
        </div>

        <div className="end-evaluations">
          <div className="end-section-title">
            <span className="eyebrow">
              SUBJECTIVE EXPERIENCE / 无统一评分
            </span>
            <h3>代表性乘坐体验</h3>
          </div>
          {finalReport ? (
            <div className="evaluation-list">
              {finalReport.representativeEvaluations.map((evaluation) => (
                <article key={evaluation.passengerId}>
                  <div>
                    <strong>{evaluation.passengerName}</strong>
                    <span>{evaluation.passengerId}</span>
                  </div>
                  <p>{evaluation.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="report-loading">
              正在从 2,120 份独立经历生成主观叙述……
            </div>
          )}
        </div>

        <div className="end-actions">
          <button type="button" onClick={onSave}>
            保存最终航程
          </button>
          <button type="button" onClick={onDismiss}>
            返回只读控制台
          </button>
        </div>
      </section>
    </div>
  );
}
