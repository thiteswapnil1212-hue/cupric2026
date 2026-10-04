import { NextResponse } from "next/server";
import { z } from "zod";
import { EmergencyStateSchema } from "../../../../domain/emergency-state/schema";
import { WhatIfScenarioSchema } from "../../../../domain/what-if/schema";
import {
  runWhatIfSimulation,
  WhatIfSimulationError,
} from "../../../../lib/what-if/service";

const requestSchema = z
  .object({
    incidentId: z.string().trim().min(1).max(100),
    scenario: WhatIfScenarioSchema,
    baselineState: EmergencyStateSchema.optional(),
  })
  .strict();

const MAX_REQUEST_BYTES = 64 * 1024;

function redactSensitiveValues(value: string): string {
  let redacted = value;
  const sensitiveValues = Object.entries(process.env)
    .filter(
      ([name, secret]) =>
        secret !== undefined &&
        secret.length >= 8 &&
        /(KEY|SECRET|TOKEN|PASSWORD|SERVICE_ROLE|AUTH)/i.test(name),
    )
    .map(([, secret]) => secret as string)
    .sort((left, right) => right.length - left.length);
  for (const secret of sensitiveValues) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

function safeErrorDetails(error: unknown): readonly Record<string, string>[] {
  const details: Record<string, string>[] = [];
  let current: unknown = error;
  while (current instanceof Error && details.length < 4) {
    details.push({
      name: current.name,
      ...( "code" in current && typeof current.code === "string"
        ? { code: current.code }
        : {}),
      message: redactSensitiveValues(current.message),
      ...(current.stack === undefined
        ? {}
        : { stack: redactSensitiveValues(current.stack) }),
    });
    current = current.cause;
  }
  if (details.length === 0) {
    details.push({
      name: "UnknownError",
      message: redactSensitiveValues(String(error)),
    });
  }
  return details;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        {
          code: "REQUEST_TOO_LARGE",
          message: "What-If request exceeds the demo limit.",
        },
        { status: 413 },
      );
    }
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      return NextResponse.json(
        { code: "INVALID_REQUEST", message: "What-If request is invalid." },
        { status: 400 },
      );
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        {
          code: "REQUEST_TOO_LARGE",
          message: "What-If request exceeds the demo limit.",
        },
        { status: 413 },
      );
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "What-If request is invalid." },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "What-If request is invalid." },
      { status: 400 },
    );
  }

  try {
    const result = await runWhatIfSimulation(
      parsed.data.incidentId,
      parsed.data.scenario,
      { baselineState: parsed.data.baselineState },
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof WhatIfSimulationError) {
      if (error.status >= 500 && process.env.NODE_ENV !== "production") {
        console.error(
          `[what-if] request failed ${JSON.stringify(safeErrorDetails(error))}`,
        );
      }
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[what-if] request failed ${JSON.stringify(safeErrorDetails(error))}`,
      );
    }
    return NextResponse.json(
      {
        code: "WHAT_IF_FAILED",
        message:
          "What-If simulation failed safely. The active emergency response was not changed.",
      },
      { status: 503 },
    );
  }
}
