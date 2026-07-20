import {
  assertTrustedLocalRequest,
  getLlmServerRuntime,
  jsonResponse,
  readStrictJsonBody,
  routeErrorResponse,
} from "../../_server";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const input = await readStrictJsonBody(request);
    const routineChange =
      getLlmServerRuntime().consumeRoutineTicket(input);
    return jsonResponse({ routineChange });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
