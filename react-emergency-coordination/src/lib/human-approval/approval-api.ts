import { NextResponse } from "next/server";
import { z } from "zod";
import {
  approvePlan,
  canExecuteApprovedPlan,
  modifyPlan,
  rejectPlan,
  submitPlanForApproval,
  type DecisionMetadata,
  type PlanApprovalErrorCode,
} from "./plan-approval";
import { ResponsePlanSchema } from "../../domain/response-plan/schema";
import {
  createUnavailableEmergencyStateProvider,
  EmergencyStateProviderError,
  type EmergencyStateProvider,
} from "../emergency-state/provider";

const decisionInputSchema = z
  .object({
    id: z.string().trim().min(1),
    incidentId: z.string().trim().min(1),
    coordinatorId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    decidedAt: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
  })
  .strict();

const modifyInputSchema = decisionInputSchema.extend({
  modifiedPlan: ResponsePlanSchema,
});

type RouteContext = { params: Promise<{ planId: string }> };
type SuccessBody = { success: true; data: Record<string, unknown> };
type ErrorBody = {
  success: false;
  error: { code: string; message: string };
};

function response(body: SuccessBody | ErrorBody, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
): NextResponse<ErrorBody> {
  return NextResponse.json<ErrorBody>(
    { success: false, error: { code, message } },
    { status },
  );
}

function domainStatus(code: PlanApprovalErrorCode): number {
  if (
    code === "PLAN_STALE" ||
    code === "APPROVAL_NOT_ALLOWED" ||
    code === "PLAN_NOT_PENDING_APPROVAL" ||
    code === "MODIFICATION_NOT_ALLOWED" ||
    code === "SUBMISSION_NOT_ALLOWED"
  ) {
    return 409;
  }
  return 400;
}

async function readJson(request: Request): Promise<unknown | NextResponse> {
  try {
    return await request.json();
  } catch {
    return errorResponse("MALFORMED_JSON", "Request body must be valid JSON.", 400);
  }
}

async function loadPlan(
  provider: EmergencyStateProvider,
  planId: string,
): Promise<
  | { plan: NonNullable<Awaited<ReturnType<EmergencyStateProvider["getPlan"]>>> }
  | NextResponse
> {
  if (planId.trim().length === 0) {
    return errorResponse("INVALID_PLAN_ID", "Plan id is required.", 400);
  }

  try {
    const plan = await provider.getPlan(planId);
    if (plan === null) {
      return errorResponse("PLAN_NOT_FOUND", "Response plan was not found.", 404);
    }
    return { plan };
  } catch (error) {
    if (error instanceof EmergencyStateProviderError) {
      return errorResponse("STATE_PROVIDER_UNAVAILABLE", error.message, 503);
    }
    return errorResponse("INTERNAL_ERROR", "Unable to load response plan.", 500);
  }
}

async function loadState(
  provider: EmergencyStateProvider,
  plan: NonNullable<Awaited<ReturnType<EmergencyStateProvider["getPlan"]>>>,
): Promise<
  | { state: NonNullable<Awaited<ReturnType<EmergencyStateProvider["getStateForPlan"]>>> }
  | NextResponse
> {
  try {
    const state = await provider.getStateForPlan(plan);
    if (state === null) {
      return errorResponse("STATE_NOT_FOUND", "Emergency state was not found.", 404);
    }
    return { state };
  } catch (error) {
    if (error instanceof EmergencyStateProviderError) {
      return errorResponse("STATE_PROVIDER_UNAVAILABLE", error.message, 503);
    }
    return errorResponse("INTERNAL_ERROR", "Unable to load emergency state.", 500);
  }
}

function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

function serializeResult(
  result: ReturnType<typeof submitPlanForApproval>,
  status = 200,
): NextResponse {
  if (!result.success) {
    return errorResponse(result.error.code, result.error.message, domainStatus(result.error.code));
  }
  return response(
    {
      success: true,
      data: { plan: result.plan, ...(result.decision ? { decision: result.decision } : {}) },
    },
    status,
  );
}

function metadata(input: z.infer<typeof decisionInputSchema>, state: Awaited<ReturnType<EmergencyStateProvider["getStateForPlan"]>>): DecisionMetadata {
  return {
    ...input,
    currentState: state ?? undefined,
  };
}

export function createPlanApprovalHandlers(
  provider: EmergencyStateProvider = createUnavailableEmergencyStateProvider(),
) {
  return {
    async submit(request: Request, context: RouteContext): Promise<NextResponse> {
      const { planId } = await context.params;
      const loaded = await loadPlan(provider, planId);
      if (isResponse(loaded)) return loaded;
      return serializeResult(submitPlanForApproval(loaded.plan));
    },

    async approve(request: Request, context: RouteContext): Promise<NextResponse> {
      const { planId } = await context.params;
      const loaded = await loadPlan(provider, planId);
      if (isResponse(loaded)) return loaded;
      const state = await loadState(provider, loaded.plan);
      if (isResponse(state)) return state;
      const body = await readJson(request);
      if (isResponse(body)) return body;
      const parsed = decisionInputSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse("INVALID_REQUEST", "Approval request is invalid.", 400);
      }
      return serializeResult(
        approvePlan(loaded.plan, metadata(parsed.data, state.state)),
        201,
      );
    },

    async reject(request: Request, context: RouteContext): Promise<NextResponse> {
      const { planId } = await context.params;
      const loaded = await loadPlan(provider, planId);
      if (isResponse(loaded)) return loaded;
      const state = await loadState(provider, loaded.plan);
      if (isResponse(state)) return state;
      const body = await readJson(request);
      if (isResponse(body)) return body;
      const parsed = decisionInputSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse("INVALID_REQUEST", "Rejection request is invalid.", 400);
      }
      return serializeResult(
        rejectPlan(loaded.plan, metadata(parsed.data, state.state)),
        201,
      );
    },

    async modify(request: Request, context: RouteContext): Promise<NextResponse> {
      const { planId } = await context.params;
      const loaded = await loadPlan(provider, planId);
      if (isResponse(loaded)) return loaded;
      const state = await loadState(provider, loaded.plan);
      if (isResponse(state)) return state;
      const body = await readJson(request);
      if (isResponse(body)) return body;
      const parsed = modifyInputSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse("INVALID_REQUEST", "Modification request is invalid.", 400);
      }
      return serializeResult(
        modifyPlan(
          loaded.plan,
          parsed.data.modifiedPlan,
          metadata(parsed.data, state.state),
        ),
        201,
      );
    },

    async approvalStatus(
      request: Request,
      context: RouteContext,
    ): Promise<NextResponse> {
      const { planId } = await context.params;
      const loaded = await loadPlan(provider, planId);
      if (isResponse(loaded)) return loaded;
      const state = await loadState(provider, loaded.plan);
      if (isResponse(state)) return state;
      const stale = loaded.plan.stateVersion !== state.state.stateVersion;
      const invalid = !ResponsePlanSchema.safeParse(loaded.plan).success;
      const executable =
        !stale &&
        !invalid &&
        canExecuteApprovedPlan(loaded.plan, {
          currentState:
            state.state.stateVersion === loaded.plan.stateVersion
              ? state.state
              : undefined,
        });
      return response({
        success: true,
        data: {
          plan: loaded.plan,
          status: invalid ? "invalid" : stale ? "stale" : loaded.plan.status.toLowerCase(),
          stale,
          invalid,
          executable,
        },
      }, 200);
    },
  };
}
