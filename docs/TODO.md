# FDE Workstation TODO

**更新时间**：2026-06-27
**当前状态**：当前方向已校准为三 Agent + 双 AI 载体 + 底座先行：Pipeline / Diagnosis / Collaboration 三个 Agent，FDE 自研 Agent Runtime 迁移或重写 Claude Code 的通用编码能力，Claude API 用于诊断和协同

---

## 1. 已确认方向

### DONE-20260617-01：三 Agent 与双 AI 载体架构校准

- **状态**：已确认
- **完成时间**：2026-06-17
- **影响范围**：`docs/architecture/fde-platform-m1-design.md`、`docs/architecture/m1-implementation-design.md`、`docs/architecture/fde-platform-m1-contracts.md`、`docs/requirements/milestone-1-plan.md`
- **说明**：不再以自建重型 NestJS 多服务平台为主线。确定性 CI/CD 链路仍为 GitLab -> Tekton -> YAML 更新 -> ArgoCD -> K8s -> 飞书；AI 只在关键节点增强。Pipeline 本身是业务 Agent，不再把 Pipeline 仅视为普通流水线脚本。
- **结论**：
  - 三个业务 Agent：Pipeline Agent、Diagnosis Agent、Collaboration Agent。
  - FDE 自研 Agent Runtime 迁移或重写 Claude Code 的通用编码能力，用于 GitLab CI / Tekton Task 内的代码和配置文件操作。
  - Claude API 用于后端 Diagnosis Agent 和 Collaboration Agent 的语义推理、内容生成、通知摘要和日报。
  - CloudEvents、Agent Runtime、Artifact、Schema、IM 连接器是当前底座契约，必须从第一天确定。
  - PostgreSQL、outbox、worker、前端工作台不是第一批代码前置，但数据契约必须能平滑迁移到后续平台层。

### DONE-20260617-02：上一版自建平台方向降级

- **状态**：已确认
- **完成时间**：2026-06-17
- **影响范围**：`apps/`、`packages/`、`mcp-servers/`、根目录 monorepo 配置
- **说明**：上一版 `control-plane`、`pipeline-service`、`diagnosis-service`、`collaboration-service`、`memory-service`、`worker`、MCP HTTP 服务、Prisma、outbox、BullMQ 等代码不进入当前主线。后续如需要跨项目工作台、长期审计、ROI 或知识库审核，再作为平台增强层重新设计。

### DONE-20260617-06：吸收阶段性完整架构文档

- **状态**：已完成
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`docs/architecture/fde-platform-m1-design.md`、`docs/architecture/m1-implementation-design.md`、`docs/architecture/fde-platform-m1-contracts.md`、`docs/requirements/milestone-1-plan.md`
- **说明**：吸收阶段性文档中的 Pipeline 确定性核心、MR Review Agent、YAML Governance Agent、Diagnosis 三层漏斗、Collaboration 闭环、Agent Runtime、事件总线、IM 连接器和 `cc/` 参考源码使用规则。

### DONE-20260617-10：事件总线实现路径切换为 Redis Streams

- **状态**：已确认
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`docs/implementation/steps/00-基础契约.md`、`docs/implementation/steps/01-事件总线.md`、`src/events/`
- **说明**：当前不引入 RabbitMQ。事件总线先使用 Redis Streams 承担 stream、consumer group、ack、pending、回放和死信路径；`EventBroker` 保持抽象，保留本地内存实现用于 fixture 和本地验证。

### DONE-20260617-12：Pipeline Agent 设计决策确认

- **状态**：已确认
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`docs/implementation/steps/05-Pipeline智能体核心.md`
- **说明**：确认 Pipeline Agent 的关键设计决策。
- **决策记录**：
  - **Tekton 事件接收**：M1 使用 HTTP Webhook 接收 Tekton 事件（TODO: 临时方案，后续可升级为 Tekton Interceptor）
  - **镜像 Tag 格式**：`{commit_sha}_{timestamp}`，例如 `5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198`，不同项目可能不同
  - **配置仓库策略**：单仓库 + 目录隔离，按环境管理（非分支）
  - **配置仓库地址**：暂定（当前无远程仓库），配置项 `GITOPS_REPO_URL`
  - **YAML 镜像字段路径**：暂定为占位符，配置项 `IMAGE_FIELD_PATH`，不同项目路径可能不同
  - **YAML 文件名**：通用化，不固定为特定文件名，配置项 `YAML_FILE_NAME`（可选，默认 `{environment}.yaml`）
  - **环境管理方式**：按目录区分环境（dev/test/prod）
  - **基础设施**：Redis + PostgreSQL 都在 Docker 中，M1 先用 Redis
  - **Git 操作方式**：使用系统 git 命令，Docker 镜像中预装

### DONE-20260618-01：三 Agent 的 AI 与工具边界确认

- **状态**：已确认
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`docs/implementation/steps/02-智能体运行时.md`、`docs/implementation/steps/05-Pipeline智能体核心.md`
- **说明**：确认 Agent 不等于每一步都调用 AI，也不等于简单大模型包装层。三个业务 Agent 都必须具备 AI 接入能力，但 AI 只进入语义判断、根因推理、内容生成、配置治理和修复建议等场景。确定性、安全敏感、可结构化表达的动作优先由纯代码执行。
- **结论**：
  - Pipeline Agent：核心交付链路纯代码，AI 用于 MR 评审、YAML 治理、构建失败修复。
  - Diagnosis Agent：数据采集和规则匹配纯代码，AI 用于日志摘要、根因推理、修复建议。
  - Collaboration Agent：通知路由和状态追踪纯代码，AI 用于通知摘要、回复有效性判断、日报生成。
  - MCP / Runtime 工具不在 Agent 之间直接流转；Agent 之间只流转 CloudEvent、ArtifactRef 和结构化结果。

### DONE-20260618-03：`cc/` 无头代码运行能力吸收范围确认

- **状态**：已确认
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`docs/implementation/steps/02-智能体运行时.md`、`docs/implementation/steps/05-Pipeline智能体核心.md`
- **说明**：确认 Pipeline Agent 的第一个 AI 能力不是构建失败修复，而是 Git 提交前的 YAML diff 审查和 YAML Governance。`cc/` 只作为能力来源，不在 `cc/` 内写 FDE 业务逻辑，也不直接调用 `claude -p` 作为主路径。
- **结论**：
  - 第一批吸收 `cc/src/QueryEngine.ts` 的无头执行形态、`cc/packages/agent-tools` 的工具协议、文件工具核心行为、结构化输出工具、Anthropic Messages API 最小调用和命令权限规则。
  - 不整包导入 `cc/src`，不迁移 TUI、REPL、插件市场、动态 MCP、SkillTool、AgentTool、遥测和通用 BashTool。
  - Pipeline Agent 必须在 YAML 更新并生成 `yaml.diff` 后调用 `code_runtime`，由 Runtime 审查 diff、识别高风险配置、输出结构化治理结果并决定是否阻断提交。

### DONE-20260618-04：Runtime 工具架构校准为内置工具 + MCP provider

