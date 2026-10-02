import { z } from "zod";
import { SeverityLevelSchema } from "../../../domain/incident/schema";

const boundedFactorSchema = z.string().trim().min(1).max(160);

export const RiskUrgencySchema = z.enum([
  "LOW",
  "MODERATE",
  "HIGH",
  "IMMEDIATE",
]);

export const RiskAssessmentSchema = z
  .object({
    severity: SeverityLevelSchema,
    urgency: RiskUrgencySchema,
    priority: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe("Integer scale: 1 is lowest priority and 5 is highest."),
    affectedPopulation: z.number().int().nonnegative(),
    hazardFactors: z.array(boundedFactorSchema).max(8),
    riskFactors: z.array(boundedFactorSchema).max(8),
    keyConcerns: z.array(boundedFactorSchema).max(6),
    reasoning: z.string().trim().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type RiskUrgency = z.infer<typeof RiskUrgencySchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
