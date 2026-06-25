import { LocalArtifactStore, type ArtifactStore } from "../../common/artifact-store.js";
import { MemoryEventArchiveRepository, type EventArchiveRepository } from "../../events/archive.js";
import type { EventBroker } from "../../events/broker.js";
import { EventSubscriber } from "../../events/event-subscriber.js";
import { type IdempotencyStore } from "../../events/idempotency-store.js";
import { createRedisEventInfrastructure } from "../../events/redis-event-infrastructure.js";
import { createComplianceRadarRuntime, type ComplianceRadarRuntime } from "../../radars/compliance/service-factory.js";
import { PolicyCheckedAgentRuntime, type AgentRuntime } from "../../runtime/agent-runtime.js";
import type { AnthropicMessagesClient } from "../../runtime/adapters/anthropic/messages-client.js";
import { createAnthropicMessagesClientFromEnv } from "../../runtime/adapters/anthropic/messages-client.js";
import { createCodeRuntimeExecutor } from "../../runtime/executors/code-runtime/code-task-executor.js";
import { createBuiltinToolProvider } from "../../runtime/tools/builtin-tool-provider.js";
import { createRuntimeMcpToolProvidersFromEnv } from "../../runtime/tools/mcp/runtime-mcp-config.js";
import { ComplianceRadarPreflightChecker, type PipelinePreflightChecker } from "./compliance-preflight.js";
import { GitOperations } from "./git-operations.js";
import { GitOpsYamlUpdater } from "./gitops-yaml-updater.js";
import { PipelineAgent, type PipelineAgentDependencies } from "./pipeline-agent.js";
import { PipelineEventConsumer, type PipelineEventConsumerOptions } from "./pipeline-event-consumer.js";
import { HttpArgoCdSyncController, type ArgoCdSyncController } from "./argocd-sync-controller.js";
import { loadPipelineConfig } from "./config.js";
import type { PipelineAgentConfig } from "./types.js";

export interface PipelineEventInfrastructure {
  broker: EventBroker;
  idempotencyStore: IdempotencyStore;
  close(): Promise<void>;
}

export interface PipelineAgentWorkerOptions {
  config?: PipelineAgentConfig;
  archiveRepository?: EventArchiveRepository;
  runtime?: AgentRuntime;
  createEventInfrastructure?: () => PipelineEventInfrastructure;
  gitOperations?: PipelineAgentDependencies["gitOperations"];
  yamlUpdater?: PipelineAgentDependencies["yamlUpdater"];
  artifactStore?: ArtifactStore;
  anthropicClient?: AnthropicMessagesClient;
  preflightChecker?: PipelinePreflightChecker;
  argoCdSyncController?: ArgoCdSyncController;
  consumer?: PipelineEventConsumerOptions;
}

export interface PipelineAgentWorker {
  agent: PipelineAgent;
  consumer: PipelineEventConsumer;
  eventInfrastructure: PipelineEventInfrastructure;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function createPipelineAgentWorker(options: PipelineAgentWorkerOptions = {}): PipelineAgentWorker {
  const config = options.config ?? loadPipelineConfig();
  const eventInfrastructure = options.createEventInfrastructure?.() ?? createRedisEventInfrastructure();
  const archiveRepository = options.archiveRepository ?? new MemoryEventArchiveRepository();
  const artifactStore = options.artifactStore ?? new LocalArtifactStore(".");
  const complianceRuntime = createComplianceRuntimeIfNeeded(config, eventInfrastructure, options.preflightChecker);
  const preflightChecker = options.preflightChecker ??
    (complianceRuntime ? new ComplianceRadarPreflightChecker(complianceRuntime.service) : undefined);
  const argoCdSyncController = options.argoCdSyncController ??
    (config.enable_argocd_sync ? new HttpArgoCdSyncController(config) : undefined);
  const runtime = options.runtime ?? createPipelineRuntimeIfNeeded(config, artifactStore, options.anthropicClient);
  const subscriber = new EventSubscriber(
    eventInfrastructure.broker,
    eventInfrastructure.idempotencyStore,
    archiveRepository
  );
  const agent = new PipelineAgent({
    config,
    broker: eventInfrastructure.broker,
    idempotencyStore: eventInfrastructure.idempotencyStore,
    gitOperations: options.gitOperations ?? new GitOperations(config),
    yamlUpdater: options.yamlUpdater ?? new GitOpsYamlUpdater(config, artifactStore),
    preflightChecker,
    argoCdSyncController,
    runtime
  });
  const consumer = new PipelineEventConsumer(subscriber, agent, options.consumer);

  return {
    agent,
    consumer,
    eventInfrastructure,
    async start() {
      await consumer.start();
    },
    async close() {
      await complianceRuntime?.close();
      await eventInfrastructure.close();
    }
  };
}

function createPipelineRuntimeIfNeeded(
  config: PipelineAgentConfig,
  artifactStore: ArtifactStore,
  clientOverride?: AnthropicMessagesClient
): AgentRuntime | undefined {
  if (!config.enable_yaml_governance && !config.enable_build_fix) {
    return undefined;
  }

  const client = clientOverride ?? createAnthropicMessagesClientFromEnv();
  if (!client) {
    return new PolicyCheckedAgentRuntime();
  }

  const codeRuntimeExecutor = createCodeRuntimeExecutor({
    client,
    artifactStore,
    toolProviders: [
      createBuiltinToolProvider(),
      ...createRuntimeMcpToolProvidersFromEnv()
    ]
  });

  return new PolicyCheckedAgentRuntime({
    "code_runtime:code_task": codeRuntimeExecutor,
    "code_runtime:repair_task": codeRuntimeExecutor
  });
}

function createComplianceRuntimeIfNeeded(
  config: PipelineAgentConfig,
  eventInfrastructure: PipelineEventInfrastructure,
  preflightChecker?: PipelinePreflightChecker
): ComplianceRadarRuntime | undefined {
  if (!config.enable_compliance_preflight || preflightChecker) {
    return undefined;
  }

  return createComplianceRadarRuntime({
    createEventInfrastructure: () => ({
      broker: eventInfrastructure.broker,
      async close() {}
    })
  });
}
