import { NextResponse } from "next/server";
import { z } from "zod";
import {
  executeAndPersistApprovedPlan,
  SimulationPersistenceError,
} from "../../../../../../lib/simulation/persistence";

const inputSchema = z
  .object({ expectedStateVersion: z.number().int().positive().optional() })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  const { planId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "MALFORMED_JSON", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_REQUEST", message: "Execution request is invalid." } },
      { status: 400 },
    );
  }
  try {
    const result = await executeAndPersistApprovedPlan(
      planId,
      parsed.data.expectedStateVersion,
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof SimulationPersistenceError) {
      const status =
        error.code === "PLAN_NOT_FOUND" ||
              error.code === "INCIDENT_NOT_FOUND" ||
              error.code === "STATE_NOT_FOUND"
            ? 404
            : error.code === "DATABASE_UNAVAILABLE" ||
                error.code === "DATABASE_ERROR" ||
                error.code === "PERSISTENCE_FAILED"
              ? 503
            : error.code === "STATE_VERSION_CONFLICT" ||
                error.code === "PLAN_TRANSITION_CONFLICT"
              ? 409
              : error.code === "STATE_INVALID"
                ? 422
            : error.code === "SIMULATION_FAILED"
              ? 422
              : 503;
      const partialWrites =
        error.completedWrites.length === 0
          ? ""
          : ` Partial writes completed: ${error.completedWrites.join(", ")}.`;
      return NextResponse.json(
        {
          success: false,
          error: { code: error.code, message: `${error.message}${partialWrites}` },
        },
        { status },
      );
    }
    return NextResponse.json(
      { success: false, error: { code: "DATABASE_ERROR", message: "Simulation persistence failed." } },
      { status: 503 },
    );
  }
}