- **状态**：已确认
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`docs/implementation/steps/02-智能体运行时.md`、`src/runtime/tools/`、`src/runtime/executors/code-runtime/`
- **说明**：核对 `cc/` 后确认工具体系不是 MCP-only，而是内置工具和 MCP 工具合并成统一工具池。FDE Runtime 采用相同方向：本地文件、artifact、schema、命令白名单等安全敏感能力使用内置工具；Tekton、ArgoCD、K8s、GitLab、飞书、知识库、浏览器等外部系统能力通过 MCP provider 扩展。
- **结论**：
  - Agent 之间不传递工具，只传递 CloudEvent、ArtifactRef 和结构化结果。
  - Runtime 内部通过 ToolProvider 装配工具池。
  - `permission_profile` 和 `allowed_tools` 是最终裁剪层。
  - 内置工具与 MCP 工具同名时，内置工具优先。

### DONE-20260626-01：Agent Skills 与 MCP 分层参考确认

- **状态**：已确认
- **提出时间**：2026-06-26
- **完成时间**：2026-06-26
- **影响范围**：`docs/implementation/steps/00-基础契约.md`、`docs/implementation/steps/02-智能体运行时.md`、`docs/implementation/steps/05-Pipeline智能体核心.md`
- **说明**：参考 Agentic Skills 的组织方式后，确认 FDE 也需要 Skill 层和 MCP 工具层，但两者职责不同。Skill 是 Agent 能力包，描述触发条件、领域知识、Prompt、schema、推荐工具和验证方式；MCP 是外部系统工具入口，负责 Tekton、ArgoCD、GitLab、K8s、飞书等系统的可执行动作。
- **结论**：
  - Skill 不能保存密钥，不能直接调用 SDK，不能扩大权限。
  - MCP 工具统一以 `mcp__<server>__<tool>` 暴露给 Runtime。
  - Runtime 继续按 `permission_profile`、`allowed_tools`、环境策略和 MCP allowlist 裁剪模型可见工具。
  - 第一批项目内 Skill 为 `fde-pipeline`、`fde-diagnosis`、`fde-collaboration`，不做独立 Skill 市场或动态安装。
  - Pipeline 主链路的构建、GitOps 写入、Git 提交和 ArgoCD 同步仍由确定性代码执行；Skill 只进入 YAML Governance、构建失败修复建议和摘要生成等智能检查点。

### DONE-20260618-06：Pipeline AI 检查点与自动化动作边界确认

- **状态**：已确认
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`docs/implementation/steps/05-Pipeline智能体核心.md`、`tests/agents/pipeline/pipeline-agent.test.ts`
- **说明**：确认构建镜像、Git commit / push、ArgoCD 同步请求都属于确定性自动化动作，不由 AI 循环执行。AI 只在 Git 提交前的 YAML Governance 检查点审查 `yaml.diff`、上下文和风险，不能直接获得 `run_command` 或外部系统 MCP 工具来执行发布动作。

### DONE-20260618-07：Pipeline / Diagnosis / Collaboration AI 分析边界确认

- **状态**：已确认
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`docs/implementation/steps/05-Pipeline智能体核心.md`
- **说明**：确认三个 Agent 都可能使用 AI 分析，但分析层级不同。Pipeline YAML Governance 是发布前质量门禁，负责判断 `yaml.diff` 能否进入 GitOps 仓库；Diagnosis Agent 是故障解释，负责根因、影响、修复建议和证据；Collaboration Agent 是协作表达与跟踪判断，负责通知摘要、责任人、升级判断和日报。Pipeline 的治理结果可作为后续 Diagnosis 和 Collaboration 的 artifact 输入，但不共享 AI 决策职责。

### DONE-20260618-09：Pipeline 自动修改边界确认

- **状态**：已确认
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`docs/implementation/steps/05-Pipeline智能体核心.md`、`docs/implementation/steps/07-YAML治理智能体.md`
- **说明**：确认 Pipeline Agent 当前不自动修改业务源码、Dockerfile、构建脚本或测试代码。Pipeline 允许自动修改的是 GitOps 配置仓库，且必须通过确定性代码执行、生成 `yaml.diff`、进入 YAML Governance 审查后再提交。当前代码只实现单容器镜像字段更新；后续如果需要删除资源、删除字段或修改其他 YAML 字段，必须先表达为结构化 GitOps 变更计划，并受策略、环境和审查约束。

---

## 2. 已完成实施记录

### DONE-20260627-01：中文运行时文案资源化

- **状态**：已完成代码实现，已通过聚焦测试和构建验证
- **提出时间**：2026-06-27
- **完成时间**：2026-06-27
- **影响范围**：`src/i18n/zh.json`、`src/i18n/messages.ts`、`src/app/service-runtime.ts`、`src/runtime/`、`src/events/`、`src/connectors/feishu/`、`src/radars/compliance/`、`src/agents/pipeline/state-machine.ts`、`.env.example`、`.env.production.example`
- **说明**：中文展示文案、运行时错误消息、飞书回调错误、事件入口认证错误、合规探针提示和 Pipeline 状态转换原因统一进入 `src/i18n/zh.json`。环境变量只保留密钥、目标、开关、URL 等部署配置，不承载中文文案。运行时代码通过 `loadZhMessages()` 读取资源，动态文案使用模板占位符。
- **验证记录**：已确认旧的启动消息正文变量和按钮文案变量不再存在；运行时代码中文字符串只剩 `zh.json` 资源和代码注释中的示例。

### DONE-20260627-02：服务器部署目录与远程仓库命名确认

- **状态**：已确认
- **提出时间**：2026-06-27
- **完成时间**：2026-06-27
- **影响范围**：服务器部署命令、部署文档、后续运维操作记录
- **说明**：服务器部署目录、远程仓库名称和本地开发目录不要求同名，但后续命令必须明确使用真实路径，不能假设目录名。
- **命名记录**：
  - 本地开发目录：`C:\Document\Gongji Tech\FDE Workstation`
  - 服务器部署目录：`/opt/fde-workstation`
  - GitHub 远程仓库：`shawns-yao/FDE-workflow`
  - Git 远程地址：`https://github.com/shawns-yao/FDE-workflow.git`
  - 服务器已拉取提交：`f5fa0b0`
- **结论**：部署命令统一以 `/opt/fde-workstation` 为服务器路径；代码同步统一以 `https://github.com/shawns-yao/FDE-workflow.git` 为远程仓库。`fde-workstation` 表示服务器上的服务部署目录，`FDE-workflow` 表示 GitHub 代码仓库名，两者可以不同。

### DONE-20260627-03：飞书启动测试变量用途边界确认

