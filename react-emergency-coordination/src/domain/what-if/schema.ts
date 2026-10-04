import { z } from "zod";

const scenarioDefinitions = [
  {
    id: "route-r1-blocked",
    type: "ROUTE_BLOCKED",
    targetId: "R1",
    label: "Route R1 becomes blocked",
    description:
      "Evaluate how the current response changes if the primary route becomes unavailable.",
    affectedElement: "Route R1",
  },
  {
    id: "hospital-a-unavailable",
    type: "FACILITY_UNAVAILABLE",
    targetId: "FAC-HOSP-A",
    label: "Hospital A becomes unavailable",
    description:
      "Evaluate how casualties would be redirected if Hospital A could no longer receive patients.",
    affectedElement: "Hospital A",
  },
  {
    id: "ambulance-07-unavailable",
    type: "RESOURCE_UNAVAILABLE",
    targetId: "RES-AMB-01",
    label: "Ambulance 07 becomes unavailable",
    description:
      "Evaluate how the response changes if the currently available ambulance cannot be dispatched.",
    affectedElement: "Ambulance 07",
  },
  {
    id: "affected-population-plus-10",
    type: "AFFECTED_POPULATION_INCREASE",
    targetId: "INCIDENT",
    value: 10,
    label: "10 additional people are affected",
    description:
      "Evaluate whether the current resource and facility allocation remains sufficient.",
    affectedElement: "Affected population",
  },
] as const;

export const WhatIfScenarioSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.literal("route-r1-blocked"),
    type: z.literal("ROUTE_BLOCKED"),
    targetId: z.literal("R1"),
    label: z.literal("Route R1 becomes blocked"),
    description: z.literal(
      "Evaluate how the current response changes if the primary route becomes unavailable.",
    ),
    affectedElement: z.literal("Route R1"),
  }).strict(),
  z.object({
    id: z.literal("hospital-a-unavailable"),
    type: z.literal("FACILITY_UNAVAILABLE"),
    targetId: z.literal("FAC-HOSP-A"),
    label: z.literal("Hospital A becomes unavailable"),
    description: z.literal(
      "Evaluate how casualties would be redirected if Hospital A could no longer receive patients.",
    ),
    affectedElement: z.literal("Hospital A"),
  }).strict(),
  z.object({
    id: z.literal("ambulance-07-unavailable"),
    type: z.literal("RESOURCE_UNAVAILABLE"),
    targetId: z.literal("RES-AMB-01"),
    label: z.literal("Ambulance 07 becomes unavailable"),
    description: z.literal(
      "Evaluate how the response changes if the currently available ambulance cannot be dispatched.",
    ),
    affectedElement: z.literal("Ambulance 07"),
  }).strict(),
  z.object({
    id: z.literal("affected-population-plus-10"),
    type: z.literal("AFFECTED_POPULATION_INCREASE"),
    targetId: z.literal("INCIDENT"),
    value: z.literal(10),
    label: z.literal("10 additional people are affected"),
    description: z.literal(
      "Evaluate whether the current resource and facility allocation remains sufficient.",
    ),
    affectedElement: z.literal("Affected population"),
  }).strict(),
]);

export type WhatIfScenario = z.infer<typeof WhatIfScenarioSchema>;

export const WHAT_IF_SCENARIOS: readonly WhatIfScenario[] =
  scenarioDefinitions.map((scenario) => WhatIfScenarioSchema.parse(scenario));

export const WhatIfChangeSchema = z
  .object({
    entityType: z.enum(["INCIDENT", "RESOURCE", "FACILITY", "ROUTE"]),
    entityId: z.string().trim().min(1),
    field: z.string().trim().min(1),
    previousValue: z.union([z.string(), z.number()]),
    hypotheticalValue: z.union([z.string(), z.number()]),
  })
  .strict();
