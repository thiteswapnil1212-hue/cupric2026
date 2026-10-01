BEGIN;

CREATE TABLE incidents (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'FIRE',
    'MEDICAL',
    'BUILDING_COLLAPSE',
    'FLOOD',
    'ROAD_ACCIDENT',
    'INDUSTRIAL_ACCIDENT',
    'OTHER'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'ACTIVE',
    'CONTAINED',
    'RESOLVED',
    'CANCELLED'
  )),
  severity TEXT NOT NULL CHECK (severity IN (
    'LOW',
    'MODERATE',
    'HIGH',
    'CRITICAL'
  )),
  priority TEXT NOT NULL CHECK (priority IN (
    'LOW',
    'NORMAL',
    'HIGH',
    'URGENT'
  )),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  address TEXT NOT NULL,
  affected_population INTEGER NOT NULL CHECK (affected_population >= 0),
  hazards JSONB NOT NULL CHECK (
    jsonb_typeof(hazards) = 'array'
    AND NOT jsonb_path_exists(hazards, '$[*] ? (@.type() != "string")')
  ),
  reported_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'RESCUE_TEAM',
    'AMBULANCE',
    'FIRE_UNIT',
    'POLICE_UNIT',
    'MEDICAL_TEAM',
    'HELICOPTER',
    'OTHER'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'AVAILABLE',
    'ASSIGNED',
    'DISPATCHED',
    'BUSY',
    'UNAVAILABLE',
    'OUT_OF_SERVICE'
  )),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  current_assignment_id TEXT CHECK (
    current_assignment_id IS NULL OR btrim(current_assignment_id) <> ''
  ),
  capabilities JSONB NOT NULL CHECK (
    jsonb_typeof(capabilities) = 'array'
    AND NOT jsonb_path_exists(capabilities, '$[*] ? (@.type() != "string")')
  ),
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE facilities (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'HOSPITAL',
    'SHELTER',
    'MEDICAL_CENTER',
    'RELIEF_CENTER',
    'OTHER'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'OPERATIONAL',
    'LIMITED',
    'FULL',
    'CLOSED',
    'UNAVAILABLE'
  )),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  address TEXT NOT NULL,
  total_capacity INTEGER NOT NULL CHECK (total_capacity >= 0),
  available_capacity INTEGER NOT NULL CHECK (available_capacity >= 0),
  capabilities JSONB NOT NULL CHECK (
    jsonb_typeof(capabilities) = 'array'
    AND NOT jsonb_path_exists(capabilities, '$[*] ? (@.type() != "string")')
  ),
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT facilities_capacity_order_check
    CHECK (available_capacity <= total_capacity)
);

CREATE TABLE routes (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'OPEN',
    'PARTIALLY_BLOCKED',
    'BLOCKED',
    'CLOSED'
  )),
  distance_km DOUBLE PRECISION NOT NULL CHECK (
    distance_km >= 0 AND distance_km < 'Infinity'::DOUBLE PRECISION
  ),
  estimated_travel_minutes INTEGER NOT NULL CHECK (estimated_travel_minutes >= 0),
  origin_latitude DOUBLE PRECISION NOT NULL CHECK (origin_latitude BETWEEN -90 AND 90),
  origin_longitude DOUBLE PRECISION NOT NULL CHECK (origin_longitude BETWEEN -180 AND 180),
  destination_latitude DOUBLE PRECISION NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
  destination_longitude DOUBLE PRECISION NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
  blocked_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT routes_blocked_reason_non_empty_check
    CHECK (blocked_reason IS NULL OR btrim(blocked_reason) <> ''),
  CONSTRAINT routes_status_blocked_reason_check CHECK (
    (status = 'OPEN' AND blocked_reason IS NULL)
    OR status = 'PARTIALLY_BLOCKED'
    OR (status IN ('BLOCKED', 'CLOSED') AND blocked_reason IS NOT NULL)
  )
);

