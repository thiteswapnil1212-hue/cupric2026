BEGIN;

INSERT INTO incidents (
  id,
  title,
  description,
  type,
  status,
  severity,
  priority,
  latitude,
  longitude,
  address,
  affected_population,
  hazards,
  reported_at,
  updated_at,
  created_at
)
VALUES (
  'incident-demo-001',
  'Central Plaza Building Fire',
  'Multi-floor building fire requiring coordinated rescue, medical transport, and hospital capacity management.',
  'FIRE',
  'ACTIVE',
  'CRITICAL',
  'URGENT',
  18.5204,
  73.8567,
  'Central Plaza, Pune',
  35,
  '["smoke", "structural instability", "blocked access"]'::JSONB,
  '2026-10-02T09:00:00Z',
  '2026-10-02T09:00:00Z',
  '2026-10-02T09:00:00Z'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  type = EXCLUDED.type,
  status = EXCLUDED.status,
  severity = EXCLUDED.severity,
  priority = EXCLUDED.priority,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  address = EXCLUDED.address,
  affected_population = EXCLUDED.affected_population,
  hazards = EXCLUDED.hazards,
  reported_at = EXCLUDED.reported_at,
  updated_at = EXCLUDED.updated_at,
  created_at = EXCLUDED.created_at;

-- Migration 0002 only initializes incidents that exist when it is applied.
INSERT INTO emergency_states (incident_id)
VALUES ('incident-demo-001')
ON CONFLICT (incident_id) DO NOTHING;

INSERT INTO resources (
  id,
  name,
  type,
  status,
  latitude,
  longitude,
  capacity,
  current_assignment_id,
  capabilities,
  updated_at,
  created_at
)
VALUES
  (
    'resource-rescue-001',
    'Rescue Team Alpha',
    'RESCUE_TEAM',
    'AVAILABLE',
    18.5210,
    73.8562,
    12,
    NULL,
    '["building_rescue", "evacuation"]'::JSONB,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  ),
  (
    'resource-rescue-002',
    'Rescue Team Bravo',
    'RESCUE_TEAM',
    'AVAILABLE',
    18.5195,
    73.8571,
    10,
    NULL,
    '["building_rescue", "search"]'::JSONB,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  ),
  (
    'resource-ambulance-001',
    'Ambulance 01',
    'AMBULANCE',
    'AVAILABLE',
    18.5220,
    73.8555,
    4,
    NULL,
    '["patient_transport", "basic_life_support"]'::JSONB,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  ),
  (
    'resource-ambulance-002',
    'Ambulance 02',
    'AMBULANCE',
    'AVAILABLE',
    18.5189,
    73.8560,
    4,
    NULL,
    '["patient_transport", "basic_life_support"]'::JSONB,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  ),
  (
    'resource-fire-001',
    'Fire Unit 01',
    'FIRE_UNIT',
    'AVAILABLE',
    18.5200,
    73.8580,
    6,
    NULL,
    '["fire_suppression", "rescue_support"]'::JSONB,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  status = EXCLUDED.status,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  capacity = EXCLUDED.capacity,
  current_assignment_id = EXCLUDED.current_assignment_id,
  capabilities = EXCLUDED.capabilities,
  updated_at = EXCLUDED.updated_at,
  created_at = EXCLUDED.created_at;

INSERT INTO facilities (
  id,
  name,
  type,
  status,
  latitude,
  longitude,
  address,
  total_capacity,
  available_capacity,
  capabilities,
  updated_at,
  created_at
)
VALUES
  (
    'facility-hospital-001',
    'City General Hospital',
    'HOSPITAL',
    'OPERATIONAL',
    18.5140,
    73.8510,
    'City General Hospital, Pune',
    20,
    20,
    '["emergency", "trauma"]'::JSONB,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  ),
  (
    'facility-hospital-002',
    'Metro Care Hospital',
    'HOSPITAL',
    'OPERATIONAL',
    18.5290,
    73.8620,
    'Metro Care Hospital, Pune',
    10,
    10,
    '["emergency", "general"]'::JSONB,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  status = EXCLUDED.status,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  address = EXCLUDED.address,
  total_capacity = EXCLUDED.total_capacity,
  available_capacity = EXCLUDED.available_capacity,
  capabilities = EXCLUDED.capabilities,
  updated_at = EXCLUDED.updated_at,
  created_at = EXCLUDED.created_at;

-- All three routes start open; later simulation changes route-001.
INSERT INTO routes (
  id,
  name,
  status,
  distance_km,
  estimated_travel_minutes,
  origin_latitude,
  origin_longitude,
  destination_latitude,
  destination_longitude,
  blocked_reason,
  updated_at,
  created_at
)
VALUES
  (
    'route-001',
    'Main Road',
    'OPEN',
    2.4,
    6,
    18.5204,
    73.8567,
    18.5140,
    73.8510,
    NULL,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  ),
  (
    'route-002',
    'Market Road',
    'OPEN',
    3.1,
    8,
    18.5204,
    73.8567,
    18.5290,
    73.8620,
    NULL,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  ),
  (
    'route-003',
    'Service Lane',
    'OPEN',
    4.2,
    11,
    18.5204,
    73.8567,
    18.5140,
    73.8510,
    NULL,
    '2026-10-02T09:00:00Z',
    '2026-10-02T09:00:00Z'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  distance_km = EXCLUDED.distance_km,
  estimated_travel_minutes = EXCLUDED.estimated_travel_minutes,
  origin_latitude = EXCLUDED.origin_latitude,
  origin_longitude = EXCLUDED.origin_longitude,
  destination_latitude = EXCLUDED.destination_latitude,
  destination_longitude = EXCLUDED.destination_longitude,
  blocked_reason = EXCLUDED.blocked_reason,
  updated_at = EXCLUDED.updated_at,
  created_at = EXCLUDED.created_at;

COMMIT;
