# FDE Workstation M1 实施设计

**日期**：2026-06-17  
**状态**：实施设计，按三 Agent + 双 AI 载体 + 底座先行方向校准  
**配套设计**：`docs/architecture/fde-platform-m1-design.md`  
**配套计划**：`docs/requirements/milestone-1-plan.md`

---

## 1. 本文定位

本文把 M1 设计基线转成研发可执行口径。M1 需要从第一天确定底部契约，再按 Pipeline Agent、Diagnosis Agent、Collaboration Agent 三条业务线推进。

M1 不是只做最小 CI 模板，也不是恢复上一版重型多服务平台。正确实施方式是：底座先定，业务分阶段变厚。

---

## 2. 实施结论

M1 采用以下技术路线：

```text
基础事件：CloudEvents 事件信封
事件中间件：Redis Streams（可靠投递、消费组、ACK、死信）
Agent 抽象：Agent Runtime，统一 code_runtime 与 claude_api 两类运行时
流水线执行：GitLab CI、Tekton Task
代码与配置智能执行：FDE code_runtime
后端语义推理：Claude API
部署系统：ArgoCD
运行证据：Kubernetes Events、Pod logs、kubectl describe
协同通道：飞书 OpenAPI / webhook
状态承载：优先使用 GitLab、Tekton、ArgoCD、K8s、飞书自身状态
报告产物：CI artifact、诊断 JSON、Markdown 报告、飞书卡片
```

### 技术选型演进

```text
最初方案：RabbitMQ（完整消息队列，运维成本高）
        ↓
第二方案：Redis Pub/Sub（简单但消息不可靠，fire-and-forget）
        ↓
最终方案：Redis Streams（可靠投递 + 复用 Redis，运维成本可控）
```

**选择 Redis Streams 的理由**：

| 维度 | RabbitMQ | Redis Pub/Sub | Redis Streams |
|------|----------|---------------|---------------|
| 消息可靠性 | 最高 | 低（丢失风险） | 高（at-least-once） |
| 运维成本 | 高（独立服务） | 低 | 中（复用 Redis） |
| 消费组支持 | 原生支持 | 不支持 | 原生支持 |
| ACK 机制 | 原生支持 | 不支持 | 原生支持 |
| 死信队列 | 原生支持 | 需自建 | 原生支持 |
| 消息回放 | 支持 | 不支持 | 支持 |
| 适用规模 | 大规模 | 小规模 | 中等规模 |

**M1 阶段选择 Redis Streams**：
- Agent 数量有限（3 个），事件量中等
- 复用 Redis（后续幂等、缓存也可用）
- 满足可靠投递需求（不像 Pub/Sub 丢消息）
- 不需要 RabbitMQ 级别的运维成本

M1 不把 PostgreSQL、NestJS、Prisma、BullMQ、outbox worker 作为第一批代码前置，但 Redis Streams 是事件总线的核心组件，必须从第一天纳入。后续引入数据库或工作台时，不应重写 Agent 输入输出。

---

## 3. 运行位置

| 能力 | 运行位置 | 主要依赖 | 产物 |
| --- | --- | --- | --- |
| 事件总线 | Redis Streams | Redis、CloudEvents schema | 标准事件 JSON、投递记录 |
| Agent Runtime | FDE 自有 runtime 层 | `cc/` 参考模式、code_runtime、Claude API | 结构化结果、artifact |
| IM 连接器 | Collaboration Agent / webhook adapter | 飞书 OpenAPI / webhook | 卡片消息、升级通知 |
| Pipeline Agent 确定性核心 | Pipeline Agent | GitLab、Tekton、GitOps、ArgoCD | 构建事件、YAML 变更、同步结果 |
| MR 语义评审 | GitLab CI job | code_runtime、GitLab diff | MR 评审报告、CI 成功/失败 |
| 构建前预检 | Tekton Task | code_runtime、源码工作区 | 预检报告、可选 diff |
| YAML 智能校验 | Tekton Task | code_runtime、配置仓库 checkout | YAML diff、校验报告 |
| 构建失败自修复 | GitLab CI / Tekton 失败分支 | code_runtime、构建日志 | 修复分支或 MR 建议 |
| 日志速析 | Diagnosis Agent | Claude API、K8s / ArgoCD 证据 | 结构化诊断 JSON |
| 根因分析 | Diagnosis Agent | 规则引擎、Claude API、知识库 | 根因、影响范围、修复建议 |
| 智能通知 | Collaboration Agent | Claude API、飞书 | 飞书卡片、升级记录 |
| 日报生成 | Collaboration Agent | GitLab / Tekton / ArgoCD 摘要、Claude API | 日报 Markdown、飞书消息 |

