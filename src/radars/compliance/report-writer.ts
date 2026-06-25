import type { ArtifactStore } from "../../common/artifact-store.js";
import type { ArtifactRef } from "../../common/contracts.js";
import type { EnvironmentScanResult } from "./types.js";

export class ComplianceReportWriter {
  constructor(private readonly artifactStore: ArtifactStore) {}

  async write(result: EnvironmentScanResult): Promise<ArtifactRef[]> {
    const baseUri = `artifacts/compliance/${result.scan_id}`;
    const jsonRef = await this.artifactStore.write({
      artifact_uri: `${baseUri}/environment-check-report.json`,
      artifact_type: "environment_check_report",
      content_type: "application/json",
      content: result,
      excerpt: `${result.environment} environment scan ${result.overall_status}`
    });
    const markdownRef = await this.artifactStore.write({
      artifact_uri: `${baseUri}/environment-check-report.md`,
      artifact_type: "environment_check_report",
      content_type: "text/markdown",
      content: renderMarkdown(result),
      excerpt: `${result.environment} environment scan ${result.overall_status}`
    });

    return [jsonRef, markdownRef];
  }
}

function renderMarkdown(result: EnvironmentScanResult): string {
  const lines = [
    "# Environment Scan Report",
    "",
    `- Scan ID: ${result.scan_id}`,
    `- Environment: ${result.environment}`,
    `- Trigger: ${result.trigger}`,
    `- Mode: ${result.mode}`,
    `- Overall status: ${result.overall_status}`,
    `- Started at: ${result.started_at}`,
    `- Finished at: ${result.finished_at}`,
    "",
    "## Targets",
    ""
  ];

  for (const target of result.targets) {
    lines.push(`### ${target.name}`);
    lines.push("");
    lines.push(`Status: ${target.status}`);
    lines.push("");
    for (const check of target.checks) {
      lines.push(`- ${check.layer}/${check.name}: ${check.status} - ${check.message}`);
      if (check.recommendation) {
        lines.push(`  Recommendation: ${check.recommendation}`);
      }
    }
    lines.push("");
  }

  if (result.metadata.pending_checks.length > 0) {
    lines.push("## Pending Checks");
    lines.push("");
    for (const check of result.metadata.pending_checks) {
      lines.push(`- ${check}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
