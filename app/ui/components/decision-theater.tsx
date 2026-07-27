"use client";

import { useEffect, useState } from "react";
import {
  DECISION_THEATER_STAGE_ORDER,
  decisionTheaterHeadline,
  decisionTheaterStageLabel,
  formatFreezeWallDuration,
  formatFrozenSimulationClock,
  isDecisionTheaterTrackStage,
  type DecisionTheaterState,
  type DecisionTheaterTrackStage,
} from "@/lib/llm/decision-theater";
import styles from "./decision-theater.module.css";

function trackReached(
  current: DecisionTheaterState["stage"],
  candidate: DecisionTheaterTrackStage,
): boolean {
  if (current === "failed" || current === "aborted") {
    return false;
  }
  if (!isDecisionTheaterTrackStage(current)) {
    return false;
  }
  return (
    DECISION_THEATER_STAGE_ORDER.indexOf(candidate) <=
    DECISION_THEATER_STAGE_ORDER.indexOf(current)
  );
}

export function DecisionTheater({
  state,
  compact = false,
}: {
  state: DecisionTheaterState;
  compact?: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!state.active || state.wallClockStartedAtMs === null) {
      return;
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.active, state.wallClockStartedAtMs, state.cycleToken]);

  if (state.stage === "idle" && !state.active) {
    return null;
  }

  const freezeClock = formatFrozenSimulationClock(
    state.freezeSimulationSeconds,
  );
  const wallDuration = formatFreezeWallDuration(
    state.wallClockStartedAtMs,
    nowMs,
  );
  const latestUtterances = state.utterances.slice(-6);
  const latestReceipts = state.receipts.slice(-6);

  return (
    <section
      className={`${styles.root}${compact ? ` ${styles.compact}` : ""}`}
      aria-label="舰长决策演出"
      aria-live="polite"
    >
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>DECISION THEATER / 决策演出</span>
          <p className={styles.headline}>{decisionTheaterHeadline(state)}</p>
        </div>
        <div className={styles.meta}>
          <span>
            冻结时刻 <strong>{freezeClock}</strong>
          </span>
          <span>
            墙钟已停 <strong>{wallDuration}</strong>
          </span>
          {state.triggerReason ? (
            <span title={state.triggerReason}>
              触发 <strong>{state.triggerReason.slice(0, 28)}</strong>
            </span>
          ) : null}
        </div>
      </div>

      <ol className={styles.track} aria-label="决策阶段轨">
        {DECISION_THEATER_STAGE_ORDER.map((stageId) => {
          const reached = trackReached(state.stage, stageId);
          const current = state.stage === stageId;
          return (
            <li
              key={stageId}
              className={`${styles.trackItem}${
                reached ? ` ${styles.trackItemReached}` : ""
              }${current ? ` ${styles.trackItemCurrent}` : ""}`}
            >
              <span className={styles.trackLabel}>
                {decisionTheaterStageLabel(stageId)}
              </span>
            </li>
          );
        })}
      </ol>

      {!compact ? (
        <div className={styles.body}>
          {state.consultationQuestion ? (
            <p className={styles.question}>
              会议议题：{state.consultationQuestion}
            </p>
          ) : null}

          {latestUtterances.length > 0 ? (
            <ol className={styles.utteranceList} aria-label="部门发言">
              {latestUtterances.map((utterance) => (
                <li
                  key={`${utterance.sequence}-${utterance.departmentId}`}
                  className={`${styles.utterance} ${styles.utteranceEnter}`}
                >
                  <div className={styles.utteranceHead}>
                    <span>
                      第 {utterance.round} 轮 ·{" "}
                      <strong>{utterance.role}</strong>
                    </span>
                    <span>#{utterance.sequence}</span>
                  </div>
                  <p className={styles.utteranceText}>{utterance.text}</p>
                </li>
              ))}
            </ol>
          ) : null}

          {state.captainText ? (
            <p className={styles.captainText}>
              舰长终裁：{state.captainText}
            </p>
          ) : null}

          {state.dispatchedOrdinal !== null ? (
            <div className={styles.dispatchNote}>
              正在下发 #{state.dispatchedOrdinal}/{state.worldCommandTotal}{" "}
              {state.dispatchedToolName}
            </div>
          ) : null}

          {latestReceipts.length > 0 ? (
            <ol className={styles.receiptList} aria-label="命令回执">
              {latestReceipts.map((receipt) => (
                <li
                  key={`${receipt.ordinal}-${receipt.toolName}`}
                  className={`${styles.receipt} ${styles.receiptEnter}`}
                >
                  <div className={styles.receiptHead}>
                    <span>
                      #{receipt.ordinal} · <strong>{receipt.toolName}</strong>
                    </span>
                    <span>{receipt.status}</span>
                  </div>
                  <p className={styles.receiptSummary}>{receipt.summary}</p>
                </li>
              ))}
            </ol>
          ) : null}

          {state.errorMessage ? (
            <p className={styles.captainText}>失败：{state.errorMessage}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
