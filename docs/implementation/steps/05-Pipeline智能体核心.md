# 05-Pipeline智能体核心

## 1. 目标

Pipeline Agent 是整套平台的交付自动化主干，承接 Tekton 构建与 ArgoCD 部署的中枢链路，核心定位是**事件驱动的 GitOps 全链路自动化调度**。

AI 是叠加在关键节点的增强能力，而非调度主体——这是设计的前提，也是和纯 Agent 驱动方案最核心的区别。

Pipeline Agent 监听交付全链路事件，自动化完成「构建完成 → 更新配置 → 触发部署 → 状态回传」的 GitOps 闭环，是连接 Tekton 构建与 ArgoCD 部署的核心枢纽。

当前 05 的实现范围收敛为 `Tekton 事件 -> 单容器 YAML 镜像更新 -> 完整 unified diff artifact -> YAML 治理无头代码运行时 -> Git 提交 -> ArgoCD 同步触发`。确定性主干不交给 AI 决策；代码默认保留纯确定性安全模式，但完整 AI Pipeline 验收必须开启 `FDE_PIPELINE_ENABLE_YAML_GOVERNANCE=true` 并接入 `code_runtime` 无头代码任务，否则只能算自动化模式，不能算智能增强链路。

## 2. 不做什么

```text
❌ 不做代码逻辑评审、安全扫描（归 MR 评审 Agent）
❌ 不做故障根因分析、错误定位（归诊断 Agent）
❌ 不做通知内容生成、责任人匹配（归协同 Agent）
❌ 不直接操作 K8s 集群资源，所有变更通过 GitOps YAML 声明式落地
❌ 不生成通知文案、不直接发飞书，通过事件总线复用能力
❌ 不直接调用 Claude Code CLI 或绕过 FDE Runtime 调用模型
❌ 当前不自动修改业务源码、Dockerfile、构建脚本或测试代码
❌ 不自动修改生产配置
❌ 不绕过 GitLab 分支保护
```

一句话总结：Pipeline Agent 管「交付流程的正确流转」，AI 管「流程中特定节点的智能增强」，二者主次分明。

## 3. 内部架构分层

Pipeline 域采用「核心主干 + 挂载式智能体」架构，核心层纯代码实现、100% 确定；智能增强层按需调用智能体运行时。

```text
Pipeline Agent 域
├─ 核心层（纯 TypeScript，无 AI）
│  ├─ 事件监听模块：消费事件总线的 Tekton/GitLab 事件
│  ├─ 状态机引擎：管理交付任务全生命周期状态
│  ├─ Git 操作管理器：仓库克隆、提交、推送、分支管理
│  ├─ GitOps 变更执行器：纯代码执行受控配置变更计划
│  └─ ArgoCD 同步控制器：调用 API 触发同步、追踪状态
│
└─ 智能增强层（挂载式，统一调用 Agent Runtime）
   ├─ 06-MR评审智能体：代码合入前智能评审（前置卡点）
   ├─ 07-YAML治理智能体：配置审计与自动补全（交付中卡点）
   └─ 08-构建失败修复智能体：构建错误自动修复（失败后置处理）
```

架构设计的两个关键原则：

```text
可插拔：AI 能力通过 Runtime 挂载；未开启 YAML Governance 时是确定性自动化模式，完整 AI Pipeline 验收必须启用该检查点
统一入口：所有 AI 能力都通过智能体运行时标准 API 调用，Pipeline Agent 感知不到底层模型
```

### 3.1 为什么核心链路不用 AI 仍然是 Agent

Pipeline Agent 不是因为“每一步都调用 AI”才成立，而是因为它具备目标驱动、事件消费、状态流转、工具调用、失败处理和智能增强挂载点。

```text
Agent 属性：
  - 目标：保障构建完成后的 GitOps 交付链路自动推进
  - 感知：消费 Tekton、GitLab、ArgoCD 相关事件
  - 状态：维护 pending / updating / syncing / success / failed
  - 工具：调用 Git、YAML 更新器、ArgoCD API、Artifact 写入器
  - 智能：在 MR 评审、YAML 治理、构建失败修复时调用 Agent Runtime
```

