BEGIN;

ALTER TABLE plan_actions
  ADD COLUMN capacity_demand INTEGER;

ALTER TABLE plan_actions
  ADD CONSTRAINT plan_actions_capacity_demand_positive_check
  CHECK (capacity_demand IS NULL OR capacity_demand > 0);

-- Existing shelter actions are not assigned fabricated capacity values.
-- New writes must provide a demand; legacy rows require explicit correction.
ALTER TABLE plan_actions
  ADD CONSTRAINT plan_actions_shelter_capacity_demand_required_check
  CHECK (type <> 'SHELTER_PEOPLE' OR capacity_demand IS NOT NULL)
  NOT VALID;

COMMIT;
