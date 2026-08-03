"use client";

import { useEffect } from "react";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("react-boundary");

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    log.error("react.route-error", {
      error,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="error-boundary-shell">
      <section className="error-boundary-panel" role="alert">
        <p className="eyebrow">MISSION CONTROL / FAULT</p>
        <h1>舰桥界面发生异常</h1>
        <p>
          故障详情已写入诊断日志。可以先尝试重新装载当前界面；本机存档不会因此被删除。
        </p>
        <div className="error-boundary-actions">
          <button type="button" onClick={reset}>
            重新装载界面
          </button>
          <button
            type="button"
            onClick={() => {
              window.__FAR_HORIZON_DIAGNOSTICS__?.downloadLogs?.();
            }}
          >
            下载诊断日志
          </button>
        </div>
      </section>
    </main>
  );
}