核心链路不让 AI 执行确定性动作是可靠性要求。GitOps 配置变更、Git 提交、ArgoCD 同步这类动作必须由确定性代码执行。AI 必须进入 Git 提交前的语义检查点，负责 diff 审查、配置治理和风险判断。当前代码只实现单容器镜像字段更新；后续如果需要删除资源、修改副本数、调整资源配额或变更其他 YAML 字段，也必须先表达为受控 GitOps 变更计划，再由确定性执行器落地。

Pipeline Agent 与其他 Agent 的工具边界如下：

```text
Pipeline Agent：
  使用自身权限调用 Runtime 完成 YAML 治理或构建修复，输出 artifact 和事件。

Diagnosis Agent：
  消费 Pipeline 失败事件和 artifact，用自己的 diagnosis-readonly 权限读取日志、报告和上下文。

Collaboration Agent：
  消费诊断结果事件，用自己的 collaboration-notify 权限生成摘要，并调用飞书连接器发送或更新卡片。
```

三者之间不传递 MCP 工具实例，只传递 `CloudEvent`、`ArtifactRef` 和结构化 JSON。

### 3.2 与 Diagnosis / Collaboration 的分析边界

Pipeline YAML Governance、Diagnosis Agent 和 Collaboration Agent 都会使用 AI 做分析，但它们不是同一层能力，不能合并成一个“统一分析 Agent”。

| 位置 | 触发时机 | 分析对象 | 输出 | 决策权 |
| --- | --- | --- | --- | --- |
| Pipeline YAML Governance | Git commit 前 | `yaml.diff`、GitOps YAML、构建上下文 | 是否允许提交、风险等级、配置问题 | 阻断或放行交付 |
| Diagnosis Agent | 部署异常后 | ArgoCD 状态、K8s Events、Pod 日志、构建日志、雷达报告 | 根因、影响、修复建议、证据 | 定位问题，不直接发布 |
| Collaboration Agent | 需要通知或跟进时 | 诊断结果、责任映射、事件状态、用户回复 | 通知摘要、责任人、升级判断、日报 | 推动协作闭环 |

Pipeline 的 AI 检查点是发布前质量门禁，回答“这次 YAML / diff 能不能进入 GitOps 仓库”。Diagnosis Agent 是故障解释，回答“现在为什么失败”。Collaboration Agent 是协作表达与跟踪判断，回答“该通知谁、怎么说、是否需要升级”。

Pipeline YAML Governance 产出的 `yaml_audit_report` 或 `agent_task_result` 可以被后续 Diagnosis Agent 作为证据输入。如果部署失败，Diagnosis 可以引用发布前治理结果判断是否已有配置风险；Collaboration 可以把治理摘要纳入通知。但这只是 artifact 复用，不代表三个 Agent 共享同一个 AI 决策职责。

## 4. 上游输入

```text
tekton.pipelinerun.completed
gitlab.pipeline.completed
gitlab.mr.created（MR 评审前置）
gitlab.mr.merged（触发构建）
手动触发事件
```

构建成功或失败统一使用 `tekton.pipelinerun.completed`，结果写入 `data.status`，不再拆分 `tekton.pipelinerun.failed`。

## 5. 输出结果

```text
pipeline.build.completed
gitops.yaml.updated
argocd.application.sync.requested
pipeline.deployment.failed（失败时）
```

## 6. 接口契约

### 6.1 构建完成输入

```json
{
  "application": "api-gateway",
  "environment": "dev",
  "image_name": "base-mirror.tencentcloudcr.com/tekton/cicd/api-gateway",
  "image_tag": "5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198",
  "build_status": "succeeded",
  "build_log_uri": "artifacts/runs/corr-001/build.log",
  "commit_sha": "5b24f0c212cfa1ba0eae5d497defb8d21879b0fc"
}
```

### 6.2 YAML 更新输出

```json
{
  "status": "changed",
  "config_repo": "TODO: 配置仓库地址",
  "changed_files": ["TODO: YAML 文件路径"],
  "diff_artifact_uri": "artifacts/runs/corr-001/yaml.diff",
  "commit_message": "chore(deploy): update api-gateway image to 5b24f0c2_1780371198"
}
```

### 6.3 ArgoCD 同步输出

```json
{
  "sync_status": "triggered",
  "argocd_application": "api-gateway-dev",
  "operation_id": "op-001"
}
```

## 7. 核心运行流程

