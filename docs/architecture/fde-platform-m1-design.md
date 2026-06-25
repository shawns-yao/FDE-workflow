# FDE Workstation M1 设计基线

**日期**：2026-06-17  
**状态**：设计基线，按三 Agent + 双 AI 载体 + 底座先行方向校准  
**目标版本**：M1  
**技术路线**：GitLab / Tekton 确定性流水线 + FDE code_runtime + Claude API 后端 Agent + Redis Streams 事件总线 + ArgoCD / K8s / 飞书集成

---

## 1. 核心结论

FDE Workstation M1 不是普通 DevOps 平台，也不是单纯把 Claude Code 包一层网页。正确方向是 **三 Agent 智能 CI/CD 系统**：

```text
确定性 CI/CD 链路保持不变：
GitLab -> Tekton -> 镜像构建 -> 配置仓库 YAML 更新 -> ArgoCD 同步 -> K8s 运行 -> 飞书协同

AI 只做智能增强：
FDE code_runtime 在 GitLab CI / Tekton Task 内处理代码和配置文件
Claude API 在后端 Agent 中处理日志理解、故障推理、通知生成和日报生成

事件可靠投递：
Redis Streams 作为事件总线，提供 at-least-once 语义、消费组、ACK 和死信能力
```

三 Agent 是：

```text
Pipeline Agent：交付链路自动化与流水线内 AI 治理
Diagnosis Agent：异常证据采集、上下文压缩和三层漏斗诊断
Collaboration Agent：通知路由、进度追踪、升级和日报
```

Pipeline 本身就是 Agent，不再把 Pipeline 仅视为普通流水线脚本。Pipeline Agent 内部包含确定性执行模块和 AI 增强模块，二者边界必须清楚。

M1 不以"只做最小 MVP"为目标。底部能力从第一天确定，包括 Redis Streams 事件总线、CloudEvents 事件信封、Agent Runtime 抽象、IM 连接器、Artifact 规范、Schema 契约、权限边界和 `cc` 参考源码使用规则。实现可以先薄，但接口和边界不能缺，否则后续 Diagnosis、Collaboration、记忆和工作台都会返工。

因此，M1 不优先自建完整 control-plane / worker / PostgreSQL outbox 平台，也不让后端服务替代 GitLab 和 Tekton 的流水线状态。GitLab CI、Tekton、ArgoCD、Kubernetes 和飞书仍然是主链路基础设施；AI 嵌入这些节点，增强审查、修复、诊断和协同能力。

---

## 2. 双 AI 载体

| AI 载体 | 适用环节 | 对应任务 | 核心作用 |
| --- | --- | --- | --- |
| FDE code_runtime | GitLab MR、GitLab CI、Tekton Task、临时工作区 | MR 语义评审、YAML 自动更新、构建失败自修复 | 直接读取和修改代码 / 配置文件，生成 diff、报告和修复提交 |
| Claude API 服务端调用 | Diagnosis Agent、Collaboration Agent、日志分析、日报生成 | W1-T8 日志速析器、W2-T3 根因引擎、W2-T6/T7/T8 协同 Agent | 语义分析、故障推理、内容生成、通知摘要，不直接操作文件系统 |

边界：

```text
code_runtime 不负责长期保存业务状态
code_runtime 不绕过 GitLab MR、分支保护和审批策略
Claude API 不直接修改仓库文件
Claude API 不直接触发生产发布或回滚
ArgoCD / K8s / 飞书不是 AI，本质是确定性系统和数据来源
```

---

## 3. 底座先行

W1-T3 的共享基础设施不是附属项，而是后续所有 Agent 的底部契约。M1 必须先把底座边界定住：

```text
事件总线：Redis Streams 提供可靠投递、消费组、ACK 和死信能力
CloudEvents：使用 CloudEvents 语义统一 GitLab、Tekton、ArgoCD、K8s、Feishu 事件
IM 连接器：统一飞书消息、@人、卡片、按钮、升级通知
Agent Runtime：统一 code_runtime、Claude API 和未来模型的调用边界
Artifact 规范：统一保存 AI 报告、diff、诊断证据、日报和审计摘要
Schema 契约：所有 Agent 输入输出必须结构化
权限边界：CI 文件操作、K8s 只读诊断、飞书通知、生产审批分别受控
```

### 为什么选择 Redis Streams 作为事件总线

```text
技术选型演进：
  RabbitMQ → Redis Pub/Sub → Redis Streams

最终选择 Redis Streams 的理由：
1. 可靠性：at-least-once 语义，消息持久化，不像 Pub/Sub 丢失
2. 运维成本：复用 Redis，不需要额外部署 RabbitMQ
3. 消费组：多 Agent 并行消费，独立 consumer group
4. ACK 机制：显式确认，失败重试
5. 死信队列：重试耗尽后进入 DLQ
6. 消息回放：支持排障和审计
7. 规模匹配：M1 阶段 Agent 数量有限，Redis Streams 完全够用
```