- **状态**：已确认
- **提出时间**：2026-06-27
- **完成时间**：2026-06-27
- **影响范围**：`.env.example`、`.env.production.example`、`src/app/service-runtime.ts`、`src/main.ts`、`docs/implementation/steps/03-飞书连接器.md`
- **说明**：飞书启动测试变量对当前服务器部署验收有用，但不是正式业务通知配置。它验证服务进程内的飞书发送、卡片、艾特、按钮和回调能力；正式服务中的通知对象、艾特对象、卡片动作和交互状态必须由业务事件、责任人映射、协同通知路由和卡片生成逻辑决定，不能依赖启动测试环境变量。
- **变量边界**：
  - `FDE_FEISHU_STARTUP_MESSAGE_ENABLED`：有用，仅作为部署验收开关，默认必须为 `false`。
  - `FEISHU_STARTUP_MESSAGE_CHAT_ID`：有用，仅指定部署验收消息发送到哪个测试群。
  - `FEISHU_STARTUP_MENTION_OPEN_IDS`：有用，用于手动验证指定 open_id 的艾特渲染；正式通知应来自责任人映射或通知路由。
  - `FEISHU_STARTUP_MENTION_FROM_CHAT_MEMBERS` / `FEISHU_STARTUP_MENTION_LIMIT`：有用，用于验证群成员读取权限和自动艾特能力；正式通知不应随机艾特群成员，生产环境默认保持 `false`。
  - `FEISHU_STARTUP_ACTION_URL`：有用，用于验证 `open_url` 按钮渲染；正式服务中的跳转地址应由业务 artifact、工单、构建详情或诊断报告生成。
  - `FEISHU_STARTUP_ENABLE_CALLBACK_ACTIONS`：有用，用于验证 `acknowledge` 类按钮能回流到服务；正式服务中的 `acknowledge`、`claim`、`mark_fixed` 等动作应由 Collaboration Agent 的卡片状态机生成。
- **后续处理**：在 Tekton / ArgoCD / GitOps 真实事件通知链路完成并通过联调后，应把启动测试变量降级为手动 smoke 工具，或从生产环境模板中移除，只保留正式业务通知配置。

### DONE-20260627-04：环境变量模板 ASCII 化

- **状态**：已完成
- **提出时间**：2026-06-27
- **完成时间**：2026-06-27
- **影响范围**：`.env.example`、`.env.production.example`、服务器 Docker Compose 部署流程
- **问题**：服务器执行 `docker compose --env-file .env.production` 时，`.env.production` 第一行中文注释触发解析失败。该文件由含中文注释的 `.env.production.example` 复制而来，说明可提交模板存在生产使用风险。
- **处理**：环境变量模板中的注释统一改为 ASCII 英文，避免 Compose、Shell、编辑器编码和终端显示差异影响部署。中文展示文案继续放在 `src/i18n/zh.json`，中文说明放在文档中，不放入可被 `--env-file` 直接读取的模板。
- **结论**：`.env.example` 和 `.env.production.example` 只承载键名、默认值、英文部署提示和占位配置；`.env`、`.env.production` 仍然不提交，真实密钥只保存在本机或服务器。

### DONE-20260627-05：Redis 空环境变量不再覆盖 REDIS_URL

- **状态**：已完成代码修复
- **提出时间**：2026-06-27
- **完成时间**：2026-06-27
- **影响范围**：`src/config/redis.ts`、`tests/config/redis-config.test.ts`、Docker Compose 生产部署
- **问题**：服务器部署时 `.env.production` 同时存在 `REDIS_URL=redis://redis:6379/0` 和空的 `REDIS_HOST=` 等拆分字段。旧逻辑使用 `??` 判断，空字符串会被当成有效配置，导致应用容器连接空主机并出现 `ioredis ECONNREFUSED`，即使 Redis 容器本身已经 healthy。
- **处理**：Redis 配置加载时先 trim 字符串，空字符串统一视为未配置。`REDIS_HOST`、`REDIS_PORT`、`REDIS_DB`、`REDIS_PASSWORD`、`REDIS_KEY_PREFIX`、stream 名称等字段不会再用空值覆盖 `REDIS_URL` 或默认值。
- **验证记录**：新增回归测试覆盖 `REDIS_URL` 与空拆分字段同时存在的场景，确保最终主机仍解析为 `redis`。

### DONE-20260627-06：飞书卡片 acknowledge 最小协同消费者

- **状态**：已完成最小闭环代码实现
- **提出时间**：2026-06-26
- **完成时间**：2026-06-27
- **影响范围**：`src/agents/collaboration/`、`src/app/service-runtime.ts`、`tests/agents/collaboration/`、`tests/app/service-runtime.test.ts`
- **说明**：新增 Collaboration Event Consumer，订阅 `feishu.card.action_clicked`，只处理 `acknowledge` 动作。消费者会调用飞书连接器 `updateCard(message_id)` 将原卡片更新为 `acknowledged` 状态，并发布 `collaboration.progress.updated`。服务运行时已接入该消费者，长连接或 HTTP callback 写入事件总线后，主服务进程可以消费该事件。
- **幂等策略**：按 `message_id + action_type + action_value` 写入业务幂等键，重复点击同一卡片确认按钮不会重复更新卡片或重复发布进度事件。
- **验证记录**：新增聚焦测试覆盖 acknowledge 消费、卡片更新、进度事件发布、重复点击幂等和服务运行时 wiring。
- **剩余细节**：飞书更新失败当前依赖 `EventSubscriber` 进入重试或死信路径；上游 OpenAPI 失败错误码到业务 `ErrorObject` 的更细分类可后续增强。

### DONE-20260627-07：飞书卡片 claim 动作进入 investigating 状态

- **状态**：已完成代码实现，待服务器联调验证
- **提出时间**：2026-06-27
- **完成时间**：2026-06-27
- **影响范围**：`src/agents/collaboration/collaboration-event-consumer.ts`、`tests/agents/collaboration/collaboration-event-consumer.test.ts`
- **说明**：Collaboration Event Consumer 支持消费 `claim` 卡片动作，并将协同进度状态映射为 `investigating`。消费者会更新原飞书卡片，发布 `collaboration.progress.updated`，并复用现有 `message_id + action_type + action_value` 幂等策略。
- **验证记录**：新增聚焦测试覆盖 `claim -> investigating`，并确认原有 `acknowledge -> acknowledged` 行为仍通过。
- **剩余细节**：超时升级和完整协同状态机仍未实现。

### DONE-20260627-08：飞书卡片 mark_fixed 动作进入 fixed 状态

- **状态**：已完成代码实现，待服务器联调验证
- **提出时间**：2026-06-27
- **完成时间**：2026-06-27
- **影响范围**：`src/agents/collaboration/collaboration-event-consumer.ts`、`tests/agents/collaboration/collaboration-event-consumer.test.ts`
- **说明**：Collaboration Event Consumer 支持消费 `mark_fixed` 卡片动作，并将协同进度状态映射为 `fixed`。消费者会更新原飞书卡片，发布 `collaboration.progress.updated`，并复用现有业务幂等策略。
- **验证记录**：新增聚焦测试覆盖 `mark_fixed -> fixed`，并确认 `acknowledge -> acknowledged`、`claim -> investigating` 行为仍通过。
- **剩余细节**：超时升级和完整协同状态机仍未实现。

### DONE-20260627-09：飞书消息回复确定性进度识别

- **状态**：已完成最小代码实现，待服务器联调验证
- **提出时间**：2026-06-27
- **完成时间**：2026-06-27
- **影响范围**：`src/agents/collaboration/collaboration-event-consumer.ts`、`src/connectors/feishu/types.ts`、`src/connectors/feishu/long-connection-client.ts`、`src/connectors/feishu/memory-feishu-connector.ts`、`tests/agents/collaboration/collaboration-event-consumer.test.ts`、`tests/connectors/feishu/long-connection-client.test.ts`、`tests/connectors/feishu/callback-handler.test.ts`
- **说明**：飞书 `im.message.receive_v1` 和 HTTP callback 回复事件会结构化提取 `latest_reply`。Collaboration Event Consumer 订阅 `feishu.message.replied`，对明确处理类回复做确定性识别，发布 `collaboration.progress.updated` 并标记 `status=investigating`、`reply_effectiveness=effective`；含糊回复标记为 `status=ineffective_reply`、`reply_effectiveness=ineffective`。该阶段不调用 AI。
- **验证记录**：新增聚焦测试覆盖长连接回复正文提取、HTTP callback 回复正文提取、有效回复进入 `investigating` 和含糊回复进入 `ineffective_reply`。
- **剩余细节**：回复有效性当前只使用关键词规则，后续需要接入 Collaboration Agent 的 Claude API 契约输出 evidence 和 confidence；超时升级和完整协同状态机仍未实现。

