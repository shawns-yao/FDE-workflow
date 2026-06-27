import type { Server } from "node:http";
import { loadFdeRuntimeConfig } from "../config/env.js";
import type { Environment } from "../common/contracts.js";
import { createId } from "../common/ids.js";
import { LocalArtifactStore, type ArtifactStore } from "../common/artifact-store.js";
import { CollaborationEventConsumer } from "../agents/collaboration/collaboration-event-consumer.js";
import { MemoryEventArchiveRepository, type EventArchiveRepository } from "../events/archive.js";
import type { EventBroker } from "../events/broker.js";
import { EventHttpHandler } from "../events/event-http-handler.js";
import { EventIngressService } from "../events/event-ingress-service.js";
import { EventPublisherService } from "../events/event-publisher.js";
import { EventSubscriber } from "../events/event-subscriber.js";
import { MemoryIdempotencyStore } from "../events/idempotency-store.js";
import { MemoryEventBroker } from "../events/memory-event-broker.js";
import { createRedisEventInfrastructure, type RedisEventInfrastructure } from "../events/redis-event-infrastructure.js";
import { FeishuCallbackHandler } from "../connectors/feishu/callback-handler.js";
import { createFeishuConnectorFromEnv, type FeishuConnectorEnv } from "../connectors/feishu/connector-factory.js";
import type { IMConnectorService } from "../connectors/feishu/connector.js";
import type { FeishuAction, FeishuMention, FeishuMode, FeishuTargetType, SendCardResult } from "../connectors/feishu/types.js";
import { FeishuLongConnectionClient, type FeishuLongConnectionClientLike } from "../connectors/feishu/long-connection-client.js";
import { loadZhMessages, type ZhMessages } from "../i18n/messages.js";
import { createFdeHttpServer, type FdeReadinessState } from "./fde-http-server.js";

export type FdeEventBackend = "redis" | "memory";

export interface FdeServiceRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  broker?: EventBroker;
  archiveRepository?: EventArchiveRepository;
  feishuConnector?: IMConnectorService;
  feishuLongConnection?: FeishuLongConnectionClientLike;
  artifactStore?: ArtifactStore;
  messages?: ZhMessages;
}

export interface FdeServiceRuntime {
  server: Server;
  environment: Environment;
  event_backend: FdeEventBackend;
  config: ReturnType<typeof loadFdeRuntimeConfig>;
  feishu_event_mode: ReturnType<typeof loadFdeRuntimeConfig>["feishu"]["event_mode"];
  startFeishuEventIngress(): Promise<void>;
  sendFeishuTextMessage(message?: string): Promise<SendCardResult>;
  close(): Promise<void>;
}