底座的 M1 实现：

```text
Redis Streams 事件总线（EventBroker 接口 + RedisStreamsEventBroker 实现）
CloudEvents JSON schema
飞书 webhook / OpenAPI wrapper
Agent Runtime wrapper 脚本或 TypeScript 小包
artifact 目录规范
prompt + schema 目录
CI / Tekton 模板
```

底座后续可升级为服务，但 M1 文档和代码结构必须从第一天保留这些边界。

---

## 4. 三个业务 Agent

M1 按三个业务 Agent 组织能力。Agent 不一定等同于独立服务，但必须有独立的职责边界、输入输出 schema 和验收口径。

### 4.1 Pipeline Agent

职责：

```text
接收 GitLab / Tekton / ArgoCD 事件
触发 Tekton 构建或接入现有 Tekton 流水线
确定性更新 GitOps YAML 镜像标签
触发 ArgoCD Application 同步
MR 前置合规扫描
Tekton 构建前代码与配置预检
YAML 镜像标签更新后的智能校验
构建失败后的日志分析和可自动修复项处理
ArgoCD 同步前风险检查
```

主要载体：

```text
GitLab CI job
Tekton Task
FDE code_runtime
Redis Streams 事件总线
可选 GitLab MCP server
```

内部模块：

```text
Pipeline Service：确定性核心，全程无 AI
MR Review 模块：code_runtime，MR 阶段只读评审
YAML Governance 模块：code_runtime，更新 tag 后做配置治理和低风险修复
Build Fix 模块：code_runtime，构建失败后生成修复建议或 MR
```

### 4.2 Diagnosis Agent

职责：

```text
监听 ArgoCD Application 非 Healthy 状态
收集 K8s Events、Pod 日志、kubectl describe、ArgoCD 状态
规则引擎匹配常见错误
规则不足时调用 Claude API 做深度推理
输出根因、影响范围、修复建议和证据引用
```

主要载体：

```text
后端 Diagnosis 服务或轻量脚本
Claude API
ArgoCD / Kubernetes 只读接口
诊断证据 artifact
Context Builder
知识库案例引用
```

内部模块：

```text
状态监听模块：ArgoCD / K8s / Tekton 异常事件识别
数据采集模块：Events、Pod logs、describe、构建日志、部署记录
Context Builder：清洗、压缩、结构化上下文
三层诊断漏斗：规则引擎 -> 知识库匹配 -> Claude API 根因引擎
日志速析器：诊断前置工具，不独立成 Agent
```

### 4.3 Collaboration Agent

职责：

```text
根据诊断结果判断通知对象
生成飞书消息摘要
识别回复是否有效
按超时和处理进度升级
生成日报和高频问题总结
```

主要载体：

```text
后端 Collaboration 服务或轻量脚本
Claude API
飞书 OpenAPI / webhook
GitLab / Tekton / ArgoCD 事件摘要
```

内部模块：

```text
通知路由模块：根据服务归属、故障类型、提交记录匹配责任人
进度追踪模块：识别已读、确认、处理中、已修复、无效回复
升级模块：超时或假闭环时升级通知
日报生成器：聚合构建、部署、失败、处理数据并生成日报
```

---

## 5. M1 主流程

```text
开发者提交 MR
  -> GitLab 事件进入 CloudEvents 信封
  -> Redis Streams 事件总线接收并路由
  -> GitLab CI 触发 claude-mr-review
  -> code_runtime 读取 diff、代码、Dockerfile、K8s YAML
  -> 输出合规报告，高风险时 exit 1 阻断合入

MR 合入或流水线触发
  -> Tekton 拉代码
  -> 构建前 code_runtime 做代码与配置预检
  -> Tekton 构建镜像
  -> 自动更新配置仓库 YAML 镜像标签
  -> code_runtime 做 YAML 智能校验和可控修复
  -> 推送配置仓库
  -> ArgoCD 同步

部署异常
  -> ArgoCD / K8s / Tekton 异常事件进入 CloudEvents 信封
  -> Redis Streams 事件总线投递给 Diagnosis Agent
  -> Diagnosis Agent 收集证据
  -> Context Builder 结构化压缩
  -> 规则引擎 -> 知识库匹配 -> Claude API 根因引擎
  -> Collaboration Agent 生成飞书通知、路由责任人、跟踪进度
  -> 案例回流知识库候选
```

---

## 6. Agent Runtime 与 `cc` 参考源码

`cc/` 是参考源码，不是 FDE 业务代码目录。可以基于它修改我们的代码，但不能直接在 `cc/` 内开发 FDE 业务逻辑。

允许参考和迁移的部分：

