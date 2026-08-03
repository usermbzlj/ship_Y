import {
  getLlmServerRuntime,
  handleLlmRoute,
  jsonResponse,
} from "../_server";

export function GET(request: Request): Promise<Response> {
  return handleLlmRoute(request, "llm.status", () => {
    return jsonResponse({ llm: getLlmServerRuntime().status() });
  });
}
