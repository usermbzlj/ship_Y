import {
  assertTrustedLocalRequest,
  handleLlmRoute,
  invokePublicLlm,
  jsonResponse,
  readStrictJsonBody,
} from "../_server";

export async function POST(request: Request): Promise<Response> {
  return handleLlmRoute(request, "llm.invoke", async ({ requestId }) => {
    assertTrustedLocalRequest(request);
    const input = await readStrictJsonBody(request);
    const result = await invokePublicLlm(input, request.signal, { requestId });
    return jsonResponse({ result });
  });
}
