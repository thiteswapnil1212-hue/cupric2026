BEGIN;

CREATE TABLE response_plan_alternatives (
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  id TEXT NOT NULL CHECK (btrim(id) <> ''),
  summary TEXT NOT NULL CHECK (btrim(summary) <> ''),
  rationale TEXT NOT NULL CHECK (btrim(rationale) <> ''),
  CONSTRAINT response_plan_alternatives_pkey PRIMARY KEY (plan_id, sequence),
  CONSTRAINT response_plan_alternatives_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES response_plans(id) ON DELETE RESTRICT
);

CREATE TABLE response_plan_resource_dependencies (
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  resource_id TEXT NOT NULL CHECK (btrim(resource_id) <> ''),
  CONSTRAINT response_plan_resource_dependencies_pkey
    PRIMARY KEY (plan_id, sequence),
  CONSTRAINT response_plan_resource_dependencies_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES response_plans(id) ON DELETE RESTRICT,
  CONSTRAINT response_plan_resource_dependencies_resource_id_fkey
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
);

CREATE TABLE response_plan_facility_dependencies (
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  facility_id TEXT NOT NULL CHECK (btrim(facility_id) <> ''),
  CONSTRAINT response_plan_facility_dependencies_pkey
    PRIMARY KEY (plan_id, sequence),
  CONSTRAINT response_plan_facility_dependencies_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES response_plans(id) ON DELETE RESTRICT,
  CONSTRAINT response_plan_facility_dependencies_facility_id_fkey
    FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE RESTRICT
);

CREATE TABLE response_plan_route_dependencies (
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  route_id TEXT NOT NULL CHECK (btrim(route_id) <> ''),
  CONSTRAINT response_plan_route_dependencies_pkey
    PRIMARY KEY (plan_id, sequence),
  CONSTRAINT response_plan_route_dependencies_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES response_plans(id) ON DELETE RESTRICT,
  CONSTRAINT response_plan_route_dependencies_route_id_fkey
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE RESTRICT
);

COMMIT;
