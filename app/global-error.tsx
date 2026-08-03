"use client";

import { useEffect } from "react";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("react-global-boundary");

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    log.error("react.global-error", {
      error,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "grid",
          placeItems: "center",
          padding: 24,
          color: "#edf7f8",
          background: "#071014",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ width: "min(620px, 100%)" }} role="alert">
          <p style={{ color: "#e96758", letterSpacing: "0.12em" }}>
            MISSION CONTROL / GLOBAL FAULT
          </p>
          <h1>远穹控制台无法完成装载</h1>
          <p style={{ color: "#9eb2b8", lineHeight: 1.75 }}>
            根界面异常已写入浏览器诊断日志。请重新装载；本机存档不会因此被删除。
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 16,
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 44,
                padding: "0 18px",
                color: "#edf7f8",
                border: "1px solid #57c5d8",
                background: "#17343d",
                cursor: "pointer",
              }}
            >
              重新装载应用
            </button>
            <button
              type="button"
              onClick={() => {
                window.__FAR_HORIZON_DIAGNOSTICS__?.downloadLogs?.();
              }}
              style={{
                minHeight: 44,
                padding: "0 18px",
                color: "#edf7f8",
                border: "1px solid #57c5d8",
                background: "#17343d",
                cursor: "pointer",
              }}
            >
              下载诊断日志
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