CREATE TABLE response_plans (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  incident_id TEXT NOT NULL CHECK (btrim(incident_id) <> ''),
  state_version INTEGER NOT NULL CHECK (state_version >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'MODIFIED',
    'EXECUTING',
    'COMPLETED',
    'SUPERSEDED',
    'INVALID'
  )),
  priority TEXT NOT NULL CHECK (priority IN (
    'LOW',
    'NORMAL',
    'HIGH',
    'URGENT'
  )),
  summary TEXT NOT NULL CHECK (btrim(summary) <> ''),
  rationale TEXT NOT NULL CHECK (btrim(rationale) <> ''),
  generated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT response_plans_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE RESTRICT
);

CREATE TABLE plan_actions (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  plan_id TEXT NOT NULL CHECK (btrim(plan_id) <> ''),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  type TEXT NOT NULL CHECK (type IN (
    'DISPATCH_RESOURCE',
    'ASSIGN_RESOURCE',
    'TRANSPORT_PEOPLE',
    'EVACUATE_AREA',
    'CLOSE_ROUTE',
    'OPEN_ROUTE',
    'ESTABLISH_TRIAGE',
    'SHELTER_PEOPLE',
    'NOTIFY_FACILITY',
    'OTHER'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING',
    'APPROVED',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  )),
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  priority TEXT NOT NULL CHECK (priority IN (
    'LOW',
    'NORMAL',
    'HIGH',
    'URGENT'
  )),
  resource_ids JSONB NOT NULL CHECK (
    jsonb_typeof(resource_ids) = 'array'
    AND NOT jsonb_path_exists(resource_ids, '$[*] ? (@.type() != "string" || @ == "")')
  ),
  facility_ids JSONB NOT NULL CHECK (
    jsonb_typeof(facility_ids) = 'array'
    AND NOT jsonb_path_exists(facility_ids, '$[*] ? (@.type() != "string" || @ == "")')
  ),
  route_ids JSONB NOT NULL CHECK (
    jsonb_typeof(route_ids) = 'array'
    AND NOT jsonb_path_exists(route_ids, '$[*] ? (@.type() != "string" || @ == "")')
  ),
  target_latitude DOUBLE PRECISION,
  target_longitude DOUBLE PRECISION,
  estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT plan_actions_target_location_check CHECK (
    (target_latitude IS NULL AND target_longitude IS NULL)
    OR (
      target_latitude IS NOT NULL
      AND target_longitude IS NOT NULL
      AND target_latitude BETWEEN -90 AND 90
      AND target_longitude BETWEEN -180 AND 180
    )
  ),
  CONSTRAINT plan_actions_execution_target_check CHECK (
    jsonb_path_exists(resource_ids, '$[0]')
    OR jsonb_path_exists(facility_ids, '$[0]')
    OR jsonb_path_exists(route_ids, '$[0]')
    OR target_latitude IS NOT NULL
  ),
  CONSTRAINT plan_actions_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES response_plans(id) ON DELETE RESTRICT
);