export function createFdeServiceRuntime(options: FdeServiceRuntimeOptions = {}): FdeServiceRuntime {
  const env = options.env ?? process.env;
  const runtimeConfig = loadFdeRuntimeConfig(env);
  const environment = runtimeConfig.environment;
  const eventBackend = runtimeConfig.event_backend;
  const redisInfrastructure = options.broker ? undefined : createEventInfrastructure(eventBackend, env);
  const broker = options.broker ?? redisInfrastructure?.broker ?? new MemoryEventBroker();
  const idempotencyStore = redisInfrastructure?.idempotencyStore ?? new MemoryIdempotencyStore();
  const archiveRepository = options.archiveRepository ?? new MemoryEventArchiveRepository();
  const eventPublisher = new EventPublisherService(broker, archiveRepository);
  const feishuConnector = options.feishuConnector ?? createFeishuConnectorFromEnv(env as FeishuConnectorEnv);
  const messages = options.messages ?? loadZhMessages();
  const ingress = new EventIngressService(eventPublisher, {
    gitlabToken: env.GITLAB_WEBHOOK_TOKEN,
    tektonReportToken: env.TEKTON_REPORT_TOKEN,
    argocdToken: env.ARGOCD_WEBHOOK_TOKEN
  });
  const feishuCallback = new FeishuCallbackHandler(
    feishuConnector,
    eventPublisher,
    {
      verificationToken: env.FEISHU_CALLBACK_VERIFICATION_TOKEN,
      signingSecret: env.FEISHU_CALLBACK_SIGNING_SECRET ?? env.FEISHU_CALLBACK_ENCRYPT_KEY
    }
  );
  const eventHandler = new EventHttpHandler({
    ingress,
    feishuCallback
  });
  const feishuLongConnection = runtimeConfig.feishu.event_mode === "websocket"
    ? options.feishuLongConnection ?? new FeishuLongConnectionClient({
      appId: env.FEISHU_APP_ID ?? "",
      appSecret: env.FEISHU_APP_SECRET ?? "",
      environment,
      eventPublisher
    })
    : undefined;
  const collaborationConsumer = new CollaborationEventConsumer(
    new EventSubscriber(broker, idempotencyStore, archiveRepository),
    feishuConnector,
    broker,
    idempotencyStore,
    {
      escalationTarget: readEscalationTargetFromEnv(env),
      artifactStore: readCollaborationProgressArtifactStore(env, options.artifactStore)
    }
  );
  let collaborationConsumerStarted = false;
  const server = createFdeHttpServer({
    environment,
    eventHandler,
    maxBodyBytes: runtimeConfig.http.max_body_bytes,
    requestTimeoutMs: runtimeConfig.http.request_timeout_ms,
    readyCheck: createReadinessCheck(runtimeConfig, redisInfrastructure)
  });

  return {
    server,
    environment,
    config: runtimeConfig,
    event_backend: options.broker ? "memory" : eventBackend,
    feishu_event_mode: runtimeConfig.feishu.event_mode,
    async startFeishuEventIngress() {
      if (!collaborationConsumerStarted) {
        await collaborationConsumer.start();
        collaborationConsumerStarted = true;
      }
      await feishuLongConnection?.start();
    },
    async sendFeishuTextMessage(message) {
      const startupMessage = message ?? messages.feishu.startup.deployment_test;
      const targetId = env.FEISHU_STARTUP_MESSAGE_CHAT_ID ?? env.FEISHU_TEST_CHAT_ID ?? env.FEISHU_DEFAULT_CHAT_ID;
      if (!targetId) {
        return {
          status: "failed",
          target_id: "",
          error: {
            code: "CONFIGURATION_INVALID",
            message: "FEISHU_TEST_CHAT_ID or FEISHU_DEFAULT_CHAT_ID is not configured.",
            retryable: false,
            severity: "error",
            details: {
              missing_keys: ["FEISHU_TEST_CHAT_ID", "FEISHU_DEFAULT_CHAT_ID"]
            }
          }
        };
      }

      const mode = readFeishuMode(env);
      let mentions: FeishuMention[] | undefined;
      try {
        mentions = await readStartupMentions(env, feishuConnector, targetId);
      } catch (error) {
        return {
          status: "failed",
          target_id: targetId,
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Failed to resolve Feishu startup mentions.",
            retryable: true,
            severity: "error",
            details: {
              stage: "resolve_startup_mentions"
            }
          }
        };
      }

      return feishuConnector.sendCard({
        mode,
        target_type: "chat",
        target_id: targetId,
        card_type: "custom",
        title: "FDE Workstation",
        summary: startupMessage,
        severity: "low",
        mentions,
        actions: readStartupActions(env, mode, messages.feishu.startup),
        data: {
          message_type: "service_startup_message"
        },
        correlation_id: createId("corr"),
        trace_id: createId("trace"),
        run_id: createId("run")
      });
    },
    async close() {
      await feishuLongConnection?.close();
      await closeServer(server);
      await redisInfrastructure?.close();
    }
  };
}

function createEventInfrastructure(
  backend: FdeEventBackend,
  env: NodeJS.ProcessEnv
): RedisEventInfrastructure | undefined {
  if (backend === "memory") {
    return undefined;
  }
  return createRedisEventInfrastructure(env);
}

function readFeishuMode(env: NodeJS.ProcessEnv): FeishuMode {
  return env.FEISHU_MODE === "webhook_bot" ? "webhook_bot" : "openapi_bot";
}

