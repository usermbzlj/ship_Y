import {
  assertTrustedLocalRequest,
  invokePublicLlm,
  jsonResponse,
  readStrictJsonBody,
  routeErrorResponse,
} from "../_server";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const input = await readStrictJsonBody(request);
    const result = await invokePublicLlm(input, request.signal);
    return jsonResponse({ result });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