---

## 4. 推荐目录结构

M1 代码应围绕底座、三 Agent、CI/Tekton 模板、prompt 和 schema 组织。`cc/` 只作为参考源码，不在其中写 FDE 业务代码。

```text
agent-runtime/
  code-cli/
  claude-api/
  schemas/
events/
  broker/          # EventBroker 接口定义
  redis-streams/   # Redis Streams 实现
  memory/          # 内存实现（测试用）
  cloudevents/
connectors/
  feishu/
agents/
  pipeline/
    deterministic/
    mr-review/
    yaml-governance/
    build-fix/
  diagnosis/
    collectors/
    context-builder/
    rules/
    root-cause/
  collaboration/
    notification-router/
    progress-tracker/
    daily-report/
ci/
  gitlab/
    claude-mr-review.yml
    claude-build-fix.yml
  tekton/
    claude-preflight-task.yaml
    claude-yaml-audit-task.yaml
prompts/
  pipeline/
    mr-review.md
    yaml-audit.md
    build-fix.md
  diagnosis/
    log-triage.md
    root-cause.md
  collaboration/
    feishu-notification.md
    daily-report.md
schemas/
  common/
  events/
  agent-runtime/
  connectors/
  compliance/
docs/
  architecture/
  requirements/
  implementation/
cc/
  # 参考源码，不直接修改
```

如果需要 TypeScript 辅助脚本，可以先以轻量包或脚本落地在上述目录。是否恢复 monorepo 取决于实现复杂度，但目录边界必须先按底座和三 Agent 划清。

---

## 5. 底座设计

### 5.1 事件总线

M1 事件总线使用 Redis Streams，提供可靠的事件投递、消费组、ACK 和死信能力。

事件来源：

```text
GitLab webhook / CI variables
Tekton EventListener / PipelineRun / TaskRun
ArgoCD webhook / Application status
Kubernetes Event
Feishu callback
```

事件字段：

```text
id
source
type
subject
time
datacontenttype
data
correlation_id
environment
application
```

Redis Streams 核心概念：

```text
stream: fde.events
consumer groups:
  - agent.pipeline
  - agent.diagnosis
  - agent.collaboration
  - agent.audit

dlq stream: fde.events.dlq
```

### 5.2 IM 连接器

IM 连接器统一封装飞书能力：

```text
发送卡片
@责任人
处理交互按钮
升级通知
日报推送
```

M1 可以先使用 webhook，后续按审批和回调复杂度升级到 OpenAPI app。

### 5.3 Agent Runtime

Agent Runtime 是解耦核心，不等同于重型服务。M1 可先实现为轻量 wrapper。

```text
code_runtime：FDE 自有代码任务运行时，处理代码和配置文件任务
claude_api runtime：调用 Claude API，处理诊断、摘要、通知、日报
```

统一职责：

```text
选择 runtime
注入 prompt
校验 JSON schema
写 artifact
记录 token、耗时、错误摘要
执行超时和权限策略
```

### 5.4 `cc` 参考源码使用规则

```text
不直接修改 cc 目录
从 cc 学习 CLI、Agent SDK、MCP、skills、hooks、权限和 channel 模式
在 FDE 自己的 agent-runtime / agents / connectors 中实现对应能力
如迁移代码片段，必须先剥离与本地终端会话绑定的假设
```

---

## 6. GitLab CI 设计

### 6.1 claude-mr-review

触发：

```text
merge_request_event
manual
web/API trigger
```

输入：

```text
MR diff
CLAUDE.md
业务代码
Dockerfile
K8s YAML
团队规范 prompt
```

执行：

```text
初始化 FDE code_runtime
调用内部 Agent Runtime API
限制 allowedTools
输出 Markdown / JSON 报告
高风险问题 exit 1
```

输出：

```text
artifacts/mr-review-report.md
artifacts/mr-review-report.json
CI job status
```

### 6.2 claude-build-fix

触发：

```text
构建或测试失败
手动重试
评论触发
```

输入：

```text
失败日志
测试报告
相关源码
Dockerfile / 构建脚本
依赖配置
```

输出：

```text
修复建议
可选补丁 diff
可选修复分支 / MR
```

边界：

```text
不得直接合入主干
不得绕过 MR 审查
生产配置变更必须走审批
```

---

## 7. Tekton 设计

### 7.1 claude-preflight-task

插入位置：

```text
拉取代码之后
构建镜像之前
```

职责：

```text
代码与配置预检
Dockerfile 风险识别
依赖和构建脚本语义检查
可自动修复低风险问题
```

### 7.2 claude-yaml-audit-task

插入位置：

