import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatMessage, loadZhMessages } from "../../src/i18n/messages.js";

test("loads Feishu startup copy from zh message resource", () => {
  const messages = loadZhMessages();
  const resource = JSON.parse(readFileSync(new URL("../../src/i18n/zh.json", import.meta.url), "utf8")) as typeof messages;

  assert.equal(messages.feishu.startup.deployment_test, resource.feishu.startup.deployment_test);
  assert.equal(messages.feishu.startup.open_url_label, resource.feishu.startup.open_url_label);
  assert.equal(messages.feishu.startup.acknowledge_label, resource.feishu.startup.acknowledge_label);
  assert.equal(messages.runtime.permissions.task_tools_not_allowed, resource.runtime.permissions.task_tools_not_allowed);
  assert.equal(messages.events.ingress_auth.gitlab_token_invalid, resource.events.ingress_auth.gitlab_token_invalid);
  assert.equal(messages.pipeline.transition_reasons.start_updating, resource.pipeline.transition_reasons.start_updating);
  assert.equal(
    formatMessage(messages.runtime.run_command.execution_failed, { exit_code: 2 }),
    resource.runtime.run_command.execution_failed.replace("{exit_code}", "2")
  );
});
