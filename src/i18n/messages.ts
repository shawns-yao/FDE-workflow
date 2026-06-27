import { readFileSync } from "node:fs";

export interface ZhMessages {
  readonly feishu: {
    readonly startup: {
      readonly deployment_test: string;
      readonly open_url_label: string;
      readonly acknowledge_label: string;
    };
    readonly callback: {
      readonly invalid_json_body: string;
      readonly missing_signature_headers: string;
      readonly signature_verification_failed: string;
      readonly url_verification_token_failed: string;
    };
    readonly webhook: {
      readonly interactive_action_not_supported: string;
    };
  };
  readonly runtime: {
    readonly permissions: {
      readonly task_tools_not_allowed: string;
      readonly run_command_not_enabled: string;
      readonly command_not_allowlisted: string;
    };
    readonly run_command: {
      readonly execution_failed: string;
      readonly execution_exception: string;
    };
  };
  readonly events: {
    readonly delivery: {
      readonly consume_failed: string;
    };
    readonly ingress_auth: {
      readonly token_not_configured: string;
      readonly gitlab_token_invalid: string;
      readonly argocd_token_invalid: string;
      readonly tekton_token_invalid: string;
    };
  };
  readonly compliance: {
    readonly probe: {
      readonly missing_endpoint: string;
      readonly missing_credential: string;
    };
  };
  readonly pipeline: {
    readonly transition_reasons: {
      readonly start_updating: string;
      readonly start_syncing: string;
      readonly complete: string;
      readonly retrying: string;
    };
  };
}

const fallbackMessages: ZhMessages = {
  feishu: {
    startup: {
      deployment_test: "FDE Workstation deployment test",
      open_url_label: "Open details",
      acknowledge_label: "Acknowledge"
    },
    callback: {
      invalid_json_body: "Feishu callback body is not a valid JSON object.",
      missing_signature_headers: "Feishu callback signature headers are missing.",
      signature_verification_failed: "Feishu callback signature verification failed.",
      url_verification_token_failed: "Feishu URL verification token verification failed."
    },
    webhook: {
      interactive_action_not_supported: "webhook_bot mode does not support interactive actions."
    }
  },
  runtime: {
    permissions: {
      task_tools_not_allowed: "Runtime tool permissions do not satisfy permission_profile or environment policy.",
      run_command_not_enabled: "run_command tool is not enabled for this task.",
      command_not_allowlisted: "Command is not in the permission_profile allowlist."
    },
    run_command: {
      execution_failed: "Command execution failed with exit code: {exit_code}",
      execution_exception: "Command execution failed unexpectedly."
    }
  },
  events: {
    delivery: {
      consume_failed: "Event consumption failed."
    },
    ingress_auth: {
      token_not_configured: "Ingress authentication token is not configured.",
      gitlab_token_invalid: "GitLab webhook token verification failed.",
      argocd_token_invalid: "ArgoCD webhook token verification failed.",
      tekton_token_invalid: "Tekton report token verification failed."
    }
  },
  compliance: {
    probe: {
      missing_endpoint: "Probe endpoint is missing.",
      missing_credential: "Probe credential is missing."
    }
  },
  pipeline: {
    transition_reasons: {
      start_updating: "Start updating configuration.",
      start_syncing: "Configuration update completed, start syncing.",
      complete: "Sync succeeded.",
      retrying: "Prepare retry."
    }
  }
};

let cachedMessages: ZhMessages | undefined;

export function loadZhMessages(): ZhMessages {
  cachedMessages ??= readZhMessages();
  return cachedMessages;
}

export function formatMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/gu, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

function readZhMessages(): ZhMessages {
  try {
    const raw = readFileSync(new URL("./zh.json", import.meta.url), "utf8");
    return normalizeMessages(JSON.parse(raw) as unknown);
  } catch {
    return fallbackMessages;
  }
}

