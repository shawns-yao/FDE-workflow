# FDE Workstation M1 契约

**日期**：2026-06-17  
**状态**：契约草案，按三 Agent + 底座先行方向校准  
**配套设计**：`docs/architecture/fde-platform-m1-design.md`

---

## 1. 本文定位

本文定义 M1 的任务输入输出契约。M1 契约不再以多服务 internal API 为中心，而以 Redis Streams 事件总线、CloudEvents 事件信封、Agent Runtime、Pipeline Agent、Diagnosis Agent、Collaboration Agent 的结构化输入输出为中心。

---

## 2. 通用字段

```text
correlation_id：链路追踪 id，来自 pipeline、MR 或后端任务
trace_id：技术链路 id，用于日志和可观测性
run_id：执行实例 id，用于 artifact 目录和任务记录
project_id：GitLab project id
merge_request_iid：GitLab MR iid，可选
pipeline_id：GitLab pipeline id 或 Tekton PipelineRun id
application：应用名
environment：dev | test | prod
artifact_uri：报告或证据产物路径
created_at：ISO 8601 时间
```

ID 生成规则：

```text
FDE 内部 ID 使用时间有序格式：{prefix}-{timestamp_base36}-{random_hex}
示例：evt-m3x5k9r2-a1b2c3d4e5f6g7h8
特性：按时间排序（毫秒精度）、全局唯一（128位随机熵）、可读性好（base36编码）
```

脱敏要求：

```text
任何 summary、report、evidence 不得包含 API Key、Token、cookie、私钥、密码
原始日志只保留必要片段和 artifact 引用
生产环境输出必须隐藏敏感 namespace、内部域名和客户隐私原文
```

---

## 3. Redis Streams 事件总线契约

M1 使用 Redis Streams 作为事件总线，提供可靠的事件投递能力。

### 3.1 核心配置

```text
stream: fde.events
dlq_stream: fde.events.dlq

consumer groups:
  - agent.pipeline
  - agent.diagnosis
  - agent.collaboration
  - agent.audit
```

### 3.2 投递语义

```text
投递语义：at-least-once
消费端必须幂等
不承诺 exactly-once
不允许静默丢事件
```

### 3.3 幂等策略

入口幂等：

```text
key: ingress:{source}:{upstream_id}
value: event_id
ttl: 7 天
```

消费幂等：

```text
key: consumer:{consumer_id}:{event_id}
value: processed | processing | failed
ttl: 7 到 30 天
```

### 3.4 重试与死信

重试策略：

```text
默认重试次数：3 到 5 次
退避策略：指数退避
不可重试错误：schema 不合法、权限失败、签名失败、payload 无法解析
```

死信规则：

```text
重试耗尽必须进入死信队列
死信事件必须写入 PostgreSQL 或 artifact
死信必须触发告警或协同通知
死信不能自动丢弃
```

### 3.5 事件归档

```text
标准化成功后的事件必须写入 event_archive
每次投递尝试必须写入或更新 event_delivery
死信必须写入 dead_letter_event
原始大 payload 写 artifact，表中保存引用
```

---

## 4. CloudEvents 事件契约

所有外部事件进入 Agent 链路前，必须映射为统一事件信封。

```text
specversion：1.0
id：事件 id（FDE 内部生成，时间有序格式）
source：事件来源，例如 gitlab、tekton、argocd、kubernetes、feishu
type：事件类型（系统.对象.动作）
subject：资源标识，例如 MR、PipelineRun、Application、Pod
time：事件时间（UTC ISO 8601）
datacontenttype：application/json
correlation_id：链路追踪 id
trace_id：技术链路 id
run_id：执行实例 id
application：应用名
environment：dev | test | prod
data：来源事件的脱敏结构化 payload
metadata：来源系统差异字段
```

M1 事件类型：

```text
compliance.environment.scan.requested
compliance.environment.scan.completed
compliance.environment.scan.failed
gitlab.mr.created
gitlab.mr.updated
gitlab.mr.comment.created
gitlab.mr.merged
gitlab.pipeline.completed
tekton.pipelinerun.started
tekton.pipelinerun.completed
tekton.taskrun.completed
pipeline.build.completed
pipeline.deployment.failed
gitops.yaml.updated
argocd.application.sync.requested
argocd.application.synced
argocd.application.degraded
kubernetes.pod.failed
kubernetes.node.unhealthy
diagnosis.context.built
diagnosis.rule.matched
diagnosis.rule.missed
diagnosis.knowledge.matched
diagnosis.knowledge.missed
diagnosis.completed
knowledge.case.candidate
collaboration.notification.requested
collaboration.notification.sent
collaboration.notification.failed
feishu.card.action_clicked
feishu.message.replied
collaboration.notification.timeout
collaboration.progress.updated
collaboration.escalation.triggered
collaboration.daily_report.generated
```

事件状态约定：

