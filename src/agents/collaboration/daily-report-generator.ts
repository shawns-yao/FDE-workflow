import type { Environment } from "../../common/contracts.js";
import type { ArtifactStore } from "../../common/artifact-store.js";
import { createId } from "../../common/ids.js";
import type { EventBroker } from "../../events/broker.js";
import type { CloudEvent } from "../../events/cloudevent.js";
import type { CollaborationProgressStatus, CollaborationProgressUpdatedData } from "./collaboration-event-consumer.js";

export interface CollaborationDailyReportInput {
  date: string;
  generated_at: string;
  progress_records: CollaborationProgressUpdatedData[];
  correlation_id: string;
  trace_id: string;
  run_id: string;
  application: string;
  environment: Environment;
}

export interface CollaborationDailyReportData {
  report_id: string;
  date: string;
  generated_at: string;
  metrics: CollaborationDailyReportMetrics;
  open_items: CollaborationDailyReportItem[];
  markdown_report_uri: string;
  json_report_uri: string;
}

export interface CollaborationDailyReportMetrics {
  progress_total: number;
  fixed_total: number;
  escalation_total: number;
  open_item_total: number;
}

export interface CollaborationDailyReportItem {
  notification_id?: string;
  message_id: string;
  status: CollaborationProgressStatus;
  progress_record_artifact_uri?: string;
  updated_at: string;
}

export class CollaborationDailyReportGenerator {
  constructor(
    private readonly artifactStore: Pick<ArtifactStore, "write">,
    private readonly broker: Pick<EventBroker, "publish">
  ) {}

  async generate(input: CollaborationDailyReportInput): Promise<CollaborationDailyReportData> {
    const reportId = `daily-${input.date}`;
    const baseUri = `artifacts/reports/${input.date}`;
    const report: CollaborationDailyReportData = {
      report_id: reportId,
      date: input.date,
      generated_at: input.generated_at,
      metrics: toMetrics(input.progress_records),
      open_items: toOpenItems(input.progress_records),
      json_report_uri: `${baseUri}/daily-report.json`,
      markdown_report_uri: `${baseUri}/daily-report.md`
    };

    await this.artifactStore.write({
      artifact_uri: report.json_report_uri,
      artifact_type: "daily_report",
      content_type: "application/json",
      content: report,
      excerpt: `${input.date} collaboration daily report`
    });
    await this.artifactStore.write({
      artifact_uri: report.markdown_report_uri,
      artifact_type: "daily_report",
      content_type: "text/markdown",
      content: renderMarkdown(report),
      excerpt: `${input.date} collaboration daily report`
    });

    await this.broker.publish(toDailyReportGeneratedEvent(input, report));
    return report;
  }
}

function toMetrics(records: CollaborationProgressUpdatedData[]): CollaborationDailyReportMetrics {
  const fixedTotal = records.filter((record) => record.status === "fixed").length;
  const escalationTotal = records.filter((record) => record.status === "needs_escalation" || record.status === "escalated").length;
  return {
    progress_total: records.length,
    fixed_total: fixedTotal,
    escalation_total: escalationTotal,
    open_item_total: toOpenItems(records).length
  };
}

function toOpenItems(records: CollaborationProgressUpdatedData[]): CollaborationDailyReportItem[] {
  return records
    .filter((record) => record.status !== "fixed")
    .map((record) => ({
      notification_id: record.notification_id,
      message_id: record.message_id,
      status: record.status,
      progress_record_artifact_uri: record.progress_record_artifact_uri,
      updated_at: record.updated_at
    }));
}

function renderMarkdown(report: CollaborationDailyReportData): string {
  const lines = [
    `# Collaboration Daily Report ${report.date}`,
    "",
    `- Report ID: ${report.report_id}`,
    `- Generated at: ${report.generated_at}`,
    `- Progress total: ${report.metrics.progress_total}`,
    `- Fixed total: ${report.metrics.fixed_total}`,
    `- Escalation total: ${report.metrics.escalation_total}`,
    `- Open item total: ${report.metrics.open_item_total}`,
    "",
    "## Open Items",
    ""
  ];

  if (report.open_items.length === 0) {
    lines.push("No open collaboration items.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  for (const item of report.open_items) {
    lines.push(`- ${item.message_id}: ${item.status}`);
    if (item.notification_id) {
      lines.push(`  Notification: ${item.notification_id}`);
    }
    if (item.progress_record_artifact_uri) {
      lines.push(`  Artifact: ${item.progress_record_artifact_uri}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function toDailyReportGeneratedEvent(
  input: CollaborationDailyReportInput,
  report: CollaborationDailyReportData
): CloudEvent<CollaborationDailyReportData> {
  return {
    specversion: "1.0",
    id: createId("evt"),
    source: "collaboration",
    type: "collaboration.daily_report.generated",
    subject: `daily-report/${report.date}`,
    time: report.generated_at,
    datacontenttype: "application/json",
    correlation_id: input.correlation_id,
    trace_id: input.trace_id,
    run_id: input.run_id,
    application: input.application,
    environment: input.environment,
    data: report
  };
}
