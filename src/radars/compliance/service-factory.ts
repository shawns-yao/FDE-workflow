import { LocalArtifactStore } from "../../common/artifact-store.js";
import { MemoryEventArchiveRepository } from "../../events/archive.js";
import type { EventBroker } from "../../events/broker.js";
import { EventPublisherService } from "../../events/event-publisher.js";
import { createRedisEventInfrastructure } from "../../events/redis-event-infrastructure.js";
import { ComplianceRadarEngine } from "./engine.js";
import { MemoryRadarHistoryRepository } from "./history.js";
import { createComplianceProbesFromEnv } from "./probe-factory.js";
import type { ComplianceProbe } from "./probe.js";
import { ComplianceRadarService } from "./service.js";

export interface ComplianceRadarEventInfrastructure {
  broker: EventBroker;
  close(): Promise<void>;
}

export interface ComplianceRadarRuntimeOptions {
  artifactRoot?: string;
  probes?: ComplianceProbe[];
  createEventInfrastructure?: () => ComplianceRadarEventInfrastructure;
}

export interface ComplianceRadarRuntime {
  service: ComplianceRadarService;
  eventInfrastructure: ComplianceRadarEventInfrastructure;
  close(): Promise<void>;
}

export function createComplianceRadarRuntime(options: ComplianceRadarRuntimeOptions = {}): ComplianceRadarRuntime {
  const eventInfrastructure = options.createEventInfrastructure?.() ?? createRedisEventInfrastructure();
  const service = new ComplianceRadarService(
    new ComplianceRadarEngine(options.probes ?? createComplianceProbesFromEnv()),
    new MemoryRadarHistoryRepository(),
    new EventPublisherService(eventInfrastructure.broker, new MemoryEventArchiveRepository()),
    new LocalArtifactStore(options.artifactRoot ?? ".")
  );

  return {
    service,
    eventInfrastructure,
    async close() {
      await eventInfrastructure.close();
    }
  };
}
