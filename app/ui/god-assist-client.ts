import type { GodAssistPlan } from "@/lib/llm/god-assist";

export type GodAssistInvokeResult = {
  text: string;
  plan: GodAssistPlan;
  agentId: string;
};

type GodAssistInvokePayload = {
  result?: GodAssistInvokeResult & {
    toolCalls?: unknown[];
    usage?: unknown;
  };
  error?: { message?: string };
};

export async function invokeGodAssist(input: {
  message: string;
  worldContext?: Record<string, unknown>;
  previousRejection?: string;
  signal?: AbortSignal;
}): Promise<GodAssistInvokeResult> {
  const response = await fetch("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: input.signal,
    body: JSON.stringify({
      intent: "god-assist",
      messages: [{ role: "user", content: input.message }],
      ...(input.worldContext ? { worldContext: input.worldContext } : {}),
      ...(input.previousRejection
        ? { previousRejection: input.previousRejection }
        : {}),
    }),
  });
  const payload = (await response.json()) as GodAssistInvokePayload;
  if (!response.ok || !payload.result?.plan) {
    throw new Error(
      payload.error?.message ?? `上帝助手请求失败 HTTP ${response.status}`,
    );
  }
  return {
    text: payload.result.text,
    plan: payload.result.plan,
    agentId: payload.result.agentId,
  };
}
