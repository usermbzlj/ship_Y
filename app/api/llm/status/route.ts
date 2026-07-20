import {
  getLlmServerRuntime,
  jsonResponse,
  routeErrorResponse,
} from "../_server";

export function GET(): Response {
  try {
    return jsonResponse({ llm: getLlmServerRuntime().status() });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
