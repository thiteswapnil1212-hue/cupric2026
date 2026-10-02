import assert from "node:assert/strict";
import { getDemoState } from "../src/lib/demo/fixtures";
import {
  GeminiError,
  parseStructuredJson,
  requireGeminiApiKey,
} from "../src/lib/ai/gemini-contract";
import {
  RiskAssessmentAgentError,
  runRiskAssessment,
} from "../src/lib/agents/risk-assessment/agent";
import type { RiskAssessment } from "../src/lib/agents/risk-assessment/schema";

const state = getDemoState("initial").state;
const validAssessment: RiskAssessment = {
  severity: state.incident.severity,
  urgency: "IMMEDIATE",
  priority: 5,
  affectedPopulation: state.incident.affectedPopulation,
  hazardFactors: [...state.incident.hazards],
  riskFactors: ["Active incident requires urgent assessment."],
  keyConcerns: ["Assess uncertainty using supplied information."],
  reasoning: "Severity, population, and hazards reflect the supplied incident.",
  confidence: 0.9,
};

async function expectAgentError(
  operation: Promise<unknown>,
  code: RiskAssessmentAgentError["code"],
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof RiskAssessmentAgentError && error.code === code,
  );
}

async function main(): Promise<void> {
  let receivedInput: unknown;
  const result = await runRiskAssessment(state, {
    generateStructuredJson: async (options) => {
      receivedInput = options.input;
      return parseStructuredJson(
        JSON.stringify(validAssessment),
        options.schema,
      );
    },
  });
  assert.deepEqual(result, validAssessment);
  assert.equal(result.affectedPopulation, state.incident.affectedPopulation);
  assert.deepEqual(result.hazardFactors, state.incident.hazards);
  assert.deepEqual(state, getDemoState("initial").state);

  assert.equal(typeof receivedInput, "string");
  const facts = JSON.parse(receivedInput as string) as {
    stateVersion: number;
    incident: { id: string; affectedPopulation: number; hazards: string[] };
    resources: { id: string }[];
    facilities: { id: string }[];
    routes: { id: string }[];
  };
  assert.equal(facts.incident.id, state.incident.id);
  assert.equal(facts.stateVersion, state.stateVersion);
  assert.equal(facts.incident.affectedPopulation, state.incident.affectedPopulation);
  assert.deepEqual(facts.incident.hazards, [...state.incident.hazards].sort());
  assert.deepEqual(
    facts.resources.map(({ id }) => id),
    state.resources.map(({ id }) => id).sort(),
  );
  assert.deepEqual(
    facts.facilities.map(({ id }) => id),
    state.facilities.map(({ id }) => id).sort(),
  );
  assert.deepEqual(
    facts.routes.map(({ id }) => id),
    state.routes.map(({ id }) => id).sort(),
  );

  await expectAgentError(
    runRiskAssessment(state, {
      generateStructuredJson: async (options) =>
        parseStructuredJson("{ malformed", options.schema),
    }),
    "RISK_ASSESSMENT_INVALID_STRUCTURED_OUTPUT",
  );
  await expectAgentError(
    runRiskAssessment(state, {
      generateStructuredJson: async (options) =>
        parseStructuredJson(
          JSON.stringify({ ...validAssessment, resourceIds: ["invented-resource"] }),
          options.schema,
        ),
    }),
    "RISK_ASSESSMENT_SCHEMA_VALIDATION_FAILED",
  );
  await expectAgentError(
    runRiskAssessment(state, {
      generateStructuredJson: async () => {
        throw new GeminiError("GEMINI_TIMEOUT", "Fixture timeout.");
      },
    }),
    "RISK_ASSESSMENT_GEMINI_TIMEOUT",
  );
  await expectAgentError(
    runRiskAssessment(state, {
      generateStructuredJson: async () => {
        throw new GeminiError("GEMINI_REQUEST_ERROR", "Fixture request failure.");
      },
    }),
    "RISK_ASSESSMENT_GEMINI_REQUEST_ERROR",
  );
  await expectAgentError(
    runRiskAssessment(state, {
      generateStructuredJson: async () => {
        throw new GeminiError("GEMINI_CONFIG_ERROR", "Fixture missing key.");
      },
    }),
    "RISK_ASSESSMENT_GEMINI_CONFIG_ERROR",
  );
  assert.throws(
    () => requireGeminiApiKey(undefined),
    (error: unknown) =>
      error instanceof GeminiError && error.code === "GEMINI_CONFIG_ERROR",
  );
  await expectAgentError(
    runRiskAssessment(state, {
      generateStructuredJson: async () => ({
        ...validAssessment,
        affectedPopulation: state.incident.affectedPopulation + 1,
      }),
    }),
    "RISK_ASSESSMENT_FACT_CONFLICT",
  );
  await expectAgentError(
    runRiskAssessment({ ...state, stateVersion: -1 }),
    "RISK_ASSESSMENT_INPUT_INVALID",
  );

  console.log("Risk assessment agent fixture passed.");
}

void main();
