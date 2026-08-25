import {
  assertLoopbackRequest,
  getLlmServerRuntime,
  handleLlmRoute,
  jsonResponse,
} from "../_server";

export function GET(request: Request): Promise<Response> {
  return handleLlmRoute(request, "llm.status", () => {
    // Status echoes recent prompt/response summaries for the local AI-observation
    // view; keep it reachable only from the loopback UI, not a LAN peer.
    assertLoopbackRequest(request);
    return jsonResponse({ llm: getLlmServerRuntime().status() });
  });
}
