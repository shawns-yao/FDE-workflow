import type { EnvironmentScanRequest, RadarTarget, RadarTargetResult } from "./types.js";

export interface ComplianceProbe {
  readonly target: RadarTarget;
  run(request: EnvironmentScanRequest): Promise<RadarTargetResult>;
}

export class StaticComplianceProbe implements ComplianceProbe {
  constructor(
    readonly target: RadarTarget,
    private readonly result: Omit<RadarTargetResult, "name">
  ) {}

  async run(): Promise<RadarTargetResult> {
    return {
      name: this.target,
      ...this.result
    };
  }
}