function normalizeMessages(value: unknown): ZhMessages {
  const root = isRecord(value) ? value : {};
  const feishu = isRecord(root["feishu"]) ? root["feishu"] : {};
  const startup = isRecord(feishu["startup"]) ? feishu["startup"] : {};
  const callback = isRecord(feishu["callback"]) ? feishu["callback"] : {};
  const webhook = isRecord(feishu["webhook"]) ? feishu["webhook"] : {};
  const runtime = isRecord(root["runtime"]) ? root["runtime"] : {};
  const permissions = isRecord(runtime["permissions"]) ? runtime["permissions"] : {};
  const runCommand = isRecord(runtime["run_command"]) ? runtime["run_command"] : {};
  const events = isRecord(root["events"]) ? root["events"] : {};
  const delivery = isRecord(events["delivery"]) ? events["delivery"] : {};
  const ingressAuth = isRecord(events["ingress_auth"]) ? events["ingress_auth"] : {};
  const compliance = isRecord(root["compliance"]) ? root["compliance"] : {};
  const probe = isRecord(compliance["probe"]) ? compliance["probe"] : {};
  const pipeline = isRecord(root["pipeline"]) ? root["pipeline"] : {};
  const transitionReasons = isRecord(pipeline["transition_reasons"]) ? pipeline["transition_reasons"] : {};

  return {
    feishu: {
      startup: {
        deployment_test: readMessage(startup["deployment_test"], fallbackMessages.feishu.startup.deployment_test),
        open_url_label: readMessage(startup["open_url_label"], fallbackMessages.feishu.startup.open_url_label),
        acknowledge_label: readMessage(startup["acknowledge_label"], fallbackMessages.feishu.startup.acknowledge_label)
      },
      callback: {
        invalid_json_body: readMessage(callback["invalid_json_body"], fallbackMessages.feishu.callback.invalid_json_body),
        missing_signature_headers: readMessage(callback["missing_signature_headers"], fallbackMessages.feishu.callback.missing_signature_headers),
        signature_verification_failed: readMessage(callback["signature_verification_failed"], fallbackMessages.feishu.callback.signature_verification_failed),
        url_verification_token_failed: readMessage(callback["url_verification_token_failed"], fallbackMessages.feishu.callback.url_verification_token_failed)
      },
      webhook: {
        interactive_action_not_supported: readMessage(webhook["interactive_action_not_supported"], fallbackMessages.feishu.webhook.interactive_action_not_supported)
      }
    },
    runtime: {
      permissions: {
        task_tools_not_allowed: readMessage(permissions["task_tools_not_allowed"], fallbackMessages.runtime.permissions.task_tools_not_allowed),
        run_command_not_enabled: readMessage(permissions["run_command_not_enabled"], fallbackMessages.runtime.permissions.run_command_not_enabled),
        command_not_allowlisted: readMessage(permissions["command_not_allowlisted"], fallbackMessages.runtime.permissions.command_not_allowlisted)
      },
      run_command: {
        execution_failed: readMessage(runCommand["execution_failed"], fallbackMessages.runtime.run_command.execution_failed),
        execution_exception: readMessage(runCommand["execution_exception"], fallbackMessages.runtime.run_command.execution_exception)
      }
    },
    events: {
      delivery: {
        consume_failed: readMessage(delivery["consume_failed"], fallbackMessages.events.delivery.consume_failed)
      },
      ingress_auth: {
        token_not_configured: readMessage(ingressAuth["token_not_configured"], fallbackMessages.events.ingress_auth.token_not_configured),
        gitlab_token_invalid: readMessage(ingressAuth["gitlab_token_invalid"], fallbackMessages.events.ingress_auth.gitlab_token_invalid),
        argocd_token_invalid: readMessage(ingressAuth["argocd_token_invalid"], fallbackMessages.events.ingress_auth.argocd_token_invalid),
        tekton_token_invalid: readMessage(ingressAuth["tekton_token_invalid"], fallbackMessages.events.ingress_auth.tekton_token_invalid)
      }
    },
    compliance: {
      probe: {
        missing_endpoint: readMessage(probe["missing_endpoint"], fallbackMessages.compliance.probe.missing_endpoint),
        missing_credential: readMessage(probe["missing_credential"], fallbackMessages.compliance.probe.missing_credential)
      }
    },
    pipeline: {
      transition_reasons: {
        start_updating: readMessage(transitionReasons["start_updating"], fallbackMessages.pipeline.transition_reasons.start_updating),
        start_syncing: readMessage(transitionReasons["start_syncing"], fallbackMessages.pipeline.transition_reasons.start_syncing),
        complete: readMessage(transitionReasons["complete"], fallbackMessages.pipeline.transition_reasons.complete),
        retrying: readMessage(transitionReasons["retrying"], fallbackMessages.pipeline.transition_reasons.retrying)
      }
    }
  };
}

function readMessage(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