function readEscalationTargetFromEnv(env: NodeJS.ProcessEnv): { target_type: FeishuTargetType; target_id: string } | undefined {
  const targetId = env.FEISHU_ESCALATION_TARGET_ID?.trim();
  if (!targetId) {
    return undefined;
  }
  return {
    target_type: readFeishuTargetType(env.FEISHU_ESCALATION_TARGET_TYPE),
    target_id: targetId
  };
}

function readCollaborationProgressArtifactStore(env: NodeJS.ProcessEnv, artifactStore: ArtifactStore | undefined): ArtifactStore | undefined {
  if (env.FDE_COLLABORATION_PROGRESS_ARTIFACTS_ENABLED !== "true") {
    return undefined;
  }
  return artifactStore ?? new LocalArtifactStore(env.FDE_ARTIFACT_ROOT?.trim() || ".");
}

function readFeishuTargetType(value: string | undefined): FeishuTargetType {
  const normalized = value?.trim();
  if (normalized === "chat" || normalized === "group" || normalized === "user") {
    return normalized;
  }
  return "chat";
}

async function readStartupMentions(env: NodeJS.ProcessEnv, connector: IMConnectorService, targetId: string): Promise<FeishuMention[] | undefined> {
  const openIds = splitCsv(env.FEISHU_STARTUP_MENTION_OPEN_IDS).filter(isSafeMentionId);
  if (openIds.length > 0) {
    return toStartupMentions(openIds);
  }

  if (env.FEISHU_STARTUP_MENTION_FROM_CHAT_MEMBERS !== "true" || !connector.listChatMembers) {
    return undefined;
  }

  const members = await connector.listChatMembers({
    chat_id: targetId,
    limit: readStartupMentionLimit(env)
  });
  const memberOpenIds = members.map((member) => member.open_id).filter(isSafeMentionId);
  return memberOpenIds.length > 0 ? toStartupMentions(memberOpenIds) : undefined;
}

function toStartupMentions(openIds: string[]): FeishuMention[] {
  return openIds.map((id) => ({
    type: "user",
    id,
    reason: "startup_message"
  }));
}

function readStartupMentionLimit(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(env.FEISHU_STARTUP_MENTION_LIMIT ?? "1", 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(Math.max(parsed, 1), 10);
}

function readStartupActions(
  env: NodeJS.ProcessEnv,
  mode: FeishuMode,
  startupMessages: ZhMessages["feishu"]["startup"]
): FeishuAction[] | undefined {
  const actions: FeishuAction[] = [];
  const actionUrl = env.FEISHU_STARTUP_ACTION_URL?.trim();
  if (actionUrl) {
    actions.push({
      type: "open_url",
      label: startupMessages.open_url_label,
      url: actionUrl
    });
  }
  if (mode === "openapi_bot" && env.FEISHU_STARTUP_ENABLE_CALLBACK_ACTIONS === "true") {
    actions.push({
      type: "acknowledge",
      label: startupMessages.acknowledge_label,
      value: "startup_acknowledge"
    });
  }
  return actions.length > 0 ? actions : undefined;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function createReadinessCheck(
  config: ReturnType<typeof loadFdeRuntimeConfig>,
  redisInfrastructure: RedisEventInfrastructure | undefined
): (() => Promise<FdeReadinessState>) | undefined {
  if (config.event_backend !== "redis") {
    return async (): Promise<FdeReadinessState> => ({
      ready: true,
      checks: {
        event_backend: "memory"
      }
    });
  }

  return async (): Promise<FdeReadinessState> => {
    if (!redisInfrastructure) {
      return {
        ready: false,
        checks: {
          redis: "not_initialized"
        }
      };
    }

    try {
      await withTimeout(redisInfrastructure.redis.ping(), config.http.request_timeout_ms);
      return {
        ready: true,
        checks: {
          redis: "ok",
          event_backend: "redis"
        }
      };
    } catch (error) {
      return {
        ready: false,
        checks: {
          redis: error instanceof Error ? error.message : String(error),
          event_backend: "redis"
        }
      };
    }
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function isSafeMentionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/u.test(id);
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
