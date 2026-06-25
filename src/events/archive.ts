import type { ErrorObject } from "../common/contracts.js";
import type { CloudEvent } from "./cloudevent.js";

export interface EventArchiveRecord<TData = unknown> {
  event: CloudEvent<TData>;
  received_at: string;
  raw_payload_artifact_uri?: string;
  schema_version?: string;
}

export interface EventDeliveryRecord {
  delivery_id: string;
  event_id: string;
  consumer_id: string;
  queue_name: string;
  status: "processing" | "processed" | "failed";
  attempt_count: number;
  first_attempt_at: string;
  last_attempt_at: string;
  next_retry_at?: string;
  error?: ErrorObject;
}

export interface DeadLetterEventRecord<TData = unknown> {
  event: CloudEvent<TData>;
  consumer_id: string;
  queue_name: string;
  failed_at: string;
  reason_code: string;
  error: ErrorObject;
  raw_event_artifact_uri?: string;
}

export interface EventArchiveRepository {
  archiveEvent<TData>(record: EventArchiveRecord<TData>): Promise<void>;
  recordDelivery(record: EventDeliveryRecord): Promise<void>;
  recordDeadLetter<TData>(record: DeadLetterEventRecord<TData>): Promise<void>;
}

export class MemoryEventArchiveRepository implements EventArchiveRepository {
  readonly events: EventArchiveRecord[] = [];
  readonly deliveries: EventDeliveryRecord[] = [];
  readonly deadLetters: DeadLetterEventRecord[] = [];

  async archiveEvent<TData>(record: EventArchiveRecord<TData>): Promise<void> {
    this.events.push(record as EventArchiveRecord);
  }

  async recordDelivery(record: EventDeliveryRecord): Promise<void> {
    this.deliveries.push(record);
  }

  async recordDeadLetter<TData>(record: DeadLetterEventRecord<TData>): Promise<void> {
    this.deadLetters.push(record as DeadLetterEventRecord);
  }
}
