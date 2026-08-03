"use client";

export type LoadConfirmSource = "manual" | "auto";

export type LoadConfirmDialogProps = {
  hasManual: boolean;
  hasLatestAuto: boolean;
  latestAutoLabel?: string | null;
  onCancel: () => void;
  onConfirm: (source: LoadConfirmSource) => void;
};

/**
 * 读取本机存档前的覆盖确认对话框。
 * 最小选择：手动槽 +（若有）最近自动存档。
 */
export function LoadConfirmDialog({
  hasManual,
  hasLatestAuto,
  latestAutoLabel,
  onCancel,
  onConfirm,
}: LoadConfirmDialogProps) {
  const canManual = hasManual;
  const canAuto = hasLatestAuto;

  return (
    <div
      className="launch-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="load-confirm-title"
    >
      <div className="launch-card">
        <div className="launch-card-heading">
          <span className="launch-number">↺</span>
          <div>
            <span className="eyebrow">LOCAL SAVE / 本地存档</span>
            <h2 id="load-confirm-title">读取本地存档</h2>
            <p>
              将覆盖当前会话中的航程进度、事件与 AI 状态。此操作不可撤销。
            </p>
          </div>
        </div>
        <div className="end-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          {canAuto && (
            <button type="button" onClick={() => onConfirm("auto")}>
              {latestAutoLabel
                ? `读取自动存档（${latestAutoLabel}）`
                : "读取自动存档"}
            </button>
          )}
          {canManual && (
            <button type="button" onClick={() => onConfirm("manual")}>
              确认读取手动存档
            </button>
          )}
          {!canManual && !canAuto && (
            <button type="button" disabled>
              无可用存档
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
