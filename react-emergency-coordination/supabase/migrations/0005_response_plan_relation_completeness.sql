BEGIN;

ALTER TABLE response_plans
  ADD COLUMN domain_relations_complete BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