```text
更新 YAML 镜像 tag 之后
推送配置仓库之前
ArgoCD sync 之前
```

职责：

```text
检查 Deployment YAML
补全或建议 resources、probe、安全上下文
检查环境变量、标签、亲和性和镜像 tag
输出 diff 和风险报告
```

边界：

```text
低风险修改可生成 diff
高风险修改只输出建议
prod 配置不自动提交
```

---

## 8. Pipeline Agent 确定性核心

Pipeline Agent 不只是 CI 模板，它包含确定性执行链路和 AI 增强链路。

确定性职责：

```text
监听 GitLab / Tekton 构建完成事件
提取镜像名、Tag、构建状态和日志地址
通过 yq / kustomize 精准修改 GitOps YAML 镜像标签
提交配置仓库
触发 ArgoCD Application 同步
回传同步结果事件
```

AI 增强职责：

```text
MR Review Agent：合入前评审代码、配置、安全和规范
YAML Governance Agent：更新 tag 后做 K8s 配置治理
Build Fix Agent：构建失败后给出修复建议或补丁
```

---

## 9. Diagnosis Agent 设计

输入：

```text
ArgoCD Application 状态
Kubernetes Events
Pod logs
kubectl describe 摘要
Tekton / GitLab 构建日志
历史知识片段（可选）
```

处理：

```text
Context Builder：清洗、采样、压缩、结构化上下文
第一层：规则引擎匹配 Top 故障
第二层：知识库匹配历史案例
第三层：Claude API 做复杂根因推理
```

输出字段：

```text
category：config | code | environment | dependency | unknown
severity：low | medium | high | critical
summary
root_cause
impact
recommendation
evidence_refs
confidence
next_actions
```

---

## 10. Collaboration Agent 设计

输入：

```text
诊断结果
GitLab commit / MR 信息
服务归属配置
飞书用户或群组映射
处理进度和回复内容
```

处理：

```text
Claude API 生成可读通知
规则 + AI 判断责任归属
识别回复是否有效
超时或无效回复触发升级
日报生成时总结趋势和高频问题
```

输出：

```text
飞书卡片
审批请求
升级提醒
日报 Markdown
```

---

## 11. 配置与凭据

GitLab CI/CD variables：

```text
ANTHROPIC_API_KEY
GITLAB_ACCESS_TOKEN（可选，默认优先 CI_JOB_TOKEN）
FEISHU_WEBHOOK_URL（可选）
ARGOCD_TOKEN（只读或同步权限按环境区分）
KUBERNETES_TOKEN（只读诊断优先）
```

服务端环境变量：

```text
ANTHROPIC_API_KEY
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_WEBHOOK_SECRET
ARGOCD_BASE_URL
ARGOCD_TOKEN
KUBERNETES_API_SERVER
KUBERNETES_TOKEN

REDIS_HOST
REDIS_PORT
REDIS_PASSWORD（可选）
```

安全要求：

```text
所有密钥必须使用 GitLab masked variables 或服务端环境变量
禁止提交真实凭据
Claude Code allowedTools 必须按任务最小化
诊断和日报输出必须脱敏
```

---

## 12. 不再采用的上一版实现

以下上一版重型自建平台方向不进入第一批实现：

```text
apps/control-plane
apps/pipeline-service
apps/diagnosis-service
apps/collaboration-service
apps/memory-service
apps/worker
mcp-servers/ops-tool-service
mcp-servers/feishu-channel
packages/database
packages/internal-auth
packages/mcp-client
packages/tool-audit
PostgreSQL outbox
BullMQ worker
NestJS + Fastify 多服务骨架
```

注意：Redis 已纳入 M1 实现，用于事件总线（Redis Streams）。上述列表中的 `Redis / BullMQ worker` 指的是旧版 BullMQ 任务队列方案，已替换为 Redis Streams。

这些能力不是永久删除，而是降级为后续平台化形态。M1 需要保留它们对应的数据契约，避免后续返工。

---

## 13. 验收口径

M1 通过条件：

```text
底座契约已定义：CloudEvents、Agent Runtime、Artifact、Schema、IM 连接器
Redis Streams 事件总线已实现：可靠投递、消费组、ACK、死信
Pipeline Agent v0.1 有确定性核心
GitLab MR 可运行 Claude Code 合规扫描
Tekton 可运行 Claude Code YAML 校验任务
构建失败可生成 Claude Code 修复建议
Diagnosis Agent 可通过 Context Builder 和三层漏斗生成结构化诊断
Collaboration Agent 可生成飞书通知和日报
所有 AI 输出可追溯到输入证据
生产变更仍受 GitLab / ArgoCD / 飞书审批约束
```