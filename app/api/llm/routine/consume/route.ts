import {
  assertTrustedLocalRequest,
  getLlmServerRuntime,
  handleLlmRoute,
  jsonResponse,
  readStrictJsonBody,
} from "../../_server";

export async function POST(request: Request): Promise<Response> {
  return handleLlmRoute(request, "llm.routine.consume", async () => {
    assertTrustedLocalRequest(request);
    const input = await readStrictJsonBody(request);
    const routineChange =
      getLlmServerRuntime().consumeRoutineTicket(input);
    return jsonResponse({ routineChange });
  });
}
