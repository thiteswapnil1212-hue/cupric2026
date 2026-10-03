import { PlanSourceSchema, type PlanSource } from "../../domain/response-plan/schema";

const sourceMarkerPattern =
  /^\[\[REACT_PLAN_SOURCE:(GEMINI|AI|DETERMINISTIC_FALLBACK|UNKNOWN)\]\]\r?\n/;

export function encodePlanSource(
  rationale: string,
  source: PlanSource | undefined,
): string {
  const cleanRationale = rationale.replace(sourceMarkerPattern, "");
  return `[[REACT_PLAN_SOURCE:${PlanSourceSchema.parse(source ?? "UNKNOWN")}]]\n${cleanRationale}`;
}

export function decodePlanSource(rationale: string): {
  rationale: string;
  source: PlanSource;
} {
  const match = sourceMarkerPattern.exec(rationale);
  if (match === null) return { rationale, source: "UNKNOWN" };
  const source = PlanSourceSchema.parse(match[1] === "AI" ? "GEMINI" : match[1]);
  return {
    rationale: rationale.slice(match[0].length),
    source,
  };
}