```text
gitlab.pipeline.completed 的成功或失败状态放在 data.status。
tekton.pipelinerun.completed 的成功或失败状态放在 data.status。
tekton.taskrun.completed 的成功或失败状态放在 data.status。
GitOps YAML 更新统一使用 gitops.yaml.updated。
ArgoCD 同步触发统一使用 argocd.application.sync.requested。
ArgoCD 同步结果统一使用 argocd.application.synced 或 argocd.application.degraded。
Kubernetes 异常第一版统一使用 kubernetes.pod.failed。
```

---

## 5. Agent Runtime 契约

Agent Runtime 统一封装两类运行时。

任务输入：

```text
task_id
agent_type：pipeline | diagnosis | collaboration
business_task_type：mr_review | yaml_governance | build_fix | log_triage | root_cause | notification | progress_tracking | daily_report
runtime_capability：code_task | analysis_task | repair_task
runtime_type：code_runtime | claude_api
context_refs[]
artifact_refs[]
prompt_ref
schema_ref
permission_profile
runtime_policy：
  environment：dev | test | prod
  timeout_ms
  max_tool_calls
  max_tokens
  retry_count
allowed_tools[]
model
output_format：json | text
correlation_id
trace_id
run_id
```

permission_profile 命名使用连字符，与权限文件名一致：

```text
ci-readonly
ci-yaml-edit
diagnosis-readonly
collaboration-notify
```

任务输出：

```text
task_id
status：succeeded | failed | blocked | timed_out
output：结构化输出
structured_data（可选）
artifact_refs[]
patch_ref（可选）
tool_trace_ref（可选）
token_usage：
  input_tokens
  output_tokens
permission_audit：
  profile
  blocked_tools[]
error（可选，引用 ErrorObject）
```

错误码与状态映射：

```text
SCHEMA_VALIDATION_FAILED → failed（不可重试）
CONFIGURATION_INVALID → blocked（不可重试）
UPSTREAM_UNAVAILABLE → timed_out（可重试）
AUTHENTICATION_FAILED → blocked（不可重试）
PERMISSION_DENIED → blocked（不可重试）
IDEMPOTENCY_CONFLICT → failed（不可重试）
MODEL_NOT_CONFIGURED → blocked（不可重试）
LLM_UNAVAILABLE → failed（可重试）
TOOL_PERMISSION_DENIED → blocked（不可重试）
ARTIFACT_WRITE_FAILED → failed（可重试）
EVENT_PUBLISH_FAILED → failed（可重试）
ARCHIVE_WRITE_FAILED → failed（可重试）
COMMAND_EXECUTION_FAILED → failed（可重试，退出码126/127除外）
COMMAND_TIMEOUT → failed（不可重试）
```

`cc/` 使用约束：

```text
cc 目录只作为参考源码
FDE 业务代码必须写在自有 runtime / agents / connectors 目录
不得把 cc 的本地终端会话状态作为 FDE 业务状态机
```

---

## 6. Pipeline Agent 契约

### 6.1 Tekton 事件监听

输入事件：

```text
type：tekton.pipelinerun.completed
data：
  pipeline_run_name
  namespace
  application
  image_name
  image_tag
  status：succeeded | failed
  log_uri
  commit_sha
```

输出事件：

```text
type：pipeline.build.completed
data：
  application
  image_name
  image_tag
  build_status
  build_log_uri
```

### 6.2 GitOps YAML 自动更新

输入：

```text
config_repo
config_path
application
environment
image_name
image_tag
update_strategy：yq | kustomize | helm_values
```

输出：

```text
status：changed | unchanged | failed
changed_files[]
diff_artifact_uri
commit_message
```

### 6.3 ArgoCD 同步触发

输入：

```text
application
environment
argocd_application
revision
sync_policy：auto_dev_test | approval_required
```

输出：

```text
sync_status：triggered | skipped | failed
operation_id
message
```

---

## 7. GitLab CI Job 契约

### 7.1 claude-mr-review

输入：

```text
CI_PROJECT_ID
CI_MERGE_REQUEST_IID
CI_COMMIT_SHA
CI_MERGE_REQUEST_DIFF_BASE_SHA
AI_FLOW_INPUT（可选）
ANTHROPIC_API_KEY
```

输出 artifact：

```text
artifacts/mr-review-report.md
artifacts/mr-review-report.json
```

JSON 输出：

```text
status：passed | failed
risk_level：low | medium | high | critical
findings[]：
  category：security | code_quality | config | dependency | policy
  severity：low | medium | high | critical
  file：文件路径
  summary：问题摘要
  recommendation：修复建议
  blocking：布尔
```

退出码：

```text
0：通过或只有非阻断问题
1：存在 high / critical 阻断问题
2：扫描任务自身失败
```

### 7.2 claude-build-fix

输入：

```text
build_log_uri
test_report_uri
failed_stage
CI_COMMIT_SHA
AI_FLOW_INPUT（可选）
```

输出：

