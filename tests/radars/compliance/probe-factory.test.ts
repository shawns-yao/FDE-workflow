import test from "node:test";
import assert from "node:assert/strict";
import { createComplianceProbesFromEnv } from "../../../src/radars/compliance/probe-factory.js";

test("creates all compliance HTTP probes from environment", () => {
  const probes = createComplianceProbesFromEnv({
    GITLAB_BASE_URL: "https://gitlab.example.com",
    GITLAB_TOKEN: "gitlab-token",
    TEKTON_API_BASE_URL: "https://k8s.example.com",
    TEKTON_TOKEN: "tekton-token",
    ARGOCD_BASE_URL: "https://argocd.example.com",
    ARGOCD_TOKEN: "argocd-token",
    KUBERNETES_API_BASE_URL: "https://k8s.example.com",
    KUBERNETES_TOKEN: "k8s-token"
  });

  assert.deepEqual(
    probes.map((probe) => probe.target),
    ["gitlab", "tekton", "argocd", "kubernetes"]
  );
});
