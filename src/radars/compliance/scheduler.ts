import type { ComplianceRadarService } from "./service.js";
import type { EnvironmentScanRequest } from "./types.js";

export interface SchedulerTimer {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ComplianceRadarSchedulerOptions {
  service: Pick<ComplianceRadarService, "scan">;
  request: EnvironmentScanRequest | (() => EnvironmentScanRequest);
  interval_ms: number;
  timer?: SchedulerTimer;
}

export class ComplianceRadarScheduler {
  private readonly timer: SchedulerTimer;
  private handle?: unknown;

  constructor(private readonly options: ComplianceRadarSchedulerOptions) {
    this.timer = options.timer ?? {
      setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
      clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
    };
  }

  start(): void {
    if (this.handle) {
      return;
    }
    this.handle = this.timer.setInterval(() => {
      void this.options.service.scan(this.createRequest());
    }, this.options.interval_ms);
  }

  stop(): void {
    if (!this.handle) {
      return;
    }
    this.timer.clearInterval(this.handle);
    this.handle = undefined;
  }

  private createRequest(): EnvironmentScanRequest {
    if (typeof this.options.request === "function") {
      return this.options.request();
    }
    return this.options.request;
  }
}
