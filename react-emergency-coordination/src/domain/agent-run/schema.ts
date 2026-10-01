import { z } from "zod";

const nonEmptyTrimmedStringSchema = z.string().trim().min(1);
const nullableUnknownOutputSchema = z
  .unknown()
  .nullable()
  .refine((value) => value !== undefined);

export const AgentTypeSchema = z.enum([
  "RISK_ASSESSMENT",
  "RESOURCE_ROUTING",
  "RESPONSE_PLANNING",
]);

export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentRunStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "TIMED_OUT",
  "INVALID_OUTPUT",
]);

export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentRunSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    incidentId: nonEmptyTrimmedStringSchema,
    agentType: AgentTypeSchema,
    status: AgentRunStatusSchema,
    stateVersion: z.number().int().nonnegative(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    durationMs: z.number().finite().int().nonnegative().nullable(),
    output: nullableUnknownOutputSchema,
    errorMessage: nonEmptyTrimmedStringSchema.nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    const addIssue = (path: (string | number)[], message: string) => {
      context.addIssue({ code: "custom", path, message });
    };

    if (run.status === "PENDING" || run.status === "RUNNING") {
      if (run.completedAt !== null) {
        addIssue(["completedAt"], "Pending and running runs cannot be completed.");
      }
      if (run.durationMs !== null) {
        addIssue(["durationMs"], "Pending and running runs cannot have a duration.");
      }
      if (run.output !== null) {
        addIssue(["output"], "Pending and running runs cannot have output.");
      }
      if (run.errorMessage !== null) {
        addIssue(["errorMessage"], "Pending and running runs cannot have an error message.");
      }
    }

    if (run.status === "COMPLETED") {
      if (run.completedAt === null) {
        addIssue(["completedAt"], "Completed runs require a completion time.");
      }
      if (run.durationMs === null) {
        addIssue(["durationMs"], "Completed runs require a duration.");
      }
      if (run.errorMessage !== null) {
        addIssue(["errorMessage"], "Completed runs cannot have an error message.");
      }
      if (run.output === null) {
        addIssue(["output"], "Completed runs require output.");
      }
    }

    if (
      run.status === "FAILED" ||
      run.status === "TIMED_OUT" ||
      run.status === "INVALID_OUTPUT"
    ) {
      if (run.completedAt === null) {
        addIssue(["completedAt"], "Finished runs require a completion time.");
      }
      if (run.durationMs === null) {
        addIssue(["durationMs"], "Finished runs require a duration.");
      }
      if (run.errorMessage === null) {
        addIssue(["errorMessage"], "Failed runs require an error message.");
      }
    }

    if (
      run.completedAt !== null &&
      Date.parse(run.completedAt) < Date.parse(run.startedAt)
    ) {
      addIssue(["completedAt"], "Completion time cannot be earlier than start time.");
    }
  });

export type AgentRun = z.infer<typeof AgentRunSchema>;
