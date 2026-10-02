import {
  FacilityStatusSchema,
  type Facility,
  type FacilityStatus,
} from "../../domain/facility/schema";

export type FacilityEngineErrorCode =
  | "FACILITY_NOT_FOUND"
  | "FACILITY_NOT_AVAILABLE"
  | "INVALID_CAPACITY_REQUEST"
  | "INSUFFICIENT_CAPACITY"
  | "FACILITY_CAPACITY_INCONSISTENT"
  | "CAPACITY_RELEASE_EXCEEDS_TOTAL"
  | "FACILITY_INVALID_STATUS"
  | "INVALID_FACILITY_STATUS_TRANSITION";

export type FacilityEngineIssue = {
  code: FacilityEngineErrorCode;
  message: string;
  facilityId: string | null;
  requestedAmount: number | null;
};

export type FacilityValidationResult = {
  valid: boolean;
  errors: readonly FacilityEngineIssue[];
  warnings: readonly FacilityEngineIssue[];
};

export type FacilityOperationResult = FacilityValidationResult & {
  facility: Facility | null;
};

const allowedStatusTransitions: Readonly<
  Record<FacilityStatus, readonly FacilityStatus[]>
> = {
  OPERATIONAL: ["LIMITED", "FULL", "CLOSED", "UNAVAILABLE"],
  LIMITED: ["OPERATIONAL", "FULL", "CLOSED", "UNAVAILABLE"],
  FULL: ["OPERATIONAL", "LIMITED", "CLOSED", "UNAVAILABLE"],
  CLOSED: ["OPERATIONAL", "UNAVAILABLE"],
  UNAVAILABLE: ["OPERATIONAL", "CLOSED"],
};

export function findFacility(
  facilities: readonly Facility[],
  facilityId: string,
): Facility | null {
  return facilities.find((facility) => facility.id === facilityId) ?? null;
}

export function isFacilityAvailable(facility: Facility): boolean {
  return facility.status === "OPERATIONAL" || facility.status === "LIMITED";
}

function createIssue(
  code: FacilityEngineErrorCode,
  message: string,
  facilityId: string | null = null,
  requestedAmount: number | null = null,
): FacilityEngineIssue {
  return { code, message, facilityId, requestedAmount };
}

function createValidationResult(
  errors: readonly FacilityEngineIssue[],
): FacilityValidationResult {
  return { valid: errors.length === 0, errors, warnings: [] };
}

function createOperationResult(
  errors: readonly FacilityEngineIssue[],
  facility: Facility | null = null,
): FacilityOperationResult {
  return { valid: errors.length === 0, errors, warnings: [], facility };
}

export function validateFacilityStatus(
  facility: Facility,
): FacilityValidationResult {
  if (FacilityStatusSchema.safeParse(facility.status).success) {
    return createValidationResult([]);
  }

  return createValidationResult([
    createIssue(
      "FACILITY_INVALID_STATUS",
      `Facility ${facility.id} has an unsupported status.`,
      facility.id,
    ),
  ]);
}

function isValidCapacityCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function getCapacityConsistencyIssue(
  facility: Facility,
): FacilityEngineIssue | null {
  if (
    !isValidCapacityCount(facility.totalCapacity) ||
    !isValidCapacityCount(facility.availableCapacity) ||
    facility.availableCapacity > facility.totalCapacity
  ) {
    return createIssue(
      "FACILITY_CAPACITY_INCONSISTENT",
      "Facility capacities must be nonnegative safe integers and availableCapacity must not exceed totalCapacity.",
      facility.id,
    );
  }
  return null;
}

function getAllocationErrors(
  facility: Facility,
  amount: number,
): FacilityEngineIssue[] {
  const errors: FacilityEngineIssue[] = [];
  const statusValidation = validateFacilityStatus(facility);
  errors.push(...statusValidation.errors);

  const capacityIssue = getCapacityConsistencyIssue(facility);
  if (capacityIssue !== null) errors.push(capacityIssue);

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    errors.push(
      createIssue(
        "INVALID_CAPACITY_REQUEST",
        "Requested capacity must be a positive safe integer.",
        facility.id,
        amount,
      ),
    );
  }

  if (!isFacilityAvailable(facility)) {
    errors.push(
      createIssue(
        "FACILITY_NOT_AVAILABLE",
        `Facility ${facility.id} with status ${facility.status} cannot accept capacity.`,
        facility.id,
        amount,
      ),
    );
  }

  if (
    capacityIssue === null &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    amount > facility.availableCapacity
  ) {
    errors.push(
      createIssue(
        "INSUFFICIENT_CAPACITY",
        `Facility ${facility.id} has ${facility.availableCapacity} available capacity; ${amount} requested.`,
        facility.id,
        amount,
      ),
    );
  }

  return errors;
}

export function validateFacilityCapacityAllocation(
  facilities: readonly Facility[],
  facilityId: string,
  amount: number,
): FacilityValidationResult {
  const facility = findFacility(facilities, facilityId);
  if (facility === null) {
    return createValidationResult([
      createIssue(
        "FACILITY_NOT_FOUND",
        `Facility ${facilityId} was not found.`,
        facilityId,
        amount,
      ),
    ]);
  }

  return createValidationResult(getAllocationErrors(facility, amount));
}

export function allocateFacilityCapacity(
  facility: Facility,
  amount: number,
): FacilityOperationResult {
  const errors = getAllocationErrors(facility, amount);
  if (errors.length > 0) return createOperationResult(errors);

  return createOperationResult([], {
    ...facility,
    availableCapacity: facility.availableCapacity - amount,
  });
}

export function releaseFacilityCapacity(
  facility: Facility,
  amount: number,
): FacilityOperationResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return createOperationResult([
      createIssue(
        "INVALID_CAPACITY_REQUEST",
        "Released capacity must be a positive safe integer.",
        facility.id,
        amount,
      ),
    ]);
  }

  const capacityIssue = getCapacityConsistencyIssue(facility);
  if (capacityIssue !== null) {
    return createOperationResult([capacityIssue]);
  }

  if (amount > facility.totalCapacity - facility.availableCapacity) {
    return createOperationResult([
      createIssue(
        "CAPACITY_RELEASE_EXCEEDS_TOTAL",
        `Releasing ${amount} capacity would exceed facility ${facility.id} totalCapacity.`,
        facility.id,
        amount,
      ),
    ]);
  }

  return createOperationResult([], {
    ...facility,
    availableCapacity: facility.availableCapacity + amount,
  });
}

export function transitionFacilityStatus(
  facility: Facility,
  nextStatus: FacilityStatus,
): FacilityOperationResult {
  const currentStatusIsValid = FacilityStatusSchema.safeParse(
    facility.status,
  ).success;
  const nextStatusIsValid = FacilityStatusSchema.safeParse(nextStatus).success;

  if (!currentStatusIsValid || !nextStatusIsValid) {
    return createOperationResult([
      createIssue(
        "FACILITY_INVALID_STATUS",
        "Facility status transition requires supported current and next statuses.",
        facility.id,
      ),
    ]);
  }

  if (!allowedStatusTransitions[facility.status].includes(nextStatus)) {
    return createOperationResult([
      createIssue(
        "INVALID_FACILITY_STATUS_TRANSITION",
        `Facility status cannot transition from ${facility.status} to ${nextStatus}.`,
        facility.id,
      ),
    ]);
  }

  return createOperationResult([], { ...facility, status: nextStatus });
}
