import { createPlanApprovalHandlers } from "../../../../../../lib/human-approval/approval-api";

const handlers = createPlanApprovalHandlers();

export async function GET(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  return handlers.approvalStatus(request, context);
}
