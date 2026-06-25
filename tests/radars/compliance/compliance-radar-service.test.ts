import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalArtifactStore } from "../../../src/common/artifact-store.js";
import type { ArtifactStore, ArtifactWriteInput } from "../../../src/common/artifact-store.js";
import type { ArtifactRef } from "../../../src/common/contracts.js";
import { MemoryEventArchiveRepository } from "../../../src/events/archive.js";
import { MemoryEventBroker } from "../../../src/events/memory-event-broker.js";
import { EventPublisherService } from "../../../src/events/event-publisher.js";
import { ComplianceRadarEngine } from "../../../src/radars/compliance/engine.js";
import { MemoryRadarHistoryRepository } from "../../../src/radars/compliance/history.js";
import { StaticComplianceProbe } from "../../../src/radars/compliance/probe.js";
import { ComplianceRadarService } from "../../../src/radars/compliance/service.js";
import type { EnvironmentScanRequest } from "../../../src/radars/compliance/types.js";

test("compliance radar writes JSON and Markdown reports before publishing event", async () => {
  const root = await mkdtemp(join(tmpdir(), "fde-radar-"));
  try {
    const artifactStore = new LocalArtifactStore(root);
    const broker = new MemoryEventBroker();
    const archive = new MemoryEventArchiveRepository();
    const publisher = new EventPublisherService(broker, archive);
    const service = new ComplianceRadarService(
      new ComplianceRadarEngine([
        new StaticComplianceProbe("gitlab", {
          status: "warning",
          checks: [
            {
              name: "gitlab-token-expiry",
              layer: "permission",
              status: "warning",
              message: "token expires in 7 days"
            }
          ]
        })
      ]),
      new MemoryRadarHistoryRepository(),
      publisher,
      artifactStore
    );

    const result = await service.scan(request);
    const jsonRef = result.artifact_refs.find((ref) => ref.content_type === "application/json");
    const markdownRef = result.artifact_refs.find((ref) => ref.content_type === "text/markdown");

    assert.ok(jsonRef);
    assert.ok(markdownRef);
    assert.equal(result.overall_status, "warning");

    const jsonReport = JSON.parse((await readFile(join(root, jsonRef.artifact_uri), "utf8"))) as { scan_id: string };
    const markdownReport = await readFile(join(root, markdownRef.artifact_uri), "utf8");

    assert.equal(jsonReport.scan_id, request.scan_id);
    assert.match(markdownReport, /Environment Scan Report/);
    assert.equal(archive.events.length, 1);
    assert.equal(archive.events[0].event.type, "compliance.environment.scan.failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compliance radar publishes execution_error event when report writing fails", async () => {
  const broker = new MemoryEventBroker();
  const archive = new MemoryEventArchiveRepository();
  const publisher = new EventPublisherService(broker, archive);
  const service = new ComplianceRadarService(
    new ComplianceRadarEngine([
      new StaticComplianceProbe("gitlab", {
        status: "healthy",
        checks: []
      })
    ]),
    new MemoryRadarHistoryRepository(),
    publisher,
    new FailingArtifactStore()
  );

  await assert.rejects(() => service.scan(request), /artifact write failed/);

  assert.equal(archive.events.length, 1);
  assert.equal(archive.events[0].event.type, "compliance.environment.scan.failed");
  assert.equal((archive.events[0].event.data as { result_kind?: string }).result_kind, "execution_error");
  assert.equal((archive.events[0].event.data as { error?: { code?: string } }).error?.code, "ARTIFACT_WRITE_FAILED");
});

class FailingArtifactStore implements ArtifactStore {
  async write(_input: ArtifactWriteInput): Promise<ArtifactRef> {
    throw new Error("artifact write failed");
  }

  async read(): Promise<Buffer> {
    return Buffer.from("");
  }
}

const request: EnvironmentScanRequest = {
  scan_id: "scan-test",
  trigger: "manual",
  environment: "dev",
  mode: "full",
  targets: ["gitlab"],
  required_layers: ["connectivity", "permission", "configuration"],
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};
