"use client";

import { useCallback, useRef, useState } from "react";
import type { GodAssistPlan, GodAssistPlanStep } from "@/lib/llm/god-assist";
import { FORCE_FIELDS } from "../constants";
import type { ForceField, GodAssistSessionHandle } from "../types";
import { invokeGodAssist } from "../god-assist-client";

type PanelPhase = "idle" | "loading" | "review" | "executing" | "retrying";

function describeStep(step: GodAssistPlanStep): string {
  if (step.kind === "causal-event") {
    return `因果 · ${step.label} (${step.eventType})`;
  }
  const field =
    FORCE_FIELDS.find((item) => item.id === step.fieldId)?.label ??
    step.fieldId;
  return `覆写 · ${step.label} → ${step.value} (${field})`;
}

function executePlanStep(
  step: GodAssistPlanStep,
  onCausalEvent: (eventType: string, label: string) => void,
  onOverride: (field: ForceField, value: number) => void,
) {
  if (step.kind === "causal-event") {
    onCausalEvent(step.eventType, step.label);
    return;
  }
  const field = FORCE_FIELDS.find((item) => item.id === step.fieldId);
  if (!field) {
    throw new Error(`未知原力字段：${step.fieldId}`);
  }
  onOverride(field, step.value);
}

export function GodAssistPanel({
  missionReady,
  worldContext,
  onCausalEvent,
  onOverride,
  onSessionChange,
}: {
  missionReady: boolean;
  worldContext?: Record<string, unknown>;
  onCausalEvent: (eventType: string, label: string) => void;
  onOverride: (field: ForceField, value: number) => void;
  onSessionChange: (session: GodAssistSessionHandle | null) => void;
}) {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<PanelPhase>("idle");
  const [plan, setPlan] = useState<GodAssistPlan | null>(null);
  const [assistantText, setAssistantText] = useState("");
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retriedRef = useRef(false);
  const sessionTimerRef = useRef<number | null>(null);

  const clearSessionTimer = useCallback(() => {
    if (sessionTimerRef.current !== null) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
  }, []);

  const endSession = useCallback(() => {
    clearSessionTimer();
    onSessionChange(null);
  }, [clearSessionTimer, onSessionChange]);

  const requestPlan = useCallback(
    async (message: string, previousRejection?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setPhase(previousRejection ? "retrying" : "loading");
      try {
        const result = await invokeGodAssist({
          message,
          worldContext,
          previousRejection,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        setPlan(result.plan);
        setAssistantText(result.text);
        setLastUserMessage(message);
        setPhase("review");
      } catch (cause) {
        if (controller.signal.aborted) {
          return;
        }
        setError(
          cause instanceof Error ? cause.message : "上帝助手请求失败",
        );
        setPhase("idle");
      }
    },
    [worldContext],
  );

  const retryAfterRejection = useCallback(
    (rejectionMessage: string, originalMessage: string) => {
      if (retriedRef.current) {
        return;
      }
      retriedRef.current = true;
      void requestPlan(originalMessage, rejectionMessage);
    },
    [requestPlan],
  );

  const registerExecutionSession = useCallback(
    (userMessage: string) => {
      retriedRef.current = false;
      clearSessionTimer();
      onSessionChange({
        active: true,
        retried: false,
        onPhysicsRejection: (message) => {
          endSession();
          retryAfterRejection(message, userMessage);
        },
      });
      sessionTimerRef.current = window.setTimeout(() => {
        endSession();
      }, 4_000);
    },
    [clearSessionTimer, endSession, onSessionChange, retryAfterRejection],
  );

  const handleSubmit = () => {
    const message = input.trim();
    if (!message || phase === "loading" || phase === "retrying") {
      return;
    }
    if (!missionReady) {
      setError("必须先签发最高指令，才能请求上帝干预计划。");
      return;
    }
    setPlan(null);
    setAssistantText("");
    void requestPlan(message);
  };

  const handleConfirm = () => {
    if (!plan) {
      return;
    }
    setPhase("executing");
    registerExecutionSession(lastUserMessage);
    try {
      for (const step of plan.steps) {
        executePlanStep(step, onCausalEvent, onOverride);
      }
      setPlan(null);
      setInput("");
      setPhase("idle");
    } catch (cause) {
      endSession();
      setError(
        cause instanceof Error ? cause.message : "干预计划执行失败",
      );
      setPhase("idle");
    }
  };

  const handleCancelPlan = () => {
    abortRef.current?.abort();
    setPlan(null);
    setAssistantText("");
    setPhase("idle");
    setError(null);
  };

  const busy = phase === "loading" || phase === "retrying" || phase === "executing";

  return (
    <div className="panel god-assist-panel">
      <div className="panel-heading compact">
        <div>
          <span className="eyebrow">NATURAL LANGUAGE / 自然语言</span>
          <h2>上帝助手</h2>
        </div>
        <span className="god-assist-status">
          {phase === "loading"
            ? "编译中"
            : phase === "retrying"
              ? "修订中"
              : phase === "executing"
                ? "执行中"
                : plan
                  ? "待确认"
                  : "待命"}
        </span>
      </div>

      <p className="god-assist-intro">
        用自然语言描述干预意图。助手将编译为因果事件或原力覆写计划，经你确认后写入物理账本。
      </p>

      {assistantText && (
        <div className="god-assist-reply">
          <span>助手说明</span>
          <p>{assistantText}</p>
        </div>
      )}

      {plan && (
        <div className="god-assist-plan" role="region" aria-label="干预计划预览">
          <div className="god-assist-plan-heading">
            <strong>{plan.summary}</strong>
            <small>{plan.steps.length} 步</small>
          </div>
          <ol className="god-assist-steps">
            {plan.steps.map((step, index) => (
              <li key={`${step.kind}-${index}`}>{describeStep(step)}</li>
            ))}
          </ol>
          <div className="god-assist-plan-actions">
            <button type="button" onClick={handleCancelPlan} disabled={busy}>
              放弃
            </button>
            <button type="button" onClick={handleConfirm} disabled={busy}>
              确认执行
            </button>
          </div>
        </div>
      )}

      {phase === "retrying" && (
        <p className="god-assist-hint">
          物理引擎拒收了上一份计划，正在根据拒收原因自动修订（仅重试一次）…
        </p>
      )}

      {error && <p className="god-assist-error">{error}</p>}

      <div className="god-assist-compose">
        <label>
          干预意图
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="例：让冷却泵卡死，并把冷却母线温度提到 350 K"
            rows={3}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="god-assist-submit"
          onClick={handleSubmit}
          disabled={busy || input.trim().length === 0}
        >
          {phase === "loading" ? "编译计划…" : "请求计划"}
        </button>
      </div>
    </div>
  );
}