### 7.1 主交付链路（确定性执行 + AI 检查点）

主干动作由纯代码执行，保证稳定、可预测；完整 AI Pipeline 验收中，Git 提交前必须进入 `code_runtime` 无头 AI 检查点，对 diff 和 YAML 变更做语义审查。代码允许本地或凭据未就绪环境关闭该检查点运行纯自动化模式，但该模式不能作为智能增强链路交付结果。

这里不是让 AI 一直循环执行发布动作。构建镜像由 Tekton 完成，Pipeline Agent 只消费构建完成事件；GitOps 配置变更、Git commit / push、ArgoCD 同步请求都由确定性代码执行。AI 只拿 `yaml.diff`、上下文和只读/受限工作区工具做检查、治理和风险判断，不能直接调用 Git 推送、镜像构建或 ArgoCD 同步工具。

| 步骤 | 动作 | 实现方式 |
| --- | --- | --- |
| 1 | Tekton 构建完成，通过 HTTP Task 上报事件 | HTTP POST 到 FDE |
| 2 | FDE 接收事件，写入 Redis Streams | EventBroker.publish |
| 3 | Pipeline Agent 消费事件，解析：服务名、镜像名 + Tag、环境 | 纯代码解析 |
| 4 | 幂等校验：同一构建 ID 只处理一次 | IdempotencyStore |
| 5 | 克隆 GitOps 配置仓库 | 系统 git 命令 |
| 6 | 执行 GitOps 变更计划 | 当前只实现单容器镜像字段更新；后续支持字段修改、资源删除等操作时仍由确定性代码执行，绝对不用 AI 直接改文件 |
| 7 | 生成完整 unified diff artifact | GitOpsYamlUpdater |
| 8 | 调用 YAML Governance 无头代码运行时，审查 diff / YAML / 上下文（开启 `FDE_PIPELINE_ENABLE_YAML_GOVERNANCE=true` 时） | Agent Runtime `code_runtime` |
| 9 | 根据治理结果决定继续或阻断；当前不执行自动写入修复 | Pipeline Agent 策略 |
| 10 | git commit + push | 系统 git 命令 |
| 11 | 触发 ArgoCD 同步（配置开关控制，默认可跳过） | HTTP API |
| 12 | 发布 pipeline.build.completed / pipeline.deployment.failed 事件 | EventBroker.publish |

### 7.2 YAML 智能治理增强

嵌入在「GitOps 变更计划执行」之后、「Git 提交」之前，是 AI 在交付链路的核心价值点。

```text
1. 纯代码完成 GitOps 变更并生成 diff artifact 后，触发治理智能体
2. 调用智能体运行时，传入部署目录、`yaml.diff`、构建上下文和治理规则
3. AI 执行四类只读检查：
   - diff 审查：确认变更只包含预期 GitOps 操作、目标服务和目标环境
   - 基础合规：资源限制、健康探针、安全上下文、标签规范
   - 风险识别：特权容器、硬编码密钥、废弃 API 版本
   - 修复建议：输出 required_fixes，不直接写入文件
4. 当前实现只开放 read_file 和 list_files，不开放 run_command、edit_file、write_file 或外部系统 MCP 工具
5. 输出治理报告，高风险配置直接阻断提交
6. 治理失败或阻断时，Pipeline Agent 回滚本次 YAML 更新涉及的 changed_files，不保留待提交脏文件
7. 治理结果随交付事件一同发布，留痕可追溯
```

自动写入低风险修复是后续能力，必须等 `02-智能体运行时.md` 中 `edit_file`、`write_file`、`create_patch` 等 provider 工具实现，并通过权限 profile 与环境策略显式放行后才能进入 Pipeline 主链路。

YAML Governance 的结构化输出必须至少包含：

```json
{
  "approved": true,
  "risk_level": "low",
  "summary": "本次变更仅更新 api-gateway dev 环境镜像 tag，未发现高风险配置变更",
  "changed_files_reviewed": ["api-gateway/dev.yaml"],
  "findings": [],
  "required_fixes": [],
  "auto_fixed": []
}
```

阻断规则：

