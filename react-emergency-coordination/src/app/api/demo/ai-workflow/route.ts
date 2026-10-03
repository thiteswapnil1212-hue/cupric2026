import { NextResponse } from "next/server";
import { z } from "zod";
import { EmergencyStateSchema } from "../../../../domain/emergency-state/schema";
import { runAutoAiWorkflow } from "../../../../lib/agents/auto-ai-workflow";
import { AutoAiWorkflowResultSchema } from "../../../../lib/agents/auto-ai-workflow-contract";
import { DeterministicFallbackError } from "../../../../lib/agents/deterministic-fallback";

const requestSchema = z
  .object({
    planId: z.string().regex(/^PLAN-[0-9]{3,}$/),
    state: EmergencyStateSchema,
  })
  .strict();

const MAX_REQUEST_BYTES = 256 * 1024;

class RequestBodyTooLargeError extends Error {}

async function readLimitedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new SyntaxError("Expected a JSON request.");
  }
  if (request.body === null) throw new SyntaxError("Missing request body.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  // Demo-only boundary: this endpoint is payload-limited, but intentionally has no authentication or rate limiting.
  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { code: "REQUEST_TOO_LARGE", message: "Workflow request exceeds the demo limit." },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "Workflow request is invalid." },
      { status: 400 },
    );
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "Workflow request is invalid." },
      { status: 400 },
    );
  }
  try {
    const result = await runAutoAiWorkflow(parsed.data.state, parsed.data.planId);
    const validated = AutoAiWorkflowResultSchema.safeParse(result);
    if (!validated.success) {
      return NextResponse.json(
        {
          code: "AI_WORKFLOW_INVALID",
          message: "Workflow did not produce a valid response.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(validated.data);
  } catch (error) {
    if (error instanceof DeterministicFallbackError) {
      return NextResponse.json(
        {
          code: error.code,
          message:
            "No safe validated plan could be produced. No plan was advanced.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        code: "AI_WORKFLOW_FAILED",
        message: "AI workflow failed safely. No plan was advanced.",
      },
      { status: 500 },
    );
  }
}