CREATE TABLE state_changes (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'INCIDENT',
    'RESOURCE',
    'FACILITY',
    'ROUTE',
    'PLAN',
    'OTHER'
  )),
  entity_id TEXT NOT NULL CHECK (btrim(entity_id) <> ''),
  change_type TEXT NOT NULL CHECK (change_type IN (
    'CREATED',
    'UPDATED',
    'STATUS_CHANGED',
    'CAPACITY_CHANGED',
    'AVAILABILITY_CHANGED',
    'LOCATION_CHANGED',
    'SEVERITY_CHANGED',
    'HAZARD_CHANGED',
    'ROUTE_CHANGED',
    'POPULATION_CHANGED',
    'OTHER'
  )),
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  previous_value JSONB,
  new_value JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT state_changes_values_present_check CHECK (
    (previous_value IS NOT NULL AND previous_value <> 'null'::JSONB)
    OR (new_value IS NOT NULL AND new_value <> 'null'::JSONB)
  ),
  CONSTRAINT state_changes_detected_at_check CHECK (detected_at >= occurred_at)
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  incident_id TEXT NOT NULL CHECK (btrim(incident_id) <> ''),
  agent_type TEXT NOT NULL CHECK (agent_type IN (
    'RISK_ASSESSMENT',
    'RESOURCE_ROUTING',
    'RESPONSE_PLANNING'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'TIMED_OUT',
    'INVALID_OUTPUT'
  )),
  state_version INTEGER NOT NULL CHECK (state_version >= 0),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  output JSONB,
  error_message TEXT CHECK (error_message IS NULL OR btrim(error_message) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_runs_completed_at_check
    CHECK (completed_at IS NULL OR completed_at >= started_at),
  CONSTRAINT agent_runs_status_fields_check CHECK (
    (
      status IN ('PENDING', 'RUNNING')
      AND completed_at IS NULL
      AND duration_ms IS NULL
      AND (output IS NULL OR output = 'null'::JSONB)
      AND error_message IS NULL
    )
    OR (
      status = 'COMPLETED'
      AND completed_at IS NOT NULL
      AND duration_ms IS NOT NULL
      AND output IS NOT NULL
      AND output <> 'null'::JSONB
      AND error_message IS NULL
    )
    OR (
      status IN ('FAILED', 'TIMED_OUT', 'INVALID_OUTPUT')
      AND completed_at IS NOT NULL
      AND duration_ms IS NOT NULL
      AND error_message IS NOT NULL
      AND btrim(error_message) <> ''
    )
  ),
  CONSTRAINT agent_runs_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE RESTRICT
);

CREATE TABLE human_decisions (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  plan_id TEXT NOT NULL CHECK (btrim(plan_id) <> ''),
  incident_id TEXT NOT NULL CHECK (btrim(incident_id) <> ''),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REJECT', 'MODIFY')),
  status TEXT NOT NULL CHECK (status IN ('RECORDED', 'VOIDED')),
  coordinator_id TEXT NOT NULL CHECK (btrim(coordinator_id) <> ''),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  modified_plan_id TEXT CHECK (
    modified_plan_id IS NULL OR btrim(modified_plan_id) <> ''
  ),
  decided_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT human_decisions_modified_plan_check CHECK (
    (decision IN ('APPROVE', 'REJECT') AND modified_plan_id IS NULL)
    OR (decision = 'MODIFY' AND modified_plan_id IS NOT NULL)
  ),
  CONSTRAINT human_decisions_recorded_at_check CHECK (recorded_at >= decided_at),
  CONSTRAINT human_decisions_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES response_plans(id) ON DELETE RESTRICT,
  CONSTRAINT human_decisions_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE RESTRICT,
  CONSTRAINT human_decisions_modified_plan_id_fkey
    FOREIGN KEY (modified_plan_id) REFERENCES response_plans(id) ON DELETE RESTRICT
);

CREATE INDEX incidents_status_idx ON incidents(status);
CREATE INDEX incidents_priority_idx ON incidents(priority);
CREATE INDEX incidents_updated_at_idx ON incidents(updated_at);

CREATE INDEX resources_status_idx ON resources(status);
CREATE INDEX resources_type_idx ON resources(type);

CREATE INDEX facilities_status_idx ON facilities(status);
CREATE INDEX facilities_type_idx ON facilities(type);

CREATE INDEX routes_status_idx ON routes(status);

CREATE INDEX response_plans_incident_id_idx ON response_plans(incident_id);
CREATE INDEX response_plans_status_idx ON response_plans(status);
CREATE INDEX response_plans_state_version_idx ON response_plans(state_version);

CREATE INDEX plan_actions_plan_id_idx ON plan_actions(plan_id);

CREATE INDEX state_changes_entity_idx ON state_changes(entity_type, entity_id);
CREATE INDEX state_changes_detected_at_idx ON state_changes(detected_at);

CREATE INDEX agent_runs_incident_id_idx ON agent_runs(incident_id);
CREATE INDEX agent_runs_agent_type_idx ON agent_runs(agent_type);

CREATE INDEX human_decisions_plan_id_idx ON human_decisions(plan_id);
CREATE INDEX human_decisions_incident_id_idx ON human_decisions(incident_id);

COMMIT;
