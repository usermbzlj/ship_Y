"use client";

import { useEffect } from "react";
import {
  clearRecentLogEntries,
  createLogger,
  getRecentLogEntries,
} from "@/lib/observability/logger";

const log = createLogger("browser-runtime");

declare global {
  interface Window {
    __FAR_HORIZON_DIAGNOSTICS__?: {
      getLogs(): ReturnType<typeof getRecentLogEntries>;
      clearLogs(): void;
      downloadLogs(): void;
    };
  }
}

function downloadLogs(): void {
  const payload = `${getRecentLogEntries()
    .map((entry) => JSON.stringify(entry))
    .join("\n")}\n`;
  const blob = new Blob([payload], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `far-horizon-browser-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.ndjson`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ClientObservability() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      log.error("browser.uncaught-error", {
        error: event.error ?? new Error(event.message),
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      log.error("browser.unhandled-rejection", { error: event.reason });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.__FAR_HORIZON_DIAGNOSTICS__ = {
      getLogs: getRecentLogEntries,
      clearLogs: clearRecentLogEntries,
      downloadLogs,
    };
    log.info("browser.observability.ready", {
      path: window.location.pathname,
      retainedEntries: getRecentLogEntries().length,
    });

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      delete window.__FAR_HORIZON_DIAGNOSTICS__;
    };
  }, []);

  return null;
}

