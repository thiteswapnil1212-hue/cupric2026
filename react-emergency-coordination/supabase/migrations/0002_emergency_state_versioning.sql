BEGIN;

CREATE TABLE emergency_states (
  incident_id TEXT PRIMARY KEY,
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT emergency_states_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE RESTRICT
);

INSERT INTO emergency_states (incident_id)
SELECT id
FROM incidents
ON CONFLICT (incident_id) DO NOTHING;

CREATE FUNCTION increment_emergency_state_version(p_incident_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_version INTEGER;
BEGIN
  UPDATE emergency_states
  SET state_version = state_version + 1,
      updated_at = NOW()
  WHERE incident_id = p_incident_id
  RETURNING state_version INTO next_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Emergency state version is not initialized for incident %',
      p_incident_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN next_version;
END;
$$;

COMMIT;