import "server-only";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  GeminiError,
  geminiRequestFailure,
  parseStructuredJson,
  requireGeminiApiKey,
  type GeminiErrorCode,
} from "./gemini-contract";

export { GeminiError, parseStructuredJson };
export type { GeminiErrorCode };

const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARACTERS = 100_000;

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

export async function generateStructuredJson<T>(
  options: GenerateStructuredJsonOptions<T>,
): Promise<T> {
  const apiKey = requireGeminiApiKey(process.env.GEMINI_API_KEY);

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
    throw geminiRequestFailure(error, timeoutMs);
  }

  return parseStructuredJson(responseText ?? "", options.schema);
}
