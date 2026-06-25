# FDE Workstation M1 实施计划

**日期**：2026-06-17  
**状态**：实施计划，按三 Agent + 底座先行方向校准  
**周期**：3 周  
**配套设计**：`docs/architecture/fde-platform-m1-design.md`  
**配套契约**：`docs/architecture/fde-platform-m1-contracts.md`

---

## 1. 本文定位

本文是 M1 的可执行实施计划。M1 目标从"自建重型服务化平台"调整为"底座先行的三 Agent 智能 CI/CD 系统"。截图中的 W1-T3 到 W2-T8 是 M1 的核心排期来源。

核心原则：

```text
确定性链路不替换
AI 能力按节点增强
Pipeline 就是业务 Agent，内部包含确定性执行和 AI 增强
FDE code_runtime 只在 CI / Tekton 工作区内操作代码和配置
Claude API 只在后端诊断和协同链路中做语义分析和内容生成
底座契约先定，不能为了最小 MVP 省略事件、Runtime、Artifact、Schema、IM 边界
Redis Streams 作为事件总线，提供可靠投递能力
```

---

## 2. M1 目标

### 2.1 平台目标

建立一套可复用的三 Agent 底座，包含 Redis Streams 事件总线、IM 连接器、Agent Runtime、GitLab CI 模板、Tekton Task 模板、prompt、schema、诊断输出和飞书通知规范。

M1 不要求第一批代码就实现重型 PostgreSQL / outbox / worker / 前端工作台，但 Redis Streams 事件总线、事件信封、任务 schema、artifact 和后续可持久化的数据结构必须先设计好。

### 2.2 业务目标

跑通以下智能增强闭环：

```text
GitLab 提交代码
  -> 事件进入 Redis Streams 事件总线
  -> Pipeline Agent 消费事件，触发 Tekton 构建
  -> 构建完成自动更新 GitOps YAML 镜像 tag
  -> YAML Governance Agent 做配置审计与修复
  -> ArgoCD 同步
  -> K8s / ArgoCD / Tekton 异常事件进入事件总线
  -> Diagnosis Agent 消费事件，三层漏斗诊断
  -> Collaboration Agent 消费事件，通知、追踪、升级、日报
```

### 2.3 验证目标

用可查看的 CI artifact、Tekton Task 输出、诊断 JSON 和飞书卡片证明 AI 在流水线、诊断和协同三个节点产生实际价值。

---

## 3. 任务映射

### 3.1 Week 1：底座 + Pipeline Agent

| 任务 | 名称 | AI 载体 | 交付物 | 落地位置 |
| --- | --- | --- | --- | --- |
| W1-T1 | 环境与权限准备 | 无 | 凭据占位符和权限清单 | `docs/architecture/external-system-access-requirements.md` |
| W1-T2 | 仓库基础结构 | 无 | 底座目录结构和 schema 目录 | `src/`、`schemas/` |
| W1-T3 | 共享基础设施：Redis Streams 事件总线 + IM 连接器 | 无 | Redis Streams 事件总线 + IM 连接器 | `src/events/`、`src/connectors/feishu/` |
| W1-T4 | 合规检测雷达 | 确定性检测 | 环境检测报告 | `src/radars/compliance/` |
| W1-T5 | Pipeline Agent 核心开发：Tekton 事件监听 | 无 | Pipeline Agent v0.1 | 待定 |
| W1-T6 | Pipeline Agent：GitLab 配置仓库自动更新 | code_runtime 增强 | YAML 自动更新模块 + YAML Governance Agent | 待定 |
| W1-T7 | Pipeline Agent：ArgoCD 同步触发 | 无 / code_runtime 前置校验 | ArgoCD 触发模块 | 待定 |
| W1-T8 | 现场作战背包：日志速析器 | Claude API 可选 | 日志速析器 v0.1 | 待定 |

### 3.2 Week 2：Diagnosis Agent + Collaboration Agent

| 任务 | 名称 | AI 载体 | 交付物 | 落地位置 |
| --- | --- | --- | --- | --- |
| W2-T1 | Diagnosis Agent：ArgoCD 状态监听 | 无 | 状态监听模块 | 待定 |
| W2-T2 | Diagnosis Agent：K8s 事件和日志收集 | 无 | 数据收集模块 | 待定 |
| W2-T3 | Diagnosis Agent：根因分析引擎（规则 + LLM） | Claude API | 诊断引擎 v0.1 | 待定 |
| W2-T4 | 现场作战背包：API 契约生成器 | code_runtime / Claude API | API 契约生成器 v0.1 | 待定 |
| W2-T5 | 知识库搭建：诊断经验沉淀结构 | Claude API 可选 | 知识库 Schema | 待定 |
| W2-T6 | Collaboration Agent：智能路由和通知 | Claude API | 通知路由模块 | 待定 |
| W2-T7 | Collaboration Agent：进度追踪和升级 | Claude API | 追踪模块 | 待定 |
| W2-T8 | Collaboration Agent：日报生成 | Claude API | 日报生成器 | 待定 |

### 3.3 Week 3：联调与收敛