```text
approved = false -> 不执行 git commit，不触发 ArgoCD，同步发布 pipeline.deployment.failed
risk_level = high 或 critical -> 不执行 git commit，不触发 ArgoCD
输出未通过 schema_ref 校验 -> failed，不执行 git commit
Runtime 未配置但启用了 YAML Governance -> MODEL_NOT_CONFIGURED，不执行 git commit
治理失败或治理结果阻断 -> 执行 git restore 回滚本次 changed_files，不触发 ArgoCD
```

`yaml.diff` artifact 的目录归属使用事件 `run_id`，不是 `build_id`。`build_id` 只作为业务上下文字段和提交信息的一部分，不能替代执行实例 ID。

### 7.2.1 GitOps 变更计划边界

Pipeline Agent 允许自动修改的是 GitOps 配置仓库，不是业务源码仓库。当前实现只有单容器镜像字段更新，后续扩展必须先落到结构化变更计划，再由确定性执行器执行。

```json
{
  "change_plan_id": "gitops-change-001",
  "application": "api-gateway",
  "environment": "dev",
  "operations": [
    {
      "type": "set_image",
      "file": "api-gateway/dev.yaml",
      "selector": "spec.template.spec.containers[name=api-gateway].image",
      "value": "registry.example.com/team/api-gateway:v1.2.3"
    }
  ]
}
```

后续可扩展的操作类型：

```text
set_image：更新镜像字段
set_field：修改明确白名单字段，例如 replicas、resources、annotations
remove_field：删除明确白名单字段，例如废弃 annotation
remove_resource：删除明确命名的 YAML 资源，必须显式审批或配置开关放行
```

约束：

```text
所有 operation 必须有 file、selector、变更原因和来源事件
默认禁止通配删除、批量删除、跨环境删除
prod 环境不自动执行 remove_resource
删除类操作默认视为 high risk，必须进入 YAML Governance 审查
AI 只能审查 change_plan 和 yaml.diff，不能直接生成落地文件变更
```

### 7.3 构建失败修复建议

```text
1. 触发条件：收到 tekton.pipelinerun.completed 且 data.status = Failed
2. Pipeline Agent 收集构建日志、错误堆栈和必要的只读源码上下文
3. 调用智能体运行时，传入上下文与修复分析指令
4. Agent Runtime 定位可能根因，输出修复建议或 patch artifact
5. 当前不自动修改业务源码、Dockerfile、构建脚本，不自动提交修复分支，不自动创建 MR
6. 后续若引入自动生成 patch，也必须只生成待审查 artifact 或独立 MR，且不能自动合入主干
7. 修复分析结果发布到事件总线，触发协同 Agent 通知
```

当前代码已经在构建失败路径提供 `build_fix` 的 `repair_task` 挂载点，并在 `FDE_PIPELINE_ENABLE_BUILD_FIX=true` 时复用 `code_runtime:repair_task` 执行器。该能力不是当前 05 的主联调路径；专用构建修复 prompt、schema、补丁生成和写工具能力仍按 `08-构建失败修复智能体.md` 补齐。即使后续补齐，也不能让 Pipeline 主链路直接修改业务源码。

## 8. 关键技术设计

### 8.1 Tekton 事件监听方案

| 方案 | 实现方式 | 优点 | 缺点 |
| --- | --- | --- | --- |
| HTTP Task 主动上报 | 在 PipelineRun 末尾追加 HTTP Task | 实时性高、数据精准 | 轻微侵入流水线 |
| K8s Informer 被动监听 | 监听 PipelineRun 状态变化 | 零侵入 | 有秒级延迟 |

**当前策略**：用 HTTP Task 主动上报，数据精准，实现简单。

**演进方向**：后续可升级为 Tekton Interceptor。

### 8.2 镜像 Tag 格式

当前镜像 Tag 格式：

```text
{registry}/{namespace}/{image}:{commit_sha}_{timestamp}

示例：
base-mirror.tencentcloudcr.com/tekton/cicd/dreamifly:5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198

拆解：
  registry:  base-mirror.tencentcloudcr.com
  namespace: tekton/cicd
  image:     dreamifly
  tag:       5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198
             ├── commit_sha ─────────────────────────┤├─ timestamp ─┤
```

**Tag 可解析**：可从 Tag 中提取 commit_sha 和 timestamp。

**不同项目 Tag 格式可能不同**：需要按项目配置 Tag 解析规则。

### 8.3 YAML 更新的技术实现

