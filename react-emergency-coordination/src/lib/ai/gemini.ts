import "server-only";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARACTERS = 100_000;

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

  constructor(
    code: GeminiErrorCode,
    message: string,
    validationIssues?: readonly string[],
  ) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.validationIssues = validationIssues;
  }
}

export type GeminiJsonInput =
  | string
  | Readonly<Record<string, unknown>>
  | readonly unknown[];

export type GeminiGenerationOptions = {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  seed?: number;
};

export type GenerateStructuredJsonOptions<T> = {
  systemInstruction: string;
  input: GeminiJsonInput;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  generation?: GeminiGenerationOptions;
};

function normalizeJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new GeminiError(
        "GEMINI_REQUEST_ERROR",
        "Structured Gemini input must contain only finite numbers.",
      );
    }
    return value;
  }

  if (typeof value !== "object") {
    throw new GeminiError(
      "GEMINI_REQUEST_ERROR",
      "Structured Gemini input contains a value that cannot be represented as JSON.",
    );
  }

  if (ancestors.has(value)) {
    throw new GeminiError(
      "GEMINI_REQUEST_ERROR",
      "Structured Gemini input contains a circular reference.",
    );
  }
  ancestors.add(value);

  if (Array.isArray(value)) {
    const items = (value as readonly unknown[]).map((item) =>
      normalizeJsonValue(item, ancestors),
    );
    ancestors.delete(value);
    return items;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    ancestors.delete(value);
    throw new GeminiError(
      "GEMINI_REQUEST_ERROR",
      "Structured Gemini input must contain only plain JSON objects and arrays.",
    );
  }

  const source = value as Record<string, unknown>;
  const entries = Object.keys(source)
    .sort()
    .map(
      (key): [string, unknown] => [
        key,
        normalizeJsonValue(source[key], ancestors),
      ],
    );
  ancestors.delete(value);
  return Object.fromEntries(entries) as Record<string, unknown>;
}

export function serializeGeminiInput(input: GeminiJsonInput): string {
  if (typeof input === "string") return input;

  const serialized = JSON.stringify(normalizeJsonValue(input, new WeakSet()));
  if (typeof serialized !== "string") {
    throw new GeminiError(
      "GEMINI_REQUEST_ERROR",
      "Structured Gemini input could not be serialized as JSON.",
    );
  }
  return serialized;
}

function stripJsonFence(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return match === null ? text.trim() : match[1].trim();
}

export function parseStructuredJson<T>(
  responseText: string,
  schema: z.ZodType<T>,
): T {
  if (responseText.trim().length === 0) {
    throw new GeminiError(
      "GEMINI_EMPTY_RESPONSE",
      "Gemini returned an empty response.",
    );
  }

  const jsonText = stripJsonFence(responseText);
  if (jsonText.length === 0) {
    throw new GeminiError(
      "GEMINI_EMPTY_RESPONSE",
      "Gemini returned an empty response.",
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new GeminiError(
      "GEMINI_INVALID_JSON",
      "Gemini returned malformed JSON.",
    );
  }

  const validation = schema.safeParse(parsedJson);
  if (!validation.success) {
    const validationIssues = validation.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".") || "<root>";
      return `${path}: ${issue.message}`;
    });
    throw new GeminiError(
      "GEMINI_SCHEMA_VALIDATION_FAILED",
      "Gemini JSON did not match the expected schema.",
      validationIssues,
    );
  }

  return validation.data;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const resolvedTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(resolvedTimeout) ||
    resolvedTimeout < 1 ||
    resolvedTimeout > MAX_TIMEOUT_MS
  ) {
    throw new GeminiError(
      "GEMINI_CONFIG_ERROR",
      `timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`,
    );
  }
  return resolvedTimeout;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "RequestTimeoutError" ||
    error.name === "TimeoutError" ||
    error.name === "AbortError"
  );
}

export async function generateStructuredJson<T>(
  options: GenerateStructuredJsonOptions<T>,
): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new GeminiError(
      "GEMINI_CONFIG_ERROR",
      "GEMINI_API_KEY must be configured in the server environment.",
    );
  }

  if (options.systemInstruction.trim().length === 0) {
    throw new GeminiError(
      "GEMINI_CONFIG_ERROR",
      "A non-empty system instruction is required.",
    );
  }

  const timeoutMs = resolveTimeout(options.timeoutMs);
  const input = serializeGeminiInput(options.input);
  if (options.systemInstruction.length + input.length > MAX_INPUT_CHARACTERS) {
    throw new GeminiError(
      "GEMINI_REQUEST_ERROR",
      `Gemini input exceeds the ${MAX_INPUT_CHARACTERS}-character request limit.`,
    );
  }

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const client = new GoogleGenAI({ apiKey });

  let responseText: string | undefined;
  try {
    const response = await client.models.generateContent({
      model,
      contents: input,
      config: {
        systemInstruction: options.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: options.schema,
        httpOptions: { timeout: timeoutMs },
        ...options.generation,
      },
    });
    responseText = response.text;
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if (isTimeoutError(error)) {
      throw new GeminiError(
        "GEMINI_TIMEOUT",
        `Gemini request exceeded the ${timeoutMs}ms timeout.`,
      );
    }
    throw new GeminiError(
      "GEMINI_REQUEST_ERROR",
      "Gemini request failed. No request details or credentials were logged or exposed.",
    );
  }

  return parseStructuredJson(responseText ?? "", options.schema);
}