### DONE-20260625-01：Docker / Nginx 第一阶段线上边界

- **状态**：已完成
- **提出时间**：2026-06-25
- **完成时间**：2026-06-25
- **影响范围**：`Dockerfile`、`.dockerignore`、`docker-compose.prod.yml`、`deploy/nginx/conf.d/fde.conf`、`.env.production.example`、`package.json`、`src/config/env.ts`、`src/app/fde-http-server.ts`、`src/main.ts`、`docs/deployment/server-docker-deploy.md`
- **说明**：完成第一阶段生产形态边界：FDE Workstation 使用 Docker 构建，Redis Streams 以容器方式运行并持久化，Nginx 作为 HTTP 反向代理入口，生产环境变量独立为 `.env.production`，生产启动前校验关键飞书与 Redis 配置。HTTP 服务新增 `/ready`，请求体大小限制和生产启动结构化错误输出。
- **剩余**：
  - Nginx HTTPS 证书自动化未纳入本阶段；飞书正式回调仍需要 HTTPS 域名或外层 TLS 终止。
  - k3s、Tekton、ArgoCD 和真实 GitOps 仓库联调不属于本阶段。

### DONE-20260617-03：清理上一版自建平台代码

- **状态**：已完成
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`apps/`、`packages/`、`mcp-servers/`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`turbo.json`、`tsconfig*.json`、`docker-compose.yml`、`.env.example`
- **说明**：删除上一版服务化平台骨架，避免后续实现继续沿旧方向推进。
- **实施记录**：2026-06-17 已删除上一版未跟踪的服务化平台代码和根目录 monorepo 配置；删除前已创建临时 zip 备份。

### DONE-20260617-04：移除旧服务化细化稿

- **状态**：已完成
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`docs/architecture/`、`docs/superpowers/plans/`
- **说明**：删除上一版围绕 PostgreSQL、outbox、worker、MCP HTTP 服务和十模块服务化拆分的细化稿，避免与当前方向冲突。

### DONE-20260617-05：外部系统凭据与占位符清单

- **状态**：已完成
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`docs/architecture/external-system-access-requirements.md`
- **说明**：按新方向重写 GitLab CI/CD variables、Tekton 参数、ArgoCD/K8s 只读权限、飞书 webhook / OpenAPI、Claude API Key 的注入方式。

### DONE-20260617-08：步骤化实施文档设计

- **状态**：已完成
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`docs/implementation/steps/`
- **说明**：按依赖链路建立 00 到 16 号实施步骤文档，不再按周拆分。每个步骤明确目标、边界、上游输入、输出结果、接口契约、处理流程、文件结构、下游衔接、验证方式、风险与降级。
- **结论**：代码落地顺序应先实现 `00-基础契约.md` 到 `03-飞书连接器.md` 的底座，再实现 `04-合规检测雷达.md`，随后进入 Pipeline、Diagnosis、Collaboration 三个 Agent 的业务步骤。

### DONE-20260617-09：实施文档契约一致性修正

- **状态**：已完成
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`docs/implementation/steps/`、`docs/architecture/fde-platform-m1-contracts.md`、`docs/architecture/fde-platform-m1-design.md`、`docs/architecture/m1-implementation-design.md`、`docs/requirements/milestone-1-plan.md`
- **说明**：统一事件 type、修正环境枚举、补充 Agent Runtime 调用约束、明确知识库匹配为 stub、对齐 Diagnosis 的 `source` 与 `funnel_layer` 字段、统一 permission profile 命名、补充端到端 fixture 编排，并把 W1-T4 修正为内部环境 API 可用性检测。
- **结论**：后续逐个讨论实施文档时，应先从 `00-基础契约.md`、`01-事件总线.md`、`02-智能体运行时.md`、`03-飞书连接器.md` 开始加厚设计，再进入业务 Agent。

### DONE-20260617-11：00-04 底座代码骨架落地

- **状态**：已完成
- **提出时间**：2026-06-17
- **完成时间**：2026-06-17
- **影响范围**：`src/common/`、`src/config/`、`src/events/`、`src/runtime/`、`src/connectors/feishu/`、`src/radars/compliance/`、`schemas/`、`fixtures/`、`tests/`、`docker-compose.yml`
- **说明**：落地 00-04 的底座实现，包括公共契约类型、敏感字段脱敏、JSON Schema `$ref` 校验、CloudEvents 类型、入口 webhook token 校验、框架无关事件入口编排服务、框架无关 HTTP webhook handler、内存事件总线、Redis Streams 事件总线适配器、Redis Streams 手动冒烟命令、Docker Redis 配置、pending 重试、稳定死信载荷、事件归档接口、Runtime 任务契约、权限校验、超时状态、`run_command` 命令白名单、飞书连接器接口、飞书 webhook 发送器、飞书 OpenAPI 发送/更新/回复适配器、飞书回调签名校验、飞书回调编排与事件回流服务、合规雷达扫描引擎、HTTP probe、默认发布到 Redis Streams 的雷达扫描 CLI、雷达周期调度 CLI、定时调度器、JSON/Markdown 报告 artifact 和历史仓储。
- **验收**：TypeScript 构建通过；聚焦测试通过；fixture/schema 矩阵通过；Redis 使用 `docker-compose.yml` 提供容器配置。GitLab、Tekton、ArgoCD、Kubernetes 已提供可注入 HTTP probe；飞书 webhook_bot 和 openapi_bot 适配器已实现。真实环境变量配置和联调尚未执行。

### DONE-20260618-04：Pipeline AI 检查点阻断策略落地

- **状态**：已完成
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`src/agents/pipeline/pipeline-agent.ts`、`src/runtime/agent-runtime.ts`、`src/common/schema-registry.ts`、`schemas/connectors/feishu/card.schema.json`、`docs/implementation/steps/02-智能体运行时.md`、`docs/implementation/steps/03-飞书连接器.md`、`docs/implementation/steps/05-Pipeline智能体核心.md`
- **说明**：Pipeline Agent 在 YAML Governance 返回后不再只看 `TaskResult.status`，会在 Git 提交前检查结构化结果。`approved !== true`、`risk_level = high | critical` 或缺少结构化治理字段都会阻断 Git 提交和 ArgoCD 同步。Runtime 增加 `runtime_type + runtime_capability` 执行器选择说明，并校验入口 capability 一致性。SchemaRegistry 补充 `additionalProperties`、`minLength` 和 `minimum` 校验，飞书 `card.schema.json` 明确校验完整 `SendCardInput`。
- **验收**：Runtime 定向测试通过；Pipeline Agent 定向测试通过；关键 fixture schema 验证通过。

