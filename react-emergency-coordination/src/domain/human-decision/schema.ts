import { z } from "zod";

const nonEmptyTrimmedStringSchema = z.string().trim().min(1);

export const HumanDecisionTypeSchema = z.enum([
  "APPROVE",
  "REJECT",
  "MODIFY",
]);

export type HumanDecisionType = z.infer<typeof HumanDecisionTypeSchema>;

export const HumanDecisionStatusSchema = z.enum(["RECORDED", "VOIDED"]);

export type HumanDecisionStatus = z.infer<typeof HumanDecisionStatusSchema>;

export const HumanDecisionSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    planId: nonEmptyTrimmedStringSchema,
    incidentId: nonEmptyTrimmedStringSchema,
    decision: HumanDecisionTypeSchema,
    status: HumanDecisionStatusSchema,
    coordinatorId: nonEmptyTrimmedStringSchema,
    reason: nonEmptyTrimmedStringSchema,
    modifiedPlanId: nonEmptyTrimmedStringSchema.nullable(),
    decidedAt: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (humanDecision) => {
      if (humanDecision.decision === "MODIFY") {
        return humanDecision.modifiedPlanId !== null;
      }

      return humanDecision.modifiedPlanId === null;
    },
    {
      message: "Only MODIFY decisions may reference a modified plan.",
      path: ["modifiedPlanId"],
    },
  )
  .refine(
    (humanDecision) =>
      Date.parse(humanDecision.recordedAt) >=
      Date.parse(humanDecision.decidedAt),
    {
      message: "Recorded time cannot be earlier than decision time.",
      path: ["recordedAt"],
    },
  );

export type HumanDecision = z.infer<typeof HumanDecisionSchema>;
