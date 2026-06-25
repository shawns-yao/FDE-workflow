import type { EventSubscriber } from "../../events/event-subscriber.js";
import type { PipelineAgent } from "./pipeline-agent.js";
import type { TektonEventPayload } from "./types.js";

export interface PipelineEventConsumerOptions {
  consumer_id?: string;
  queue_name?: string;
  max_attempts?: number;
}

export class PipelineEventConsumer {
  constructor(
    private readonly subscriber: Pick<EventSubscriber, "subscribe">,
    private readonly agent: Pick<PipelineAgent, "handleTektonPipelineRunCompleted">,
    private readonly options: PipelineEventConsumerOptions = {}
  ) {}

  async start(): Promise<void> {
    await this.subscriber.subscribe<TektonEventPayload>(
      ["tekton.pipelinerun.completed"],
      async (event) => {
        await this.agent.handleTektonPipelineRunCompleted(event);
      },
      {
        consumer_id: this.options.consumer_id ?? "pipeline-agent",
        queue_name: this.options.queue_name ?? "agent.pipeline",
        max_attempts: this.options.max_attempts ?? 3
      }
    );
  }
}
