import test from "node:test";
import assert from "node:assert/strict";
import type { ArtifactRef } from "../../../src/common/contracts.js";
import type { ArtifactStore, ArtifactWriteInput } from "../../../src/common/artifact-store.js";
import type { EventBroker } from "../../../src/events/broker.js";
import type { CloudEvent } from "../../../src/events/cloudevent.js";
import type { CollaborationProgressUpdatedData } from "../../../src/agents/collaboration/collaboration-event-consumer.js";
import { CollaborationDailyReportGenerator } from "../../../src/agents/collaboration/daily-report-generator.js";

test("collaboration daily report generator writes JSON and Markdown artifacts and publishes event", async () => {
  const artifactStore = new CapturingArtifactStore();
  const broker = new CapturingBroker();
  const generator = new CollaborationDailyReportGenerator(artifactStore, broker);

  const report = await generator.generate({
    date: "2026-06-27",
    generated_at: "2026-06-27T23:59:00.000Z",
    progress_records: [
      progressRecord("om-open-001", "unread", "ntf-open-001", "artifacts/collaboration/ntf-open-001/progress-record.json"),
      progressRecord("om-escalated-001", "escalated", "ntf-escalated-001", "artifacts/collaboration/ntf-escalated-001/progress-record.json"),
      progressRecord("om-fixed-001", "fixed", "ntf-fixed-001", "artifacts/collaboration/ntf-fixed-001/progress-record.json")
    ],
    correlation_id: "corr-report-001",
    trace_id: "trace-report-001",
    run_id: "run-report-001",
    application: "fde-workstation",
    environment: "prod"
  });

  assert.equal(report.report_id, "daily-2026-06-27");
  assert.equal(report.metrics.progress_total, 3);
  assert.equal(report.metrics.fixed_total, 1);
  assert.equal(report.metrics.escalation_total, 1);
  assert.equal(report.metrics.open_item_total, 2);
  assert.equal(report.open_items.length, 2);
  assert.equal(report.open_items[0].message_id, "om-open-001");
  assert.equal(report.open_items[1].status, "escalated");

  assert.equal(artifactStore.writes.length, 2);
  assert.equal(artifactStore.writes[0].artifact_uri, "artifacts/reports/2026-06-27/daily-report.json");
  assert.equal(artifactStore.writes[0].artifact_type, "daily_report");
  assert.equal(artifactStore.writes[0].content_type, "application/json");
  assert.equal(artifactStore.writes[1].artifact_uri, "artifacts/reports/2026-06-27/daily-report.md");
  assert.equal(artifactStore.writes[1].artifact_type, "daily_report");
  assert.equal(artifactStore.writes[1].content_type, "text/markdown");

  const markdown = String(artifactStore.writes[1].content);
  assert.match(markdown, /om-open-001/);
  assert.match(markdown, /escalated/);
  assert.match(markdown, /artifacts\/collaboration\/ntf-escalated-001\/progress-record\.json/);

  assert.equal(broker.published.length, 1);
  const event = broker.published[0];
  assert.equal(event.type, "collaboration.daily_report.generated");
  assert.equal(event.subject, "daily-report/2026-06-27");
  assert.equal(event.correlation_id, "corr-report-001");
  assert.equal(event.trace_id, "trace-report-001");
  assert.equal(event.run_id, "run-report-001");
  assert.equal((event.data as { markdown_report_uri?: string }).markdown_report_uri, "artifacts/reports/2026-06-27/daily-report.md");
});

class CapturingArtifactStore implements ArtifactStore {
  readonly writes: ArtifactWriteInput[] = [];

  async write(input: ArtifactWriteInput): Promise<ArtifactRef> {
    this.writes.push(input);
    return {
      artifact_id: `artifact-${this.writes.length}`,
      artifact_uri: input.artifact_uri ?? "artifacts/reports/unscoped/daily-report.json",
      artifact_type: input.artifact_type,
      content_type: input.content_type,
      sha256: "sha256",
      size_bytes: 1,
      created_at: "2026-06-27T23:59:00.000Z"
    };
  }

  async read(): Promise<Buffer> {
    return Buffer.from("");
  }
}

class CapturingBroker implements Pick<EventBroker, "publish"> {
  readonly published: CloudEvent[] = [];

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    this.published.push(event as CloudEvent);
  }
}

function progressRecord(
  messageId: string,
  status: CollaborationProgressUpdatedData["status"],
  notificationId: string,
  artifactUri: string
): CollaborationProgressUpdatedData {
  return {
    message_id: messageId,
    notification_id: notificationId,
    status,
    updated_at: "2026-06-27T12:00:00.000Z",
    progress_record_artifact_uri: artifactUri
  };
}
