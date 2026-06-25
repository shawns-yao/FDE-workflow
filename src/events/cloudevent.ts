import type { ArtifactRef, BaseMetadata, Environment } from "../common/contracts.js";
import type { EventSource, EventType } from "./event-types.js";

export interface CloudEvent<TData = unknown> {
  specversion: "1.0";
  id: string;
  source: EventSource;
  type: EventType;
  subject: string;
  time: string;
  datacontenttype: "application/json";
  correlation_id: string;
  trace_id: string;
  run_id: string;
  application: string;
  environment: Environment;
  data: TData;
  metadata?: BaseMetadata;
}

export interface EventDataWithArtifacts {
  artifact_refs?: ArtifactRef[];
}