```text
code_runtime 的任务执行模式
MCP 工具接入方式
skills / hooks / CLAUDE.md 组织方式
channel / webhook 事件注入方式
权限和工具白名单设计
结构化输出、会话日志和工具调用约束
```

落地方式：

```text
在 FDE 自己的目录中实现 agent-runtime、ci、tekton、prompts、schemas
必要时从 cc 迁移设计模式或小段通用代码，并保留来源说明到内部技术文档
不修改 cc 原目录，不把 cc 的本地终端状态模型作为 FDE 业务状态机
```

Agent Runtime 的 M1 职责：

```text
统一 code_runtime 和 Claude API 调用入口
按任务类型选择 runtime：code_runtime 或 claude_api
统一 prompt、schema、artifact、错误结构
统一 token 统计、限流、超时、审计摘要
为后续 GPT、Gemini 或本地模型保留扩展点
```

---

## 7. 数据与存储边界

M1 底部需要先定数据边界，但不要求第一天完整实现数据库平台。

优先使用现有系统承载运行状态：

```text
GitLab：MR、pipeline、job log、artifact、approval
Tekton：PipelineRun、TaskRun、构建日志
ArgoCD：Application 状态和同步历史
Kubernetes：Events、Pod logs、资源状态
飞书：消息、审批卡片、人工互动
Redis Streams：事件投递、消费状态、幂等去重
文件 artifact：AI 报告、诊断证据、YAML diff、日报 Markdown
```

必须从第一天定义的数据契约：

```text
CloudEvent 信封
Agent task 输入输出
AI report artifact
diagnosis evidence
knowledge case candidate
notification card
daily report
```

数据库是否进入 M1 取决于是否要做跨项目工作台、长期 ROI、知识库审核或统一审计。即使 M1 暂不实现数据库，也要保证 schema 可以平滑迁移到后续平台层。

---

## 8. M1 不做

```text
不自建完整重型 NestJS 多服务平台
不把 PostgreSQL / outbox / BullMQ worker 作为 M1 第一批代码前置
不让后端服务替代 GitLab CI 或 Tekton 的执行状态
不在通用后端服务器长期执行代码任务运行时
不绕过 GitLab MR、分支保护、环境审批和 ArgoCD 权限
不把 ArgoCD / K8s / 飞书当成 AI Agent
不对生产环境自动发布或自动回滚
```

---

## 9. M1 验收标准

### 9.1 底座

```text
Redis Streams 事件总线已实现：可靠投递、消费组、ACK、死信
CloudEvents 事件信封已定义
Agent Runtime 的 code_runtime / claude_api 两种 runtime 已定义
Artifact 目录和 schema 已定义
飞书 IM 连接器边界已定义
cc 参考源码使用规则已定义
```

### 9.2 Pipeline Agent

```text
Pipeline Agent v0.1 有明确输入输出
GitLab MR 可触发 claude-mr-review
code_runtime 可读取 MR diff 并输出报告
高风险问题可使 CI job 失败
Tekton 可在 YAML 更新后执行 Claude YAML 校验任务
AI 生成的修改必须通过 Git diff / MR 暴露给人工审查
```

### 9.3 Diagnosis Agent

```text
能采集 ArgoCD 非 Healthy 状态、K8s Events 和 Pod 日志
Context Builder 能生成结构化压缩上下文
规则引擎能命中 Top 常见错误
知识库匹配契约已定义
规则不足时能调用 Claude API 输出结构化诊断
诊断结果必须包含证据引用、严重级别、影响范围和修复建议
```

### 9.4 Collaboration Agent

```text
能根据诊断结果生成飞书通知
能按故障类型和提交信息推断通知对象
能识别处理进度并按规则升级
能生成日报，包含构建、部署、失败、平均修复时间和高频问题
```

### 9.5 安全

```text
API Key 只通过 GitLab CI/CD variables 或服务端环境变量注入
code_runtime 的 allowed_tools 必须最小化
生产环境变更必须经过 GitLab / ArgoCD / 飞书审批链路
日志和诊断证据不得包含 token、cookie、私钥和敏感原文
```

---

## 10. 下一步实施顺序

```text
1. 定义底座契约：Redis Streams 事件总线、CloudEvents、Agent Runtime、Artifact、Schema、IM 连接器
2. 实现 Redis Streams 事件总线：EventBroker 接口、RedisStreamsEventBroker、消费组、ACK、死信
3. 基于 cc 参考源码设计 FDE 自己的 agent-runtime 目录，不直接修改 cc
4. 实现 Pipeline Agent v0.1：Tekton 事件监听、YAML 更新、ArgoCD 同步触发
5. 实现 MR Review 模块和 YAML Governance 模块的 code_runtime 模板
6. 实现 Diagnosis Agent 三层漏斗的 schema、prompt 和 Context Builder
7. 实现 Collaboration Agent 的飞书通知、进度追踪和日报 schema
```