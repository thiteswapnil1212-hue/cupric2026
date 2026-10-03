import { z } from "zod";

export const GeminiErrorCodeSchema = z.enum([
  "GEMINI_CONFIG_ERROR",
  "GEMINI_REQUEST_ERROR",
  "GEMINI_TIMEOUT",
  "GEMINI_EMPTY_RESPONSE",
  "GEMINI_INVALID_JSON",
  "GEMINI_SCHEMA_VALIDATION_FAILED",
  "GEMINI_AI_UNAVAILABLE",
]);
export type GeminiErrorCode = z.infer<typeof GeminiErrorCodeSchema>;

export const GeminiModelSchema = z.enum([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
]);
export type GeminiModel = z.infer<typeof GeminiModelSchema>;

export const GeminiFailureCategorySchema = z.enum([
  "TIMEOUT",
  "NETWORK",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PERMANENT",
]);
export type GeminiFailureCategory = z.infer<
  typeof GeminiFailureCategorySchema
>;

export const GeminiFinalProviderFailureSchema = z
  .object({
    code: GeminiErrorCodeSchema,
    category: GeminiFailureCategorySchema,
    httpStatus: z.number().int().optional(),
  })
  .strict();
export type GeminiFinalProviderFailure = z.infer<
  typeof GeminiFinalProviderFailureSchema
>;

export const GeminiGenerationMetadataSchema = z
  .object({
    selectedModel: GeminiModelSchema.nullable(),
    attemptedModels: z.array(GeminiModelSchema),
    fallbackUsed: z.boolean(),
    finalProviderFailure: GeminiFinalProviderFailureSchema.nullable(),
  })
  .strict();
export type GeminiGenerationMetadata = z.infer<
  typeof GeminiGenerationMetadataSchema
>;

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly validationIssues: readonly string[] | undefined;
  readonly metadata: GeminiGenerationMetadata | undefined;

  constructor(
    code: GeminiErrorCode,
    message: string,
    validationIssues?: readonly string[],
    metadata?: GeminiGenerationMetadata,
  ) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.validationIssues = validationIssues;
    this.metadata =
      metadata === undefined
        ? undefined
        : {
            ...metadata,
            attemptedModels: [...metadata.attemptedModels],
            finalProviderFailure:
              metadata.finalProviderFailure === null
                ? null
                : { ...metadata.finalProviderFailure },
          };
  }
}

export function requireGeminiApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new GeminiError("GEMINI_CONFIG_ERROR", "GEMINI_API_KEY must be configured in the server environment.");
  }
  return apiKey;
}

function stripJsonFence(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return match === null ? text.trim() : match[1].trim();
}

export function parseStructuredJson<T>(responseText: string, schema: z.ZodType<T>): T {
  if (responseText.trim().length === 0) {
    throw new GeminiError("GEMINI_EMPTY_RESPONSE", "Gemini returned an empty response.");
  }
  const jsonText = stripJsonFence(responseText);
  if (jsonText.length === 0) {
    throw new GeminiError("GEMINI_EMPTY_RESPONSE", "Gemini returned an empty response.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new GeminiError("GEMINI_INVALID_JSON", "Gemini returned malformed JSON.");
  }

  const validation = schema.safeParse(parsedJson);
  if (!validation.success) {
    const issues = validation.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".") || "<root>";
      return `${path}: ${issue.message}`;
    });
    throw new GeminiError("GEMINI_SCHEMA_VALIDATION_FAILED", "Gemini JSON did not match the expected schema.", issues);
  }
  return validation.data;
}

function objectProperty(
  value: unknown,
  key: string,
): unknown {
  return typeof value === "object" && value !== null && key in value
    ? value[key as keyof typeof value]
    : undefined;
}

function getHttpStatus(error: unknown): number | undefined {
  const directStatus = objectProperty(error, "status");
  if (typeof directStatus === "number" && Number.isInteger(directStatus)) {
    return directStatus;
  }
  const directCode = objectProperty(error, "code");
  return typeof directCode === "number" && Number.isInteger(directCode)
    ? directCode
    : undefined;
}

function isTimeout(error: unknown): boolean {
  const name = objectProperty(error, "name");
  return (
    typeof name === "string" &&
    ["RequestTimeoutError", "TimeoutError", "AbortError"].includes(name)
  );
}

function hasTransientNetworkCode(error: unknown): boolean {
  const cause = objectProperty(error, "cause");
  const code = objectProperty(cause, "code") ?? objectProperty(error, "code");
  return (
    typeof code === "string" &&
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "EAI_AGAIN",
      "ENOTFOUND",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(code)
  );
}

export function classifyGeminiProviderFailure(error: unknown): {
  category: GeminiFailureCategory;
  httpStatus?: number;
  transient: boolean;
} {
  const httpStatus = getHttpStatus(error);
  if (isTimeout(error) || httpStatus === 408) {
    return { category: "TIMEOUT", transient: true, httpStatus };
  }
  if (httpStatus === 429) {
    return { category: "RATE_LIMITED", transient: true, httpStatus };
  }
  if (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599) {
    return { category: "PROVIDER_UNAVAILABLE", transient: true, httpStatus };
  }
  if (httpStatus !== undefined) {
    return { category: "PERMANENT", transient: false, httpStatus };
  }
  if (
    hasTransientNetworkCode(error) ||
    (objectProperty(error, "name") === "TypeError" &&
      objectProperty(error, "cause") !== undefined)
  ) {
    return { category: "NETWORK", transient: true };
  }
  return { category: "PERMANENT", transient: false };
}

export function geminiRequestFailure(
  error: unknown,
  timeoutMs: number,
  model: GeminiModel = "gemini-3.8-flash",
  attemptedModels: readonly GeminiModel[] = [model],
): GeminiError {
  const failure = classifyGeminiProviderFailure(error);
  const code: GeminiErrorCode =
    failure.category === "TIMEOUT" ? "GEMINI_TIMEOUT" : "GEMINI_REQUEST_ERROR";
  const metadata: GeminiGenerationMetadata = {
    selectedModel: null,
    attemptedModels: [...attemptedModels],
    fallbackUsed: attemptedModels.length > 1,
    finalProviderFailure: {
      code,
      category: failure.category,
      ...(failure.httpStatus === undefined
        ? {}
        : { httpStatus: failure.httpStatus }),
    },
  };
  const message =
    failure.category === "TIMEOUT"
      ? `Gemini request exceeded the ${timeoutMs}ms timeout.`
      : "Gemini request failed. Provider details were not exposed.";
  return new GeminiError(code, message, undefined, metadata);
}
