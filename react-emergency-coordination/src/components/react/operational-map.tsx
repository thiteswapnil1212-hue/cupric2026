"use client";

import dynamic from "next/dynamic";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";

const LeafletOperationalMap = dynamic(
  () => import("./operational-map-leaflet"),
  {
    ssr: false,
    loading: () => (
      <div className="operational-map-loading" role="status">
        Loading operational map…
      </div>
    ),
  },
);

export type OperationalMapProps = {
  state: EmergencyState;
  activePlan: ResponsePlan | null;
  previousPlan: ResponsePlan | null;
  reassessing: boolean;
  whatIf?: {
    realState: EmergencyState;
    realPlan: ResponsePlan | null;
  } | null;
};

export default function OperationalMap(props: OperationalMapProps) {
  return <LeafletOperationalMap {...props} />;
}
