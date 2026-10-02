import { createPlanApprovalHandlers } from "../../../../../../lib/human-approval/approval-api";

const handlers = createPlanApprovalHandlers();

export async function POST(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  return handlers.submit(request, context);
}
