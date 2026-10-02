import { z } from "zod";

export type GeminiErrorCode =
  | "GEMINI_CONFIG_ERROR"
  | "GEMINI_REQUEST_ERROR"
  | "GEMINI_TIMEOUT"
  | "GEMINI_EMPTY_RESPONSE"
  | "GEMINI_INVALID_JSON"
  | "GEMINI_SCHEMA_VALIDATION_FAILED";

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly validationIssues: readonly string[] | undefined;

  constructor(code: GeminiErrorCode, message: string, validationIssues?: readonly string[]) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.validationIssues = validationIssues;
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

export function geminiRequestFailure(error: unknown, timeoutMs: number): GeminiError {
  if (error instanceof Error && ["RequestTimeoutError", "TimeoutError", "AbortError"].includes(error.name)) {
    return new GeminiError("GEMINI_TIMEOUT", `Gemini request exceeded the ${timeoutMs}ms timeout.`);
  }
  return new GeminiError(
    "GEMINI_REQUEST_ERROR",
    "Gemini request failed. No request details or credentials were logged or exposed.",
  );
}
