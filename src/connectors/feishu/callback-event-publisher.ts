import type { EventPublisherService, EventPublishResult } from "../../events/event-publisher.js";
import type { CloudEvent } from "../../events/cloudevent.js";
import type { FeishuCallbackEvent } from "./types.js";

export class FeishuCallbackEventPublisher {
  constructor(private readonly eventPublisher: EventPublisherService) {}

  async publish(callback: FeishuCallbackEvent): Promise<EventPublishResult> {
    const event: CloudEvent<FeishuCallbackEvent> = {
      specversion: "1.0",
      id: `evt-${callback.message_id}-${Date.now()}`,
      source: "feishu",
      type: callback.type,
      subject: `message/${callback.message_id}`,
      time: new Date().toISOString(),
      datacontenttype: "application/json",
      correlation_id: callback.correlation_id,
      trace_id: callback.trace_id,
      run_id: callback.run_id,
      application: "platform",
      environment: callback.environment,
      data: callback,
      metadata: {
        adapter_version: "feishu-callback-v1"
      }
    };

    return this.eventPublisher.publish(event);
  }
}