### DONE-20260618-05：`code_runtime` 第一版无头执行器接入

- **状态**：已完成第一版
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`src/runtime/adapters/anthropic/`、`src/runtime/executors/code-runtime/`、`src/agents/pipeline/`、`schemas/pipeline/yaml-governance-result.schema.json`、`prompts/pipeline/yaml-governance.md`
- **说明**：新增 Anthropic Messages API 适配器和 `code_runtime:code_task` 执行器。Pipeline YAML Governance 会把 `yaml.diff` artifact 传入 Runtime；执行器读取 prompt 与 artifact，调用模型，解析 JSON，按 `schema_ref` 校验结构化结果，并写入 `agent_task_result` artifact。执行器已支持 Anthropic `tool_use` 最小循环、`read_file` / `list_files` 受限工作区只读工具、受命令白名单约束的 `run_command` 内置工具和 `tool_trace` artifact。缺少 `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` 时仍返回 `MODEL_NOT_CONFIGURED`，不静默跳过 AI 检查点。
- **验收**：`code_runtime` 执行器定向测试通过；类型检查通过。

### DONE-20260618-08：代码事实与文档契约对齐

- **状态**：已完成
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`docs/implementation/steps/02-智能体运行时.md`、`docs/implementation/steps/03-飞书连接器.md`、`docs/implementation/steps/04-合规检测雷达.md`、`docs/implementation/steps/05-Pipeline智能体核心.md`、`docs/architecture/fde-platform-m1-contracts.md`、`docs/requirements/milestone-1-plan.md`、`src/common/`、`src/runtime/`、`src/events/`、`src/connectors/feishu/`、`src/radars/compliance/`、`src/agents/pipeline/`
- **说明**：按当前代码事实修正文档和测试口径。SchemaRegistry 支持 `anyOf` 与 `pattern`，Agent Runtime schema 支持 `mcp__<server>__<tool>` 工具名；权限 profile 支持 MCP server/tool allowlist；Pipeline YAML Governance 当前只开放 `read_file`、`list_files`，不开放 `run_command`、写文件工具或外部系统 MCP 工具；`yaml.diff` artifact 使用事件 `run_id`；治理失败或阻断时回滚本次 changed_files；`code_runtime:repair_task` 已注册到 Pipeline build fix 挂载点；飞书 OpenAPI 发送目标映射为 user/open_id、chat 或 group/chat_id；EventSubscriber 保留处理器抛出的完整 `ErrorObject`；合规雷达执行异常发布 `result_kind=execution_error` 的标准失败事件。
- **剩余**：外部系统真实 MCP server、HTTP/SSE transport、OAuth/token refresh、后台工具发现刷新、`edit_file`、`write_file`、`read_artifact`、`write_artifact`、`create_patch`、`validate_schema` 等模型可见 provider 工具仍需继续实现。

### DONE-20260618-10：飞书 OpenAPI smoke 命令

