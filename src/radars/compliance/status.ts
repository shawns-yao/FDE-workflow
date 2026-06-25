import type { RadarStatus, RadarTargetResult } from "./types.js";

export function calculateOverallStatus(targets: RadarTargetResult[]): RadarStatus {
  if (targets.some((target) => target.status === "critical")) {
    return "critical";
  }
  if (targets.some((target) => target.status === "warning")) {
    return "warning";
  }
  return "healthy";
}

export function countByStatus(targets: RadarTargetResult[], status: RadarStatus): number {
  return targets.filter((target) => target.status === status).length;
}