```text
artifacts/build-fix-report.md
artifacts/build-fix.patch（可选）
```

约束：

```text
补丁必须通过 MR 或人工审查进入主干
不得直接推送到受保护分支
```

---

## 8. Tekton Task 契约

### 8.1 claude-preflight-task

输入参数：

```text
workspace_path
application
environment
policy_prompt_path
```

输出：

```text
preflight_report_uri
risk_level
suggested_patch_uri（可选）
```

### 8.2 claude-yaml-audit-task

输入参数：

```text
config_repo_path
yaml_file_path
image_name
image_tag
environment
```

输出：

```text
yaml_audit_report_uri
yaml_diff_uri
status：passed | changed | failed
risk_level：low | medium | high | critical
```

prod 约束：

```text
prod 环境只输出建议和 diff，不自动提交
dev / test 可按策略提交低风险修改
```

---

## 9. Diagnosis Agent 契约

输入：

```text
application
environment
argocd_status
kubernetes_events[]
pod_logs[]
describe_snapshots[]
build_logs[]（可选）
knowledge_refs[]（可选）
```

输出：

```text
diagnosis_id
category：config | code | environment | dependency | unknown
severity：low | medium | high | critical
summary
root_cause
impact
recommendation
confidence：0 到 1
evidence_refs[]
next_actions[]
source：rule | knowledge | claude_api | rule_with_claude_api | fallback_rule
funnel_layer：rule | knowledge | llm
```

证据引用：

```text
evidence_ref：
  type：argocd_status | k8s_event | pod_log | describe | build_log | knowledge
  artifact_uri
  excerpt
  sampled_range
```

知识库案例候选：

```text
case_candidate：
  symptom
  root_cause
  solution
  evidence_refs[]
  owner_hint
  confidence
  review_required：布尔
```

M1 知识库边界：

```text
M1 只定义知识库案例 schema、fixture 和事件跳转点。
M1 不引入数据库、向量检索、相似度服务或案例审核后台。
diagnosis.knowledge.matched 只能来自 fixture 显式 similarity 或简单关键词规则。
无 fixture、知识库为空或低置信度时必须输出 diagnosis.knowledge.missed，并进入 Claude API 根因分析。
向量检索、长期知识沉淀和人工审核工作台属于 M2。
```

---

## 10. Collaboration Agent 契约

### 10.1 飞书通知

输入：

```text
diagnosis_result
application_owner
last_committer
environment
urgency
```

输出：

```text
target_type：user | group
target_id
card_title
card_summary
action_buttons[]
escalation_after_minutes
```

### 10.2 日报

输入：

```text
date
pipeline_summary
deployment_summary
failure_summary
diagnosis_summary
manual_intervention_summary
```

输出：

```text
title
summary
metrics[]
top_failures[]
risks[]
recommended_actions[]
markdown_report_uri
```

### 10.3 进度追踪

输入：

```text
notification_id
latest_replies[]
diagnosis_result
elapsed_minutes
```

输出：

```text
progress_status：unread | acknowledged | investigating | fixed | ineffective_reply | needs_escalation
reason
next_action
```

---

## 11. code_runtime 权限契约

不同任务使用不同 `permission_profile` 和 `allowed_tools`。`allowed_tools` 必须是 `permission_profile` 的子集，并且还要受当前 provider 实现约束；权限 profile 允许某个工具，不代表当前任务一定会把该工具暴露给模型。

```text
mr_review：read_file、list_files、run_command(git diff / rg / git show / git status)
yaml_governance：当前 Pipeline 主链路只开放 read_file、list_files
yaml_governance 后续自动修复：必须显式启用 edit_file、write_file、create_patch，并通过环境策略限制
build_fix：read_file、list_files、run_command；需要生成补丁时再显式启用 edit_file、write_file、create_patch
```

当前 Runtime 已实现的模型可见内置工具是 `read_file`、`list_files`、`run_command`。`edit_file`、`write_file`、`read_artifact`、`write_artifact`、`create_patch`、`validate_schema` 仍是契约目标，必须等对应 provider 落地后才能进入业务任务的 `allowed_tools`。

禁用：

```text
任意生产发布命令
kubectl 写操作
argocd sync 生产环境
删除仓库文件的通配命令
读取未授权目录
输出真实密钥
```

命令白名单安全要求：

```text
拒绝管道（|）、分号（;）、反引号、环境变量等危险操作
拒绝绝对路径或相对路径命令
只允许白名单中的主程序和参数
```

---

## 12. 契约变更规则

```text
Redis Streams 配置变化必须同步更新本文
CloudEvents 类型变化必须同步更新本文
Agent Runtime 输入输出变化必须同步更新本文
CI / Tekton 入参变化必须同步更新本文
Diagnosis 输出字段变化必须同步更新飞书通知 prompt
新增生产副作用必须先补审批约束
所有契约更新必须同步记录到 docs/TODO.md
```
