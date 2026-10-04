import "server-only";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  GeminiError,
  geminiRequestFailure,
  parseStructuredJson,
  requireGeminiApiKey,
  type GeminiFailureCategory,
  type GeminiGenerationMetadata,
  type GeminiModelFailure,
  type GeminiModel,
  type GeminiErrorCode,
} from "./gemini-contract";

export { GeminiError, parseStructuredJson };
export type {
  GeminiErrorCode,
  GeminiGenerationMetadata,
  GeminiModelFailure,
  GeminiModel,
};

const GEMINI_MODELS: readonly GeminiModel[] = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
];
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARACTERS = 100_000;

type GeminiRequestParameters = Parameters<
  GoogleGenAI["models"]["generateContent"]
>[0];
type GeminiResponse = Awaited<
  ReturnType<GoogleGenAI["models"]["generateContent"]>
>;

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
  onMetadata?: (metadata: GeminiGenerationMetadata) => void;
};

export type GeminiGenerationResult<T> = {
  value: T;
  metadata: GeminiGenerationMetadata;
};

export type GeminiGenerationDependencies = {
  request: (parameters: GeminiRequestParameters) => Promise<GeminiResponse>;
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

function metadata(
  attemptedModels: readonly GeminiModel[],
  selectedModel: GeminiModel | null,
  finalProviderFailure: GeminiGenerationMetadata["finalProviderFailure"],
  modelFailures: readonly GeminiModelFailure[] = [],
): GeminiGenerationMetadata {
  return {
    selectedModel,
    attemptedModels: [...attemptedModels],
    fallbackUsed: attemptedModels.length > 1,
    finalProviderFailure,
    ...(modelFailures.length === 0
      ? {}
      : { modelFailures: modelFailures.map((failure) => ({ ...failure })) }),
  };
}

function failureCategory(error: GeminiError): GeminiFailureCategory {
  if (error.code === "GEMINI_TIMEOUT") return "TIMEOUT";
  return error.metadata?.finalProviderFailure?.category ?? "PERMANENT";
}

function errorMetadata(
  error: GeminiError,
  attemptedModels: readonly GeminiModel[],
): GeminiGenerationMetadata {
  const httpStatus = error.metadata?.finalProviderFailure?.httpStatus;
  return metadata(attemptedModels, null, {
    code: error.code,
    category: failureCategory(error),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
}

export async function generateStructuredJsonWithMetadata<T>(
  options: GenerateStructuredJsonOptions<T>,
  dependencies?: GeminiGenerationDependencies,
): Promise<GeminiGenerationResult<T>> {
  const apiKey =
    dependencies === undefined
      ? requireGeminiApiKey(process.env.GEMINI_API_KEY)
      : undefined;

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

  const client =
    apiKey === undefined ? undefined : new GoogleGenAI({ apiKey });
  const request =
    dependencies?.request ??
    ((parameters: GeminiRequestParameters) => {
      if (client === undefined) {
        throw new GeminiError(
          "GEMINI_CONFIG_ERROR",
          "Gemini client configuration is unavailable.",
        );
      }
      return client.models.generateContent(parameters);
    });

  const attemptedModels: GeminiModel[] = [];
  const modelFailures: GeminiModelFailure[] = [];
  let lastFailure: GeminiError | undefined;
  for (const model of GEMINI_MODELS) {
    attemptedModels.push(model);
    let response: GeminiResponse;
    try {
      response = await request({
        model,
        contents: input,
        config: {
          systemInstruction: options.systemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(options.schema),
          httpOptions: {
            timeout: timeoutMs,
            retryOptions: { attempts: 1 },
          },
          ...options.generation,
        },
      });
    } catch (error) {
      const requestFailure =
        error instanceof GeminiError
          ? new GeminiError(
              error.code,
              error.message,
              error.validationIssues,
              errorMetadata(error, attemptedModels),
            )
          : geminiRequestFailure(error, timeoutMs, model, attemptedModels);
      const category = failureCategory(requestFailure);
      const providerFailure = requestFailure.metadata?.finalProviderFailure;
      modelFailures.push({
        model,
        code: requestFailure.code,
        category,
        ...(providerFailure?.httpStatus === undefined
          ? {}
          : { httpStatus: providerFailure.httpStatus }),
      });
      lastFailure = requestFailure;
      if (category === "PROJECT_QUOTA_EXHAUSTED") {
        throw new GeminiError(
          "GEMINI_AI_UNAVAILABLE",
          "Gemini project-wide quota exhaustion prevents further model requests.",
          undefined,
          metadata(
            attemptedModels,
            null,
            {
              code: requestFailure.code,
              category,
              ...(providerFailure?.httpStatus === undefined
                ? {}
                : { httpStatus: providerFailure.httpStatus }),
            },
            modelFailures,
          ),
        );
      }
      if (attemptedModels.length < GEMINI_MODELS.length) continue;
      break;
    }

    try {
      const value = parseStructuredJson(response.text ?? "", options.schema);
      return {
        value,
        metadata: metadata(attemptedModels, model, null, modelFailures),
      };
    } catch (error) {
      if (!(error instanceof GeminiError)) throw error;
      lastFailure = error;
      modelFailures.push({
        model,
        code: error.code,
        category: "PERMANENT",
      });
      if (attemptedModels.length < GEMINI_MODELS.length) continue;
    }
  }

  if (lastFailure === undefined) {
    throw new GeminiError(
      "GEMINI_AI_UNAVAILABLE",
      "Gemini is unavailable across the configured models.",
      undefined,
      metadata(attemptedModels, null, null, modelFailures),
    );
  }
  const finalProviderFailure =
    lastFailure.metadata?.finalProviderFailure ?? {
      code: lastFailure.code,
      category: "PERMANENT" as const,
    };
  const invalidStructuredOutput = [
    "GEMINI_INVALID_JSON",
    "GEMINI_EMPTY_RESPONSE",
    "GEMINI_SCHEMA_VALIDATION_FAILED",
  ].includes(lastFailure.code);
  throw new GeminiError(
    invalidStructuredOutput ? lastFailure.code : "GEMINI_AI_UNAVAILABLE",
    invalidStructuredOutput
      ? "Gemini returned no usable structured response across the configured models."
      : "Gemini is unavailable across the configured models.",
    lastFailure.validationIssues,
    metadata(attemptedModels, null, finalProviderFailure, modelFailures),
  );
}

export async function generateStructuredJson<T>(
  options: GenerateStructuredJsonOptions<T>,
): Promise<T> {
  try {
    const result = await generateStructuredJsonWithMetadata(options);
    options.onMetadata?.(result.metadata);
    return result.value;
  } catch (error) {
    if (error instanceof GeminiError && error.metadata !== undefined) {
      options.onMetadata?.(error.metadata);
    }
    throw error;
  }
}