```text
镜像字段路径：TODO: 暂定为占位符
  spec.template.spec.containers[0].image（示例，实际路径按项目配置）

格式兼容：
  - 当前优先支持原生 Deployment YAML 的 spec.template.spec.containers[0].image
  - 当前代码使用受限字段更新器，默认单容器策略，只更新匹配 image_name 的首个 image 行
  - 当前不会自动更新 sidecar、initContainer 或多个同名镜像；多容器更新必须后续通过显式配置开启
  - 单容器更新成功后写入完整 unified diff 格式的 yaml.diff artifact，供诊断和协同链路引用
  - 引入稳定 YAML 解析依赖后，升级为 AST 更新，避免格式复杂时误判
  - 预留 named_container、all_matching、Helm Values、Kustomize 适配接口

多环境支持：
  - 按环境管理（非分支）
  - 通过目录区分环境
```

说明：本节描述当前代码的第一类 GitOps 操作 `set_image`。Pipeline 的长期边界不是“只能改 tag”，而是“只能执行结构化、可审计、可回滚、被策略允许的 GitOps 配置变更”。删除资源或修改其他字段可以纳入后续能力，但不能绕过变更计划、diff artifact、YAML Governance 和环境策略。

### 8.4 配置仓库结构

**单仓库 + 目录隔离**（推荐）：

```text
gitops-config/
├── project-a/
│   ├── {env}.yaml
│   └── ...
├── project-b/
│   ├── {env}.yaml
│   └── ...
└── config.yaml          # 全局配置
```

**当前基础结构**：

```text
当前先用基础结构，具体目录由配置定义
gitops-config/
├── {project}/
│   └── {env}.yaml
└── ...
```

**配置项**：
- `CONFIG_REPO_DIR`: 配置仓库目录结构（默认：项目目录隔离）
- `YAML_FILE_NAME`: YAML 文件名（默认：`{environment}.yaml`，支持自定义）
- `IMAGE_FIELD_PATH`: 镜像字段路径（占位符，实际路径按项目配置）

### 8.5 Git 操作的安全与幂等

```text
专用机器人账号：单独的 GitLab 机器人账号，仅授予配置仓库读写权限
幂等控制：以「构建 ID + 环境」为唯一键，同一构建只提交一次
原子操作：每次更新都先拉取最新代码，再修改提交，冲突时自动重试
可追溯：Commit Message 强制标准化
分支保护：生产环境配置仓库开启分支保护，只能提 MR
```

Commit Message 格式：

```text
chore(deploy): update {application} image to {tag}

- build_id: {build_id}
- trigger: {trigger_source}
- image: {image_name}:{image_tag}
```

### 8.6 状态机设计

交付任务必须有明确的状态流转，避免状态混乱。

```text
核心状态：pending → updating → syncing → success / failed

状态流转：
  pending    → updating   (开始更新配置)
  updating   → syncing    (配置更新完成，开始同步)
  syncing    → success    (ArgoCD 同步成功)
  syncing    → failed     (ArgoCD 同步失败)
  failed     → updating   (手动/自动重试)
```

状态事件：

```text
pipeline.build.completed       → 构建完成，进入交付处理
gitops.yaml.updated            → YAML 镜像配置已更新
argocd.application.sync.requested → 已请求 ArgoCD 同步
pipeline.deployment.failed     → 交付链路失败
```

## 9. 与其他模块的联动关系

Pipeline Agent 不是孤立的，是整个事件驱动体系的核心一环。

```text
上游：事件总线
  所有输入事件全部来自事件总线，输出事件也全部回到总线，全程解耦

前置：合规检测雷达
  代码保留 preflight 能力开关；当前 05 主实现默认关闭。开启后，critical 异常必须阻断交付。

智能层：智能体运行时
  所有 AI 增强能力统一通过运行时调用；完整 AI Pipeline 联调主路径必须启用 YAML 治理 code_runtime

下游：诊断 Agent
  部署失败、同步异常时，发布失败事件到总线，触发诊断 Agent

下游：协同 Agent
  交付状态变更事件自动触发协同 Agent，通知负责人
```

## 10. 文件结构

