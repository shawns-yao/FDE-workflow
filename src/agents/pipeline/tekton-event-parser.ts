import type { Environment } from "../../common/contracts.js";
import { environments } from "../../common/contracts.js";
import type { CloudEvent } from "../../events/cloudevent.js";
import type { BuildCompletedPayload, TektonEventPayload } from "./types.js";

export function parseTektonPipelineRunCompleted(event: CloudEvent<TektonEventPayload>): BuildCompletedPayload {
  if (event.type !== "tekton.pipelinerun.completed") {
    throw new Error(`Unsupported Tekton event type: ${event.type}`);
  }

  const value = createValueReader(event.data);
  const image = value(["image", "IMAGE", "build.image"]);
  const imageName = value(["image_name", "IMAGE_NAME"]) ?? (image ? parseImage(image).imageName : undefined);
  const imageTag = value(["image_tag", "IMAGE_TAG"]) ?? (image ? parseImage(image).imageTag : undefined);
  const commitSha = value(["commit_sha", "COMMIT_SHA", "git_sha", "revision"]) ?? extractCommitSha(imageTag);
  const application = value(["application", "app", "service"]) ?? event.application;
  const environment = parseEnvironment(value(["environment", "env"]) ?? event.environment);
  const buildId = value(["build_id", "BUILD_ID"]) ?? event.data.pipelineRunName;

  if (!imageName || !imageTag) {
    throw new Error("Tekton event must include image or image_name/image_tag results");
  }
  if (!commitSha) {
    throw new Error("Tekton event must include commit_sha or a tag starting with commit_sha");
  }

  return {
    application,
    environment,
    image_name: imageName,
    image_tag: imageTag,
    build_status: event.data.status === "Succeeded" ? "succeeded" : "failed",
    build_log_uri: value(["build_log_uri", "BUILD_LOG_URI"]),
    commit_sha: commitSha,
    pipeline_run_id: event.data.pipelineRunName,
    build_id: buildId,
    trigger: parseTrigger(value(["trigger", "TRIGGER"]))
  };
}

function createValueReader(payload: TektonEventPayload): (names: string[]) => string | undefined {
  const values = new Map<string, string>();
  for (const result of payload.results ?? []) {
    values.set(result.name, result.value);
  }
  for (const [key, value] of Object.entries(payload.params ?? {})) {
    values.set(key, value);
  }
  for (const [key, value] of Object.entries(payload.labels ?? {})) {
    values.set(key, value);
  }
  for (const [key, value] of Object.entries(payload.annotations ?? {})) {
    values.set(key, value);
  }
  return (names) => {
    for (const name of names) {
      const value = values.get(name);
      if (value) {
        return value;
      }
    }
    return undefined;
  };
}

function parseImage(image: string): { imageName: string; imageTag: string } {
  const slashIndex = image.lastIndexOf("/");
  const colonIndex = image.lastIndexOf(":");
  if (colonIndex <= slashIndex) {
    throw new Error(`Image must include tag: ${image}`);
  }
  return {
    imageName: image.slice(0, colonIndex),
    imageTag: image.slice(colonIndex + 1)
  };
}

function extractCommitSha(imageTag?: string): string | undefined {
  const match = imageTag?.match(/^([a-f0-9]{7,40})(?:_|-|$)/i);
  return match?.[1];
}

function parseEnvironment(value: string): Environment {
  if ((environments as readonly string[]).includes(value)) {
    return value as Environment;
  }
  throw new Error(`Unsupported environment: ${value}`);
}

function parseTrigger(value?: string): "manual" | "webhook" | "schedule" {
  if (value === "manual" || value === "schedule") {
    return value;
  }
  return "webhook";
}
