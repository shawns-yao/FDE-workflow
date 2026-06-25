import type { ErrorObject } from "../common/contracts.js";
import { redactSensitiveFields } from "../common/redact.js";
import type { EventArchiveRepository } from "./archive.js";
import type { EventBroker } from "./broker.js";
import type { CloudEvent } from "./cloudevent.js";

export interface EventPublishResult {
  published: boolean;
  archived: boolean;
  errors: ErrorObject[];
}

export class EventPublisherService {
  constructor(
    private readonly broker: EventBroker,
    private readonly archiveRepository: EventArchiveRepository
  ) {}

  async publish<TData>(event: CloudEvent<TData>): Promise<EventPublishResult> {
    const normalizedEvent = redactSensitiveFields(event);

    const [publishResult, archiveResult] = await Promise.allSettled([
      this.broker.publish(normalizedEvent),
      this.archiveRepository.archiveEvent({
        event: normalizedEvent,
        received_at: new Date().toISOString(),
        schema_version: "cloudevent.v1"
      })
    ]);

    const errors: ErrorObject[] = [];
    if (publishResult.status === "rejected") {
      errors.push(toErrorObject("EVENT_PUBLISH_FAILED", publishResult.reason));
    }
    if (archiveResult.status === "rejected") {
      errors.push(toErrorObject("ARCHIVE_WRITE_FAILED", archiveResult.reason));
    }

    return {
      published: publishResult.status === "fulfilled",
      archived: archiveResult.status === "fulfilled",
      errors
    };
  }
}

function toErrorObject(code: "EVENT_PUBLISH_FAILED" | "ARCHIVE_WRITE_FAILED", reason: unknown): ErrorObject {
  return {
    code,
    message: reason instanceof Error ? reason.message : String(reason),
    retryable: true,
    severity: "error",
    details: {}
  };
}