```text
src/
  agents/
    pipeline/
      pipeline-agent.ts          # Pipeline Agent 入口
      pipeline-event-consumer.ts # 事件总线消费 wiring
      service-factory.ts         # Pipeline Agent Worker 装配工厂
      state-machine.ts           # 交付任务状态机
      tekton-event-parser.ts     # Tekton 事件解析
      gitops-yaml-updater.ts     # YAML 镜像更新
      argocd-sync-controller.ts  # ArgoCD 同步控制
      git-operations.ts          # Git 操作封装
      types.ts                     # Pipeline 类型定义
  integrations/
    argocd/
      argocd-client.ts             # ArgoCD API 客户端（后续接入）
    gitlab/
      gitlab-client.ts             # GitLab API 客户端（后续接入）
```

## 11. 当前实现范围

当前实现核心层主交付链路，并把 YAML Governance 作为可开启的 Pipeline AI 检查点接入。完整 AI Pipeline 验收必须开启该检查点；不开启时只能视为确定性自动化模式。Tekton HTTP 上报入口属于 `01-事件总线.md`，本模块不重复实现 HTTP Controller，只订阅事件总线中的标准事件。

```text
✅ 当前实现：
  - 订阅事件总线中的 tekton.pipelinerun.completed
  - Tekton 事件解析
  - 合规检测雷达 preflight 能力开关，默认关闭；开启后 critical 异常阻断交付
  - Pipeline 状态机
  - Git 操作封装
  - GitOps 配置变更执行：当前为单容器 YAML 镜像字段更新
  - YAML 完整 unified diff artifact 输出，artifact 目录使用事件 run_id
  - YAML Governance 无头代码运行时审查 diff 和 YAML 风险，当前 allowed_tools 仅为 read_file、list_files
  - YAML Governance 失败或阻断时回滚本次 changed_files，避免未提交脏文件继续留在 GitOps 仓库工作区
  - GitOps 提交后的 ArgoCD 同步触发（配置开关控制）
  - 构建失败路径的 build_fix repair_task 挂载点（开关控制，专用能力待补齐）
  - 主交付链路串联

⏸️ 后续挂载点：
  - MR 评审智能体挂载点
  - 构建失败修复的专用 prompt、schema、patch artifact 和写工具策略
```

## 12. 配置决策记录

### 12.1 Tekton 事件接收方式

```text
决策：当前使用 HTTP Webhook 接收 Tekton 事件，由 `01-事件总线.md` 负责入口接入与标准化
演进：后续可升级为 Tekton Interceptor
原因：实现简单，无需部署 Tekton EventListener + Interceptor
```

### 12.2 镜像 Tag 格式

```text
决策：Tag 格式为 {commit_sha}_{timestamp}
示例：5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198
注意：不同项目 Tag 格式可能不同，需要按项目配置解析规则
```

### 12.3 配置仓库策略

```text
决策：单仓库 + 目录隔离
原因：运维团队统一管理，规范容易统一
结构：
  gitops-config/
    {project}/
      {environment}.yaml  # 文件名通用化，不固定
```

### 12.4 配置仓库地址

```text
决策：暂定（当前无远程仓库）
标记：TODO: 需要配置
配置项：GITOPS_REPO_URL
说明：仓库地址待定，后续根据实际 GitLab 实例配置
```

### 12.5 YAML 镜像字段路径

```text
决策：暂定为占位符
标记：TODO: 需要按项目配置
示例：spec.template.spec.containers[0].image（占位符，实际路径按项目配置）
配置项：IMAGE_FIELD_PATH
说明：镜像字段路径按项目配置，不同项目路径可能不同
```

### 12.5.1 容器更新范围

```text
决策：当前只实现单容器更新
默认策略：single_container
行为：只更新首个匹配 image_name 的 image 行
不做：不自动更新 sidecar、initContainer、多容器或多个匹配项
后续扩展：named_container / all_matching 必须通过配置显式开启
原因：避免在多容器 Deployment 中误改旁路容器或基础设施容器
```

### 12.6 YAML 文件名

```text
决策：通用化，不固定为特定文件名
标记：TODO: 需要按项目配置
说明：YAML 文件名由配置定义，支持任意文件名
配置项：YAML_FILE_NAME（可选，默认为 {environment}.yaml）
```

### 12.7 环境管理方式

```text
决策：按环境管理（非分支）
原因：更简单直观，适合当前单分支模式
结构：按目录区分环境（dev/test/prod）
```

