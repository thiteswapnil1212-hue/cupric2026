import { NextResponse } from "next/server";
import { z } from "zod";
import type { PlanAction } from "../../domain/plan-action/schema";
import { PlanActionSchema } from "../../domain/plan-action/schema";
import { ResponsePlanSchema } from "../../domain/response-plan/schema";
import {
  approvePlan,
  canExecuteApprovedPlan,
  modifyPlan,
  rejectPlan,
  submitPlanForApproval,
  type DecisionMetadata,
  type PlanApprovalErrorCode,
  type PlanApprovalOperationResult,
} from "./plan-approval";
import {
  createSupabaseEmergencyStateProvider,
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
  modifiedActions: z.array(PlanActionSchema).optional(),
});

type RouteContext = { params: Promise<{ planId: string }> };
type SuccessBody = { success: true; data: Record<string, unknown> };
type ErrorBody = {
  success: false;
  error: { code: string; message: string };
};
type Plan = NonNullable<Awaited<ReturnType<EmergencyStateProvider["getPlan"]>>>;
type StateContext = NonNullable<
  Awaited<ReturnType<EmergencyStateProvider["getStateForPlan"]>>
>;

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

function providerErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof EmergencyStateProviderError)) {
    return errorResponse("INTERNAL_ERROR", "Supabase operation failed.", 500);
  }
  const status =
    error.code === "PLAN_NOT_FOUND" ||
    error.code === "INCIDENT_NOT_FOUND" ||
    error.code === "STATE_NOT_FOUND"
      ? 404
      : error.code === "STATE_VERSION_CONFLICT"
        ? 409
        : error.code === "PLAN_TRANSITION_CONFLICT"
          ? 409
        : error.code === "STATE_INVALID"
          ? 422
          : 503;
  const partialWriteMessage =
    error.partialWrites.length === 0
      ? ""
      : ` Partial writes completed: ${error.partialWrites.join(", ")}.`;
  return errorResponse(error.code, `${error.message}${partialWriteMessage}`, status);
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
): Promise<{ plan: Plan } | NextResponse> {
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
    return providerErrorResponse(error);
  }
}

async function loadState(
  provider: EmergencyStateProvider,
  plan: Plan,
): Promise<{ state: StateContext } | NextResponse> {
  try {
    const state = await provider.getStateForPlan(plan);
    if (state === null) {
      return errorResponse("STATE_NOT_FOUND", "Emergency state was not found.", 404);
    }
    return { state };
  } catch (error) {
    return providerErrorResponse(error);
  }
}

function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

function serializeResult(
  result: PlanApprovalOperationResult,
  status = 200,
): NextResponse {
  if ("error" in result) {
    return errorResponse(
      result.error.code,
      result.error.message,
      domainStatus(result.error.code),
    );
  }
  return response(
    {
      success: true,
      data: {
        plan: result.plan,
        ...(result.decision ? { decision: result.decision } : {}),
      },
    },
    status,
  );
}

function metadata(
  input: z.infer<typeof decisionInputSchema>,
  state: StateContext,
): DecisionMetadata {
  return { ...input, currentState: state.state };
}

export function createPlanApprovalHandlers(
  provider: EmergencyStateProvider = createSupabaseEmergencyStateProvider(),
) {
  return {
    async submit(_request: Request, context: RouteContext): Promise<NextResponse> {
      const { planId } = await context.params;
      const loaded = await loadPlan(provider, planId);
      if (isResponse(loaded)) return loaded;
      const result = submitPlanForApproval(loaded.plan);
      if ("error" in result) return serializeResult(result);
      try {
        await provider.persistPlan(result.plan);
      } catch (error) {
        return providerErrorResponse(error);
      }
      return serializeResult(result);
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
      const result = approvePlan(
        loaded.plan,
        metadata(parsed.data, state.state),
      );
      if ("error" in result) return serializeResult(result);
      if (result.decision === undefined) {
        return errorResponse("INTERNAL_ERROR", "Approval decision was not produced.", 500);
      }
      try {
        await provider.persistDecision(loaded.plan, result.plan, result.decision);
      } catch (error) {
        return providerErrorResponse(error);
      }
      return serializeResult(result, 201);
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
      const result = rejectPlan(loaded.plan, metadata(parsed.data, state.state));
      if ("error" in result) return serializeResult(result);
      if (result.decision === undefined) {
        return errorResponse("INTERNAL_ERROR", "Rejection decision was not produced.", 500);
      }
      try {
        await provider.persistDecision(loaded.plan, result.plan, result.decision);
      } catch (error) {
        return providerErrorResponse(error);
      }
      return serializeResult(result, 201);
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
      if (parsed.data.modifiedPlan.id === loaded.plan.id) {
        return errorResponse(
          "MODIFIED_PLAN_INVALID",
          "A modified response plan must use a new plan id.",
          400,
        );
      }
      const actions: readonly PlanAction[] =
        parsed.data.modifiedActions ??
        state.state.state.planActions.filter(
          (action) => action.planId === parsed.data.modifiedPlan.id,
        );
      const modifiedState = {
        ...state.state.state,
        planActions: [
          ...state.state.state.planActions.filter(
            (action) => action.planId !== parsed.data.modifiedPlan.id,
          ),
          ...actions,
        ],
      };
      const result = modifyPlan(
        loaded.plan,
        parsed.data.modifiedPlan,
        metadata(parsed.data, { ...state.state, state: modifiedState }),
      );
      if ("error" in result) return serializeResult(result);
      if (result.decision === undefined) {
        return errorResponse("INTERNAL_ERROR", "Modification decision was not produced.", 500);
      }
      const submitted = submitPlanForApproval({
        ...result.plan,
        status: "DRAFT",
      });
      if ("error" in submitted) return serializeResult(submitted);
      try {
        await provider.persistModifiedPlan(
          loaded.plan,
          submitted.plan,
          result.decision,
          actions,
        );
      } catch (error) {
        return providerErrorResponse(error);
      }
      return serializeResult(
        {
          success: true,
          plan: submitted.plan,
          decision: result.decision,
        },
        201,
      );
    },

    async approvalStatus(
      _request: Request,
      context: RouteContext,
    ): Promise<NextResponse> {
      const { planId } = await context.params;
      const loaded = await loadPlan(provider, planId);
      if (isResponse(loaded)) return loaded;
      const state = await loadState(provider, loaded.plan);
      if (isResponse(state)) return state;
      const stale = loaded.plan.stateVersion !== state.state.state.stateVersion;
      const invalid = !ResponsePlanSchema.safeParse(loaded.plan).success;
      const executable =
        !stale &&
        !invalid &&
        canExecuteApprovedPlan(loaded.plan, {
          currentState:
            state.state.state.stateVersion === loaded.plan.stateVersion
              ? state.state.state
              : undefined,
        });
      return response(
        {
          success: true,
          data: {
            plan: loaded.plan,
            status: invalid
              ? "invalid"
              : stale
                ? "stale"
                : loaded.plan.status.toLowerCase(),
            stale,
            invalid,
            executable,
          },
        },
        200,
      );
    },
  };
}