| 任务 | 名称 | 交付物 |
| --- | --- | --- |
| W3-T1 | GitLab MR 联调 | MR 语义评审 artifact |
| W3-T2 | Tekton 链路联调 | YAML audit report 和 diff |
| W3-T3 | 诊断链路联调 | 结构化诊断 JSON |
| W3-T4 | 飞书链路联调 | 通知卡片、升级提醒、日报 |
| W3-T5 | 复盘和 M2 规划 | 交付说明、平台增强判断 |

---

## 4. 底座任务与验收

### 4.1 W1-T3 共享基础设施：Redis Streams 事件总线 + IM 连接器

功能：

```text
实现 Redis Streams 事件总线（EventBroker 接口 + RedisStreamsEventBroker）
提供可靠投递、消费组、ACK、死信能力
定义 CloudEvents 事件信封
统一 GitLab、Tekton、ArgoCD、K8s、Feishu 事件格式
提供飞书消息发送、@人、按钮、升级通知边界
为 Pipeline / Diagnosis / Collaboration 三 Agent 提供统一事件和协同入口
```

验收：

```text
EventBroker 接口已定义，包含 publish、subscribe、ack、nack、publishDeadLetter
RedisStreamsEventBroker 已实现，支持消费组和 ACK
CloudEvents schema 已定义
GitLab / Tekton / ArgoCD / K8s / Feishu 事件样例可映射到统一信封
IM 连接器 schema 已定义
飞书通知卡片和升级通知输入输出已定义
MemoryEventBroker 已实现，用于测试环境
```

### 4.2 Agent Runtime 底座

功能：

```text
定义 code_runtime 和 claude_api runtime
支持按 runtime_capability 分派独立执行器
统一 prompt、schema、artifact、错误结构、超时、限流和审计摘要
明确 cc 参考源码使用规则：不直接修改 cc，在 FDE 自有目录实现 runtime
```

验收：

```text
agent-task schema 已定义
code_runtime 与 claude_api 的输入输出契约已定义
ExecutorMap 已实现，支持 code_task / analysis_task / repair_task 分派
权限 profile 已定义（ci-readonly、ci-yaml-edit、diagnosis-readonly、collaboration-notify）
命令白名单安全校验已实现
cc 参考源码使用边界已写入文档
```

### 4.3 公共契约

功能：

```text
定义时间有序 ID 生成（类 UUID v7 结构）
定义错误码与状态映射
定义 ArtifactStore 路径安全
定义敏感字段脱敏规则
```

验收：

```text
createId 生成时间有序 ID（base36 时间戳 + hex 随机部分）
错误码列表包含所有必需码（含 COMMAND_EXECUTION_FAILED、COMMAND_TIMEOUT）
ArtifactStore 路径逃逸检查已加固
redact 正则已预编译优化
```

---

## 5. 任务功能与验收

### 5.1 W1-T4 合规检测雷达

功能：

```text
扫描内部环境 API 可用性
检查 GitLab 认证、项目读取和 Pipeline 读取
检查 Tekton 命名空间、PipelineRun 和 TaskRun 读取
检查 ArgoCD 认证、Application 读取和同步权限探测
检查 K8s Namespace、Deployment、Pod、Event 只读访问
输出环境检测 JSON 和 Markdown 报告
```

验收：

```text
GitLab / Tekton / ArgoCD / K8s API 全部连通时状态为 passed
任一目标失败时总状态不得为 passed
报告包含 target、check、status、latency_ms、error_code、error_message
凭据未就绪时可使用 mock connector，但报告必须标记 mock_mode
```

### 5.2 W1-T5 Pipeline Agent：Tekton 事件监听

功能：

```text
监听 Tekton 构建完成事件
提取镜像名、Tag、构建状态和日志地址
转换为 CloudEvents 信封
为后续 YAML 更新和诊断链路提供标准输入
```

验收：

```text
能识别 Tekton PipelineRun 完成事件
能提取镜像名和 tag
能输出标准事件 JSON
```

### 5.3 W1-T6 YAML 自动更新 + 智能校验

功能：

```text
确定性脚本更新镜像 tag
code_runtime 读取更新后的 YAML
检查 resources、probe、安全上下文、标签、环境变量和镜像 tag
低风险问题生成 diff，高风险只输出建议
```

验收：

```text
可输出 yaml-audit-report.md
可输出 yaml diff
dev / test 可按策略提交低风险修改
prod 不自动提交
```

### 5.4 W1-T8 日志速析器

功能：

```text
把 K8s Events、Pod logs、ArgoCD 状态整理为诊断输入
先用规则匹配常见错误
规则不足时调用 Claude API
输出标准诊断 JSON
```

验收：

```text
能识别 ImagePullBackOff、CrashLoopBackOff、配置错误、依赖错误
诊断结果包含 evidence_refs
Claude API 不可用时返回 fallback_rule 结果
```

### 5.5 W2-T3 根因分析引擎

功能：

```text
Context Builder 压缩和结构化 ArgoCD / K8s / Tekton 证据
第一层规则引擎覆盖常见故障
第二层知识库匹配历史案例
第三层 Claude API 做复杂根因推理
```