### 12.7 基础设施

```text
决策：Redis + PostgreSQL 都在 Docker 中
当前策略：先用 Redis，PostgreSQL 后续按需启用
状态存储：当前用 Redis Hash，后续可迁移到 PostgreSQL
```

### 12.8 Git 操作方式

```text
决策：使用系统 git 命令
原因：功能完整，简单直接
要求：Docker 镜像中预装 git
```

### 12.9 当前联调范围

```text
当前只联调：
  - Tekton 构建完成事件
  - 单容器 YAML 镜像字段更新
  - 完整 unified diff artifact
  - YAML 治理无头代码运行时（code_runtime，完整 AI Pipeline 联调必须开启）
  - Git 提交与推送
  - ArgoCD 同步触发

当前默认关闭能力：
  - 多容器更新
  - Helm Values / Kustomize
  - 合规检测雷达 preflight（开关开启后必须阻断 critical）
  - 构建失败修复智能体
  - YAML 治理 code_runtime（本地安全默认关闭；完整 AI Pipeline 联调必须显式开启）
```

说明：这里的无头代码运行时不是直接调用 `claude -p` 作为 CLI 子进程，而是使用 `02-智能体运行时.md` 定义的 `code_runtime`，迁移或重写 Claude Code 无头模式中适合 CI / 服务端场景的通用编码能力。当前第一批吸收范围以 YAML diff 审查、只读工作区上下文补充和结构化风险输出为边界。`run_command` 已作为 Runtime 通用内置工具实现，但当前 Pipeline YAML Governance 的 `allowed_tools` 不包含它；自动写入修复和 patch 生成仍属于后续能力。

## 13. 与下一步衔接

`06-MR评审智能体.md` 在 MR 阶段提前拦截代码风险。
`07-YAML治理智能体.md` 提供治理规则、prompt 和 schema；当前 05 在 Git 提交前内联调用 YAML Governance，决定是否允许提交。
`08-构建失败修复智能体.md` 消费构建失败事件，自动生成修复建议。
`09-诊断上下文构建器.md` 消费 Pipeline 失败和 ArgoCD/K8s 异常。

## 14. 运行入口

当前提供 Pipeline Worker 入口，用于从事件总线消费 Tekton 事件并执行主链路。

```text
npm run pipeline:worker
```

运行前必须配置：

```text
FDE_PIPELINE_GITOPS_REPO_URL
FDE_PIPELINE_IMAGE_FIELD_PATH
```

Redis 连接复用 `00-04` 底座的配置：

```text
REDIS_URL 或 REDIS_HOST / REDIS_PORT / REDIS_DB
FDE_EVENT_STREAM
FDE_EVENT_DLQ_STREAM
```

可选能力开关：

```text
FDE_PIPELINE_ENABLE_COMPLIANCE_PREFLIGHT=true
FDE_PIPELINE_ENABLE_ARGOCD_SYNC=true
FDE_PIPELINE_ARGOCD_API_URL
FDE_PIPELINE_ARGOCD_TOKEN
FDE_PIPELINE_ENABLE_YAML_GOVERNANCE=true
FDE_PIPELINE_ENABLE_BUILD_FIX=true
```

当前 05 完整 AI Pipeline 联调必须启用 `FDE_PIPELINE_ENABLE_YAML_GOVERNANCE=true`，并为 Pipeline Worker 配置 `AgentRuntime` 的 `code_runtime:code_task` 执行器。若只打开开关但没有真实执行器，Pipeline 会返回 `MODEL_NOT_CONFIGURED` 并阻断提交。不开启该开关时，Pipeline 仍可按确定性自动化模式运行，但不满足智能增强验收。

第一版 `code_runtime` 使用 Anthropic Messages API 执行无头 YAML Governance，需要配置：

```text
ANTHROPIC_API_KEY 或 CLAUDE_API_KEY
FDE_PIPELINE_RUNTIME_MODEL
```

缺少 API Key 时，Pipeline Worker 会装配受权限策略保护的 Runtime 外壳，但不会静默跳过 AI 检查点；YAML Governance 仍会返回 `MODEL_NOT_CONFIGURED` 并阻断提交。

该入口只启动消费者，不启动 HTTP 服务。Tekton HTTP 上报仍走 `01-事件总线.md` 的事件接入层。