- **状态**：已完成代码实现，待个人飞书环境真实发送验证
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`src/connectors/feishu/`、`src/cli/`、`package.json`、`docs/implementation/steps/03-飞书连接器.md`
- **说明**：新增 `npm run feishu:send-smoke`，CLI 启动时加载本地 `.env`，再从 `process.env` 读取 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_TEST_CHAT_ID`，调用 `OpenApiFeishuConnector.sendCard` 向测试群发送 OpenAPI 交互卡片。命令只输出 `SendCardResult`，不输出 App Secret、tenant_access_token 或原始请求体。仓库只提交 `.env.example` 变量模板，真实 `.env` 不提交。
- **剩余**：需要在本地配置真实飞书环境变量后执行 smoke 命令，验证机器人是否已加入测试群、`chat_id` 是否正确、应用权限和数据范围是否可用。

### DONE-20260618-11：项目级服务启动入口

- **状态**：已完成第一版
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`src/app/`、`src/main.ts`、`package.json`、`.env.example`、`docs/implementation/steps/03-飞书连接器.md`
- **说明**：新增 `npm run start` 项目服务入口。服务启动时加载本地 `.env`，初始化事件总线、飞书连接器、飞书回调处理器和 HTTP 服务，暴露 `GET /health`、`POST /webhook/gitlab`、`POST /webhook/tekton`、`POST /webhook/argocd`、`POST /webhook/kubernetes`、`POST /webhook/feishu/callback`。`/webhook/feishu/callback` 进入既有飞书回调处理器，再发布为标准 CloudEvent。`FDE_EVENT_BACKEND` 默认使用 Redis Streams，测试或本地隔离可设为 `memory`。
- **剩余**：需要接入真实 Redis、配置飞书开放平台回调 URL，并完成真实 URL verification 与回调事件回流验证。

### DONE-20260618-12：服务进程内飞书启动消息

- **状态**：已完成代码实现，已通过真实飞书群发送验证
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`src/app/service-runtime.ts`、`src/main.ts`、`src/i18n/zh.json`、`.env.example`、`.env.production.example`、`docs/implementation/steps/03-飞书连接器.md`
- **说明**：启动测试消息由 `FDE_FEISHU_STARTUP_MESSAGE_ENABLED=true` 触发。项目服务启动成功后，会通过服务运行时持有的飞书连接器向 `FEISHU_STARTUP_MESSAGE_CHAT_ID`、`FEISHU_TEST_CHAT_ID` 或 `FEISHU_DEFAULT_CHAT_ID` 异步发送一条 `custom` 卡片。卡片正文和按钮文案统一来自 `src/i18n/zh.json`，不通过环境变量配置。该异步发送不得阻塞 HTTP 服务启动，但必须输出结构化 `feishu_startup_message_result`，成功包含 `sent/message_id/target_id/sent_at`，失败包含标准 `ErrorObject`。该路径用于验证“服务进程内发送飞书消息”，不是 `feishu:send-smoke` 辅助命令，也不是正式业务通知可靠投递链路。
- **验证记录**：2026-06-18 已使用真实 `.env` 启动项目服务，飞书 OpenAPI 返回 `sent`，用户确认个人飞书群已收到启动测试卡片。随后连续 3 次使用随机启动消息验证，均返回 `sent` 和独立 `message_id`。2026-06-27 已改为 `zh.json` 文案资源驱动，环境变量只保留开关和目标配置。

### DONE-20260618-13：飞书启动测试卡片 mentions 与交互按钮

- **状态**：已完成代码实现，卡片和按钮已通过真实飞书发送验证，@ 人待提供 open_id 或群成员读取权限验证
- **提出时间**：2026-06-18
- **完成时间**：2026-06-18
- **影响范围**：`src/connectors/feishu/openapi-feishu-connector.ts`、`src/connectors/feishu/types.ts`、`src/connectors/feishu/connector.ts`、`src/app/service-runtime.ts`、`.env.example`、`docs/implementation/steps/03-飞书连接器.md`
- **说明**：OpenAPI 连接器支持把 `mentions.type=user` 渲染为飞书 lark_md 的 `<at id=ou_xxx></at>`，支持 `open_url` 和 `acknowledge` 等交互按钮。服务启动测试卡片支持 `FEISHU_STARTUP_MENTION_OPEN_IDS` 显式 @ 人，也支持 `FEISHU_STARTUP_MENTION_FROM_CHAT_MEMBERS=true` 时调用飞书群成员接口读取 open_id。按钮文案来自 `src/i18n/zh.json`，不通过环境变量覆盖。显式 open_id 优先；群成员读取缺权限时返回结构化 `failed`，不静默发送缺少 @ 的卡片。
- **剩余**：真实 @ 人验证需要提供用户 open_id，或为飞书应用开通群成员读取权限后启用 `FEISHU_STARTUP_MENTION_FROM_CHAT_MEMBERS=true`。

---

## 3. 待实施

### TODO-20260617-07：底座契约落地

- **状态**：已完成底座实现，待外部系统接入
- **提出时间**：2026-06-17
- **影响范围**：`events/`、`connectors/feishu/`、`agent-runtime/`、`schemas/`
- **说明**：已落地 CloudEvents 事件信封、入口 webhook token 校验、框架无关事件入口编排服务、框架无关 HTTP webhook handler、Redis Streams 配置工厂、Redis Streams 手动冒烟命令、IM 连接器边界、飞书 webhook_bot 发送器、飞书 openapi_bot 发送/更新/回复适配器、飞书回调校验、标准化和事件回流服务、FDE Agent Runtime 任务契约、权限校验、Artifact 规范、错误结构、Schema 校验命令和本地 artifact 写入器。后续仍需接入真实外部系统联调配置。
- **验收**：GitLab / Tekton / ArgoCD / K8s / Feishu 样例事件可映射到统一信封；Agent task 输入输出 schema 可校验；Redis 配置可通过 `npm run redis:config` 查看；Redis 容器配置可通过 `docker compose config` 验证；已有 Redis 实例时可通过 `npm run events:redis-smoke` 做发布和消费冒烟验证。

### TODO-20260617-02：合规检测雷达

- **状态**：已完成底座实现，待真实环境联调
- **提出时间**：2026-06-17
- **影响范围**：`radars/compliance/`、`connectors/gitlab/`、`connectors/tekton/`、`connectors/argocd/`、`connectors/k8s/`、`schemas/compliance/`、`artifacts/compliance/`
- **说明**：已落地扫描请求、扫描结果、探测器接口、GitLab/Tekton/ArgoCD/Kubernetes HTTP probe、状态计算、扫描事件生成、JSON/Markdown 报告写入、内存历史仓储、默认发布到 Redis Streams 的 `npm run radar:scan` 单次扫描入口、`npm run radar:schedule` 周期调度入口和定时调度器。后续仍需完成真实环境变量装配、外部系统联调和调度部署。
- **验收**：输出 `environment-check-report.json` 和 Markdown 报告；GitLab / Tekton / ArgoCD / K8s 全部 healthy 时发布 `compliance.environment.scan.completed`，任一目标 warning 或 critical 时发布 `compliance.environment.scan.failed`；周期调度每次触发生成新的 `scan_id`；Pipeline preflight 遇到 critical 必须阻断真实执行。

### TODO-20260617-13：Pipeline Agent 核心实现

- **状态**：核心模块已实现，待真实外部系统联调
- **提出时间**：2026-06-17
- **最近更新时间**：2026-06-18
- **影响范围**：`src/agents/pipeline/`、`src/integrations/`
- **说明**：按 `05-Pipeline智能体核心.md` 实现 Pipeline Agent 的确定性核心。当前已完成事件消费、解析、预检、GitOps 配置更新、ArgoCD 同步触发和运行时挂载点基础实现；真实 GitOps 仓库、ArgoCD、Redis 运行环境尚未联调。
- **当前联调范围**：先覆盖 Tekton 构建完成事件、单容器 YAML 镜像字段更新、完整 unified diff artifact、YAML 治理无头代码运行时、Git 提交推送和 ArgoCD 同步触发。合规检测雷达 preflight、构建失败修复和通用 GitOps 变更计划扩展不进入当前 05 联调主路径。
- **已校正内容**：
  - Git 操作封装改为参数数组执行，不拼接 shell 字符串。
  - Git 凭据通过环境变量传递，不进入命令参数，错误输出需脱敏。
  - Pipeline 状态机发布的事件类型收敛到 `01-事件总线.md` 的事件清单：`pipeline.build.completed`、`pipeline.deployment.failed`、`gitops.yaml.updated`。
  - 事件总线 `ack` / `nack` 作为可选能力保留，避免强迫内存实现和 Redis Streams 实现暴露不完整语义。
- **已实现内容**：
  - Tekton `tekton.pipelinerun.completed` 事件解析，成功或失败通过 `data.status` 区分。
  - 原生 Deployment YAML 镜像字段更新器，支持 `spec.template.spec.containers[0].image` 的单容器受限更新；这是当前 GitOps 变更执行器的第一类 operation。
  - YAML 更新成功后输出完整 unified diff 格式的 `yaml.diff` artifact，artifact 目录使用事件 `run_id`，供后续诊断和协同链路引用。
  - Pipeline Agent 主流程：幂等校验、合规检测雷达 preflight、仓库准备、GitOps 配置变更、Git 提交、ArgoCD 同步触发、发布 `gitops.yaml.updated` / `argocd.application.sync.requested` / `pipeline.build.completed` / `pipeline.deployment.failed`。
  - Pipeline Agent Runtime 挂载点基础版：YAML 治理在 Git 提交前调用 `runCodeTask`，治理结果进入 `pipeline.build.completed` 事件；构建失败修复在失败路径调用 `runRepairTask`。
  - YAML Governance 结构化结果提交前阻断策略：`approved !== true`、`risk_level=high|critical`、缺少结构化治理结果或 Runtime 未配置时停止 Git 提交和 ArgoCD 同步。
  - YAML Governance 当前任务工具收窄为 `read_file`、`list_files`；治理失败或阻断时回滚本次 changed_files，避免未提交脏文件留在 GitOps 工作区。
  - Pipeline service factory 注册 `code_runtime:code_task` 和 `code_runtime:repair_task`，构建失败修复挂载点可通过 `FDE_PIPELINE_ENABLE_BUILD_FIX=true` 开启；专用构建修复 prompt、schema 和 patch 工具仍待补齐。
  - Pipeline 事件消费者基础版：通过 `EventSubscriber` 订阅 `tekton.pipelinerun.completed`，接入 Pipeline Agent 主流程。
  - Pipeline Worker 运行入口基础版：`npm run pipeline:worker` 使用 Redis 事件基础设施启动消费者。
  - ArgoCD 同步控制器基础版：通过 API 触发应用同步，缺少端点或 Token 时返回 `CONFIGURATION_INVALID`。
- **实现范围（M1）**：
  - Tekton HTTP Endpoint 属于 `01-事件总线.md`，Pipeline Agent 只消费标准事件
  - Tekton 事件解析（已实现基础版）
  - 合规检测雷达 preflight（已实现基础版）
  - Pipeline 状态机（已实现内存版）
  - Git 操作封装（已实现基础版）
  - GitOps 配置变更执行（已实现单容器镜像字段受限版）
  - YAML 完整 unified diff artifact 输出（已实现）
  - ArgoCD 同步触发（已实现基础版，配置开关默认关闭）
  - 主交付链路串联（已实现，待真实 GitOps 仓库和 ArgoCD 联调）
- **剩余未完成**：
  - Pipeline 状态持久化、失败重试和死信事件。
  - GitOps 变更执行器升级为结构化变更计划：支持 `set_image`、`set_field`、`remove_field`、`remove_resource` 等 operation；删除类 operation 必须显式配置或审批，并进入 YAML Governance 审查。
  - YAML 更新器升级为完整 YAML AST 方案；多容器、Helm Values、Kustomize 必须通过显式配置开启。
  - YAML 治理 Runtime 挂载点已接入 prompt、schema、artifact 输入输出；仍需联调真实 Anthropic API 和真实 GitOps diff。
  - `code_runtime` 第一版真实执行器已接入；已支持最小 tool_use 循环、只读文件工具和受控命令工具；写入工具、artifact 读写工具、patch 工具、schema 工具、并发/重试和更完整的 Claude Code 工具协议仍需继续迁移。
- **配置项**：
  - `GITOPS_REPO_URL`：配置仓库地址（暂定，当前无远程仓库）
  - `IMAGE_FIELD_PATH`：镜像字段路径（占位符，不同项目路径可能不同）
  - `YAML_FILE_NAME`：YAML 文件名（通用化，不固定，默认 `{environment}.yaml`）
  - 不同项目的 Tag 解析规则
- **验收**：Tekton 构建完成后，能自动执行当前允许的 GitOps 配置变更，生成完整 `yaml.diff`，通过 YAML Governance 后 git commit + push。当前允许范围是单容器镜像字段更新。

### TODO-20260617-03：Pipeline Agent 运行时增强

- **状态**：待实施
- **提出时间**：2026-06-17
- **影响范围**：`ci/gitlab/`、`ci/tekton/`、`prompts/pipeline/`、`schemas/pipeline/`
- **说明**：按 `06-MR评审智能体.md`、`07-YAML治理智能体.md`、`08-构建失败修复智能体.md` 实现 FDE Agent Runtime 增强。MR 阶段做语义评审，YAML 更新后做配置治理，构建失败后生成修复建议或补丁。
- **验收**：能输出 MR 评审报告、YAML audit report 和构建失败修复报告；prod 环境只输出建议，不自动提交。

### TODO-20260618-03：`code_runtime` 完整工具调用循环迁移

- **状态**：部分完成，继续实施
- **提出时间**：2026-06-18
- **影响范围**：`src/runtime/`、`schemas/agent-runtime/`、`prompts/pipeline/`、`src/agents/pipeline/`
- **说明**：按 `02-智能体运行时.md` 的 `cc/` 迁移矩阵继续实现完整 `code_runtime` 能力。第一版已经能执行无头模型任务、读取 artifact、校验结构化 JSON，并支撑 Pipeline Agent 的 Git 提交前 YAML diff 审查；后续需要补齐工具调用循环和受控文件操作能力。
- **实现范围**：
  - `code_runtime` 无头执行器骨架，参考 `cc/src/QueryEngine.ts` 的非交互任务生命周期。（已完成第一版）
  - FDE `CoreTool` / registry / ToolProvider 工具协议，吸收 `cc/packages/agent-tools` 的宿主无关抽象。（已完成第一版）
  - BuiltinToolProvider 和 McpToolProvider 宿主适配接口。（已完成第一版）
  - MCP provider 连接生命周期、鉴权入口、工具发现刷新、调用失败 ErrorObject 映射和权限配置接入。（已完成）
  - stdio MCP transport：initialize、`tools/list`、`tools/call`、`Content-Length` framing、请求超时和必需环境变量鉴权检查。（已完成）
  - `FDE_RUNTIME_MCP_SERVERS` 环境变量配置加载和 Runtime provider 装配。（已完成）
  - `read_file`、`edit_file`、`write_file`、`list_files` 的受限工作区实现。（read_file / list_files 已完成第一版；edit_file / write_file 待实现）
  - `run_command` 保持命令白名单，不开放通用 BashTool。（已完成第一版）
  - `structured-output` 工具，强制输出通过 `schema_ref` 校验。
  - Anthropic Messages API 最小 client、错误映射和 token usage 记录。（已完成第一版；重试待补）
  - tool trace artifact、治理报告 artifact 和失败阻断策略。（已完成第一版）
- **验收**：
  - Pipeline Agent 在 YAML 更新后调用真实 `code_runtime` 审查 `yaml.diff`。（已完成第一版）
  - 低风险变更返回 `approved=true` 后才允许 Git 提交。（已完成）
  - 高风险、schema 校验失败或 Runtime 未配置时返回标准 `TaskResult`，并阻断提交和 ArgoCD 同步。
  - 运行时对外不暴露 Claude Code 内部工具名。

### TODO-20260618-04：Runtime MCP 外部工具接入

- **状态**：stdio transport 已完成，真实外部系统接入待实施
- **提出时间**：2026-06-18
- **最近更新时间**：2026-06-18
- **影响范围**：`src/runtime/tools/mcp/`、`src/runtime/permissions.ts`、后续 GitLab / Tekton / ArgoCD / K8s / 飞书 MCP server 或连接器适配器
- **说明**：当前已经具备 MCP provider 宿主适配接口、连接生命周期、鉴权入口、工具发现刷新、调用失败 `ErrorObject` 映射、`mcp__server__tool` 命名规则、`permission_profile` 外部系统工具放行配置、stdio MCP transport 和 `FDE_RUNTIME_MCP_SERVERS` 配置加载。还没有接入 HTTP / SSE transport、外部系统鉴权刷新和真实工具实现。后续外部系统工具通过该层进入 Runtime，不直接写进业务 Agent。
- **验收**：
  - 能从受控 MCP server 发现工具并合并到 Runtime 工具池。（stdio mock server 已验证，真实 server 待接入）
  - `permission_profile` 支持按 server 或具体 tool 放行。（已完成）
  - 外部工具调用失败返回标准 `ErrorObject`，并写入 tool trace。（ErrorObject 映射已完成；真实 server trace 待联调）
  - Pipeline / Diagnosis / Collaboration 使用各自权限重新装配工具，不共享工具实例。

### TODO-20260626-01：FDE Agent Skills 目录与 Skill Loader 落地

- **状态**：待实施
- **提出时间**：2026-06-26
- **影响范围**：`skills/`、`agent-runtime/skills/`、`src/runtime/`、`schemas/common/agent-skill.schema.json`、`prompts/`、`fixtures/agent-skills/`
- **说明**：文档已确认 Skill 层。后续需要把 `fde-pipeline`、`fde-diagnosis`、`fde-collaboration` 三个项目内 Skill 落成仓库文件，并实现 Runtime 的 Skill Loader。Skill Loader 负责读取 `SKILL.md`、prompt、schema、fixture 和推荐工具清单，生成 Runtime task 的上下文候选；最终权限仍由 `permission_profile` 和 `allowed_tools` 裁剪。
- **验收**：
  - `skills/fde-pipeline/SKILL.md` 能描述 YAML Governance、build-fix 和 delivery-summary。
  - `skills/fde-diagnosis/SKILL.md` 能描述日志摘要、根因分析和证据引用。
  - `skills/fde-collaboration/SKILL.md` 能描述通知摘要、回复判断、卡片更新和日报生成。
  - Runtime 能加载 Skill 上下文，但 Skill 不能直接授予外部工具权限。
  - 缺失 Skill、schema 或 prompt 时返回标准 `CONFIGURATION_INVALID`。

### TODO-20260626-02：飞书卡片交互最小协同消费者

- **状态**：已完成最小闭环，详见 `DONE-20260627-06`
- **提出时间**：2026-06-26
- **完成时间**：2026-06-27
- **影响范围**：`src/agents/collaboration/`、`src/connectors/feishu/`、`src/events/`、`docs/implementation/steps/14-协同进度追踪.md`
- **说明**：当前已实现最小 Collaboration Agent 消费者：订阅 `feishu.card.action_clicked`，识别 `acknowledge`，调用飞书连接器 `updateCard(message_id)` 把原卡片更新为已确认状态，并发布 `collaboration.progress.updated`。该能力走确定性代码，不调用 AI。
- **验收**：
  - 点击“确认收到”后，服务端消费 `feishu.card.action_clicked`。（已完成）
  - 同一条飞书卡片按 `message_id` 更新为已确认状态。（已完成）
  - 重复点击满足幂等，不重复写入冲突状态。（已完成）
  - 飞书更新失败时进入事件重试或死信路径。（已完成基础路径；错误细分待增强）
  - 不依赖公网 HTTP callback，继续支持 SDK 长连接模式。（已完成，消费者接入事件总线）

### TODO-20260626-03：第一批外部 MCP 工具落地顺序

- **状态**：待实施
- **提出时间**：2026-06-26
- **影响范围**：`mcp-servers/`、`src/runtime/tools/mcp/`、`src/runtime/permissions.ts`、`src/agents/pipeline/`、`src/agents/diagnosis/`、`src/agents/collaboration/`
- **说明**：MCP 宿主能力已经有 stdio transport 和权限裁剪基础，下一步不应一次性实现所有外部系统工具。第一批按当前业务闭环优先级推进：先飞书卡片更新，再 Tekton 日志读取，再 ArgoCD 应用状态读取。触发构建、触发同步这类变更动作默认仍由业务 Agent 的确定性控制器执行，不直接暴露给 YAML Governance。
- **第一批工具**：
  - `mcp__feishu__update_card`：服务于 Collaboration Agent 的按钮反馈闭环。
  - `mcp__tekton__get_task_logs`：服务于 Pipeline 构建失败修复和 Diagnosis 日志摘要。
  - `mcp__tekton__get_pipeline_run`：服务于构建状态查询和证据引用。
  - `mcp__argocd__get_application`：服务于 Diagnosis 判断部署状态。
  - `mcp__argocd__get_operation`：服务于 Diagnosis 追踪同步失败原因。
- **验收**：
  - 每个 MCP 工具都有稳定输入 schema、输出 schema 和错误映射。
  - 每个工具都能被 `permission_profile` 按 server 或 tool 裁剪。
  - 工具调用写入 tool trace，不把原始 token、secret 或大日志内联到事件中。
  - 未配置凭据时返回 `CONFIGURATION_INVALID` 或 `AUTHENTICATION_FAILED`，不能静默降级。

### TODO-20260618-02：外部 Agent / 低代码产品模块借鉴评估

- **状态**：待评估
- **提出时间**：2026-06-18
- **影响范围**：`docs/implementation/steps/02-智能体运行时.md`、后续工作台、Agent 编排、工具注册、可视化配置
- **说明**：参考 Dify、Langflow、Flowise、n8n 等产品的工作流节点、工具注册、Agent-as-tool、Human-in-the-loop、可视化编排和执行观测能力。当前只借鉴模块边界和设计模式，不把这些产品直接嵌入 Pipeline 主链路。
- **验收**：形成 FDE 可复用模块清单，明确哪些进入 Runtime、哪些进入工作台、哪些不采用。

### TODO-20260617-04：Diagnosis Agent Claude API 契约

- **状态**：待实施
- **提出时间**：2026-06-17
- **影响范围**：`prompts/diagnosis/`、`schemas/diagnosis-result.schema.json`
- **说明**：定义 ArgoCD 状态、K8s Events、Pod logs、kubectl describe、构建日志的输入结构，输出标准化根因诊断 JSON。
- **验收**：诊断结果包含 `category`、`severity`、`summary`、`root_cause`、`impact`、`recommendation`、`evidence_refs`、`confidence`。

### TODO-20260617-05：Collaboration Agent Claude API 契约

- **状态**：待实施
- **提出时间**：2026-06-17
- **影响范围**：`prompts/collaboration/`、`schemas/notification-card.schema.json`
- **说明**：定义飞书通知、进度追踪、升级判断和日报生成的输入输出结构。
- **验收**：能根据诊断结果生成飞书通知摘要，能识别回复是否有效，能生成日报 Markdown。

---

## 4. 暂不实施

### HOLD-20260617-01：重型自建服务化平台

- **状态**：暂缓
- **提出时间**：2026-06-17
- **影响范围**：`apps/`、`packages/`、`mcp-servers/`
- **说明**：`control-plane`、`worker`、PostgreSQL outbox、MCP HTTP 服务、前端工作台、ROI 数据库等重型平台实现暂不进入第一批代码。但它们对应的数据契约、事件信封、artifact 和 runtime 边界不暂停，已进入 00 到 03 号底座步骤文档。

### HOLD-20260617-02：长期数据库和工作台

- **状态**：暂缓
- **提出时间**：2026-06-17
- **影响范围**：数据库、前端、审计、ROI、知识库审核
- **说明**：当前优先使用 GitLab、Tekton、ArgoCD、K8s、飞书的现有状态和 artifact。只有跨项目查询、长期统计和知识沉淀成为明确需求时，再引入数据库。

---

## 5. 下一步行动

1. 先完成服务器重新构建部署验证：
   - 当前本地代码已实现飞书 acknowledge 最小闭环。
   - 部署后需要验证按钮事件进入 Redis Streams 后，主服务进程能消费事件、更新原卡片并发布 `collaboration.progress.updated`。
2. 再落地项目内 Skill 目录和 Skill Loader（TODO-20260626-01）：
   - 先建 `skills/fde-pipeline`、`skills/fde-diagnosis`、`skills/fde-collaboration`。
   - Runtime 能读取 Skill 的 prompt、schema 和推荐工具。
   - Skill 只提供上下文和约束，不能扩大工具权限。
3. 再按最小业务闭环接入第一批 MCP 工具（TODO-20260626-03）：
   - 优先 `mcp__feishu__update_card`。
   - 其次 `mcp__tekton__get_task_logs` 和 `mcp__tekton__get_pipeline_run`。
   - 再接 `mcp__argocd__get_application` 和 `mcp__argocd__get_operation`。
4. Pipeline Agent 继续维持确定性主链路（TODO-20260617-13）：
   - Tekton 构建、GitOps 写入、Git commit / push、ArgoCD 同步请求不交给模型循环。
   - AI 只通过 `fde-pipeline` Skill 进入 YAML Governance 和构建失败修复建议。
5. Diagnosis / Collaboration 的 AI prompt 和 schema 后置推进：
   - `09-诊断上下文构建器.md` 到 `12-诊断大模型根因分析.md` 先解决证据结构。
   - `13-协同通知路由.md` 到 `15-协同日报生成.md` 再补通知摘要、回复判断和日报生成。