验收：

```text
规则命中时不调用 Claude API
知识库相似度命中时复用历史方案
LLM 兜底时输出结构化诊断结果和 evidence_refs
```

### 5.6 W2-T6 智能路由和通知

功能：

```text
根据诊断类型、涉及模块、提交记录和服务归属判断通知对象
用 Claude API 生成飞书卡片摘要
减少直接转发原始日志
```

验收：

```text
飞书通知包含故障摘要、根因、影响范围、建议动作和负责人
通知不包含敏感字段
```

### 5.7 W2-T7 进度追踪和升级

功能：

```text
识别飞书回复是否有效
区分已读、确认、处理中、已修复、无效回复
超时或无效闭环时升级
```

验收：

```text
能对样例回复输出 progress_status
无效回复不会被当作已解决
```

### 5.8 W2-T8 日报生成

功能：

```text
聚合 GitLab、Tekton、ArgoCD、诊断和人工介入摘要
Claude API 生成自然语言日报
提炼高频故障、趋势和风险
```

验收：

```text
日报包含构建数、部署数、失败数、平均修复时间、高频问题和建议动作
可推送飞书或保存 Markdown artifact
```

---

## 6. 技术方案要点

### 6.1 Redis Streams 事件总线

```text
实现：RedisStreamsEventBroker（EventBroker 接口实现）
核心能力：
  - publish：发布事件到 stream
  - subscribe：消费组订阅，支持 ack/nack
  - publishDeadLetter：死信队列投递
  - claimPending：超时消息重新认领
配置：
  - stream: fde.events
  - dlq_stream: fde.events.dlq
  - consumer groups: agent.pipeline / agent.diagnosis / agent.collaboration / agent.audit
测试替代：MemoryEventBroker（无外部依赖）
```

### 6.2 code_runtime

```text
运行位置：GitLab CI job、Tekton Task
安装方式：CI 镜像内安装或预构建镜像
调用方式：业务 Agent 通过 FDE AgentRuntime 调用 `code_runtime:code_task` / `code_runtime:repair_task`，不以 `claude -p` CLI 子进程作为主路径
权限控制：permission_profile + allowed_tools 最小化
产物：报告、diff、patch、job status
```

### 6.3 Claude API

```text
运行位置：Diagnosis Agent、Collaboration Agent
调用方式：服务端 API 调用
产物：结构化诊断 JSON、飞书卡片、日报 Markdown
约束：只做推理和内容生成，不直接修改文件
```

### 6.4 Agent Runtime

```text
code_runtime：FDE 自有代码任务运行时，用于 MR Review、YAML Governance、Build Fix
claude_api：封装 Claude API，用于 Diagnosis、Collaboration、日报
schema validator：强制 JSON 输出符合契约
artifact writer：保存报告、diff、诊断证据、日报
runtime audit：记录耗时、token、错误摘要和输入证据引用
权限控制：按 permission_profile 和 environment 策略分级
```

### 6.5 外部系统

```text
GitLab：MR、CI job、artifact、approval
Tekton：PipelineRun、TaskRun、构建日志
ArgoCD：Application 状态和同步
Kubernetes：Events、Pod logs、资源状态
Feishu：通知、审批、回复和升级
```

---

## 7. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 继续过度平台化 | 实施成本过高、返工风险上升 | 底座契约先定，实现先薄，不恢复重型多服务平台 |
| 只做最小 CI 模板 | 后续 Diagnosis、Collaboration、记忆接入返工 | W1-T3 先定义事件、Runtime、Artifact、Schema、IM 边界 |
| Redis 不可用 | 事件投递中断 | 使用 MemoryEventBroker 替代（测试环境） |
| code_runtime 权限过大 | 误改文件或越权执行 | allowed_tools 按任务最小化，prod 只输出建议 |
| Claude API 诊断不稳定 | 误判根因 | 规则优先，AI 补充，所有结论带 evidence |
| 外部凭据未就绪 | 真实联调受阻 | 用 GitLab variables 和服务端 env 占位，先跑模拟样例 |
| 飞书通知产生噪音 | 打扰开发和运维 | 先做摘要和分级，严重问题才升级 |

---

## 8. M1 通过条件

```text
W1-T3 底座契约通过：
  - Redis Streams 事件总线已实现（可靠投递、消费组、ACK、死信）
  - CloudEvents 事件信封已定义
  - IM 连接器已实现
  - Agent Runtime 已实现（支持 code_task / analysis_task / repair_task 分派）
  - Artifact 规范已定义
  - 公共契约已定义（ID、错误码、脱敏）

Pipeline Agent v0.1 能监听 Tekton 构建完成事件，提取镜像名
GitLab MR 有 Claude Code 合规扫描 job
Tekton 有 Claude Code YAML audit task
构建失败有 Claude Code 修复建议 artifact
Diagnosis Agent 能通过三层漏斗输出结构化根因分析
Collaboration Agent 能生成飞书通知、升级判断和日报
生产环境没有自动发布或自动回滚
```
