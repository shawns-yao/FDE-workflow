import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLocalEnv } from "../../src/common/load-env.js";

test("loadLocalEnv loads .env values without overriding existing env", () => {
  const dir = mkdtempSync(join(tmpdir(), "fde-env-"));
  try {
    const env: NodeJS.ProcessEnv = {
      FEISHU_APP_ID: "existing"
    };
    const path = join(dir, ".env");
    writeFileSync(path, [
      "FEISHU_APP_ID=from-file",
      "FEISHU_APP_SECRET=secret-value",
      "FEISHU_TEST_CHAT_ID=\"oc_test\"",
      "# ignored comment"
    ].join("\n"), "utf8");

    loadLocalEnv({ path, env });

    assert.equal(env.FEISHU_APP_ID, "existing");
    assert.equal(env.FEISHU_APP_SECRET, "secret-value");
    assert.equal(env.FEISHU_TEST_CHAT_ID, "oc_test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
