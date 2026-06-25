export const eventTypes = [
  "compliance.environment.scan.requested",
  "compliance.environment.scan.completed",
  "compliance.environment.scan.failed",
  "gitlab.mr.created",
  "gitlab.mr.updated",
  "gitlab.mr.comment.created",
  "gitlab.mr.merged",
  "gitlab.pipeline.completed",
  "tekton.pipelinerun.started",
  "tekton.pipelinerun.completed",
  "tekton.taskrun.completed",
  "pipeline.build.completed",
  "pipeline.deployment.failed",
  "gitops.yaml.updated",
  "argocd.application.sync.requested",
  "argocd.application.synced",
  "argocd.application.degraded",
  "kubernetes.pod.failed",
  "kubernetes.node.unhealthy",
  "diagnosis.context.built",
  "diagnosis.rule.matched",
  "diagnosis.rule.missed",
  "diagnosis.knowledge.matched",
  "diagnosis.knowledge.missed",
  "diagnosis.completed",
  "knowledge.case.candidate",
  "collaboration.notification.requested",
  "collaboration.notification.sent",
  "collaboration.notification.failed",
  "collaboration.notification.timeout",
  "collaboration.progress.updated",
  "collaboration.escalation.triggered",
  "collaboration.daily_report.generated",
  "feishu.card.action_clicked",
  "feishu.message.replied"
] as const;

export type EventType = (typeof eventTypes)[number];

export const eventSources = ["gitlab", "tekton", "argocd", "kubernetes", "feishu", "compliance", "pipeline", "diagnosis", "collaboration", "knowledge", "gitops"] as const;
export type EventSource = (typeof eventSources)[number];

export function isEventType(value: string): value is EventType {
  return (eventTypes as readonly string[]).includes(value);
}
