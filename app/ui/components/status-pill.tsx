"use client";

import type { ReactNode } from "react";
import type { SystemTone } from "../types";

export function StatusPill({
  tone,
  children,
}: {
  tone: SystemTone;
  children: ReactNode;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}
