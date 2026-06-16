# M1 架构决策基线

**版本**：v1.0  
**日期**：2026-06-16  
**状态**：M1 实施权威口径  
**适用范围**：`implementation-plan-week1.md`、`permissions-and-credentials.md`、`yaml-change-engine-design.md`、`TODO.md`、`superpowers/specs/2026-06-15-fde-workstation-m1-design.md`

---

## 一、权威结论

M1 的主链路统一为：

```text
Tekton 构建成功
  -> Webhook 通知 FDE API
  -> 创建部署记录，状态 pending
  -> YAML 变更引擎修改 Git 配置仓库
  -> 提交配置变更
  -> ArgoCD 自动同步，或在 dev 环境主动 sync
  -> 观察 ArgoCD / Kubernetes 状态
  -> 失败时从 K8s API 读取日志和 Events
  -> 规则诊断 + LLM 增强
  -> 飞书通知和回滚申请
```

M1 不使用 ArgoCD Image Updater 作为主链路，不通过修改 ArgoCD Application annotation 触发部署，也不让后端直接修改 ArgoCD Application 配置。

---

## 二、ArgoCD 使用方式

### 2.1 M1 允许

- 读取指定 Application 状态。
- 在 dev 环境、且 Git 配置提交成功后，主动调用 ArgoCD sync。
- 监听或轮询 Application 的 sync / health 状态。

### 2.2 M1 禁止

- 使用 ArgoCD admin token。
- 修改 ArgoCD Application spec 或 annotation。
- 把 ArgoCD Image Updater 作为 YAML 修改执行者。
- 绕过 Git 直接修改 Kubernetes 资源。
- 在 staging / prod 默认自动 sync 或自动回滚。

### 2.3 责任边界

| 责任 | M1 执行者 |
|------|-----------|
| 生成镜像 | Tekton |
| 修改 YAML / values / kustomization | YAML 变更引擎 |
| 提交配置变更 | Git 服务 |
| 应用目标状态 | ArgoCD |
| 查询实际运行状态 | ArgoCD + Kubernetes API |
| 失败诊断 | Diagnosis Orchestrator |
| 通知和回滚申请 | Collaboration Orchestrator |

---

## 三、YAML 变更引擎

YAML 变更引擎是 M1 修改部署配置的唯一执行模块。

M1 只实现 `RawKubernetesAdapter`，用于当前单体测试应用：

- `update_image`
- `set_replicas`
- `add_env`
- `update_env`
- `remove_env`

Helm 和 Kustomize 在 M1 只保留接口和映射设计，不作为 Week 1 必交付内容。

前端或 API 只能提交业务动作，不能提交任意 YAML path 或完整 YAML 内容。

---

## 四、事件机制

M1 不以高并发为设计目标。当前测试项目基本不会涉及真正高并发，事件机制的目标是可靠状态流转、幂等、可追溯和易实现。

M1 统一使用：

```text
PostgreSQL events 表作为可靠事件源
Worker 定时扫描 pending events 做补偿
Redis Pub/Sub 可选，只用于唤醒 worker
```

Redis Pub/Sub 可以使用，但不能作为关键事件的唯一来源。Redis Streams 作为后续高并发或多消费者场景的可选升级，不作为 M1 强制依赖。

事件必须具备幂等键：

```text
application + environment + pipeline_run_id + image_ref
```

同一个幂等键重复到达时，不得重复提交 Git 或重复触发部署。

Worker 领取事件时必须使用数据库事务和行级锁，例如 `SELECT ... FOR UPDATE SKIP LOCKED`，避免多个 worker 重复处理同一事件。

---

## 五、Tekton 接入方式

M1 主方式是 Webhook 回调：

- Tekton Pipeline 成功后调用 FDE API。
- 回调必须携带签名或共享密钥。
- 后端只接受 `Succeeded` 状态。
- 回调 payload 必须包含 `application`、`environment`、`image_ref`、`commit_sha`、`pipeline_run_id`。

Watch `PipelineRun` 作为备选方案，不进入 Week 1 主实现。

如果后续实现 Watch，需要注意 Tekton 字段形态：

- `status.pipelineResults` 是数组，不是字典。
- `spec.params` 是数组，不是字典。

---

## 六、日志系统

M1 不做自研 Loki-inspired 日志系统。

M1 日志方案：

- 诊断时通过 Kubernetes API 读取 Pod 最近日志。
- 默认最多读取最近 500 行。
- 日志进入 LLM 前必须脱敏。
- PostgreSQL 只保存诊断摘要、分类、建议和置信度，不保存完整日志。

自研日志系统、`log_streams`、`log_chunks`、`log_chunks_data`、Snappy 压缩、日志 ingester / querier 统一归入 M2 候选设计，详见 [`docs/m2-log-system-design.md`](m2-log-system-design.md)。

---

## 七、数据库 Schema

M1 初始迁移只包含这些核心表：

- `deployments`
- `diagnosis_records`
- `events`
- `notifications`
- `change_requests`
- `audit_logs`

`llm_configs` 和 `environment_configs` 可以作为 Week 2/Week 3 配置增强表，不阻塞 Week 1。

日志系统相关表不进入 M1 初始迁移。

`deployments.status` 必须使用明确状态机，不允许自由字符串。

---

## 八、部署状态机

M1 部署状态机：

```text
pending
  -> planning
  -> committing
  -> syncing
  -> rolling_out
  -> healthy

pending / planning / committing / syncing / rolling_out
  -> failed

rolling_out
  -> degraded

degraded / failed
  -> diagnosing
  -> notified

任何未完成状态
  -> cancelled
```

状态含义：

| 状态 | 含义 |
|------|------|
| pending | 已接收 Tekton 成功事件，尚未生成配置变更 |
| planning | 正在生成变更计划和 diff |
| committing | 正在提交 Git 配置仓库 |
| syncing | Git 已提交，等待 ArgoCD 同步 |
| rolling_out | Kubernetes 正在滚动更新 |
| healthy | ArgoCD Healthy 且 K8s rollout 成功 |
| degraded | ArgoCD / K8s 进入非健康状态 |
| diagnosing | 正在采集日志和生成诊断 |
| notified | 已发送飞书通知 |
| failed | 链路失败且已记录失败原因 |
| cancelled | 人工取消或策略终止 |

---

## 九、Git 工作区管理

M1 不允许多个部署任务共用一个可变本地工作区。

推荐策略：

- 每个部署任务使用独立临时目录。
- 同一个 `application + environment` 必须串行。
- 提交前重新获取远端最新状态。
- 推送失败时进入可重试状态，不无限重试。
- 任务结束后清理临时工作区。

---

## 十、回滚模型

M1 回滚只创建 GitLab MR 或 Git 变更申请。

默认回滚方式：

```text
找到上一稳定镜像
  -> 生成回滚配置变更
  -> 创建 MR
  -> 人工审核
  -> 合并后由 ArgoCD 同步
```

不使用 Kubernetes 直接回滚，不默认使用 ArgoCD history rollback。

---

## 十一、Week 0 阻塞项

Week 1 开始前必须完成：

- Git 机器人账号和 dev 配置仓库写权限。
- ArgoCD 低权限 token。
- Tekton Webhook Secret。
- K8s 只读 ServiceAccount。
- 飞书应用凭证。
- LLM Provider API Key。
- 应用映射文件。

没有完成 Week 0 时，Week 1 只能做本地模拟，不能声明真实链路跑通。

---

## 十二、产品愿景到 M1 的映射

产品设计方案描述的是完整 FDE Workstation 愿景，M1 只验证其中的内部 CI/CD 运维提效切片。

| 产品愿景能力 | M1 对应范围 |
|--------------|-------------|
| 现场交付操作系统 | 内部单体测试应用发布闭环 |
| 五层十二域 | 不进入 M1 实施 |
| Agent 编排 | Pipeline / Diagnosis / Collaboration 三个 Orchestrator |
| 知识沉淀 | 只保存诊断记录，不做完整知识库；M2候选见 `docs/m2-memory-skill-design.md` |
| 评估驱动 | 只记录可验证指标，不做 EDD Engine |
| 客户现场 ROI | 不在 M1 证明，后续客户试点验证 |

---

## 十三、代码示例注意事项

文档中的代码块是设计示例，不是可直接复制上线的最终代码。

已知需要统一的示例约束：

- Python `hmac.new(...)` 是正确函数名，必须配合 `hmac.compare_digest(...)` 使用。
- 如果后续升级 Redis Streams，消费示例必须 `import asyncio`。
- Tekton `pipelineResults` 和 `params` 必须按数组解析。
- 分布式锁必须以 context manager 或 token 方式保证“获取者释放”，不能用无 token 的 `delete` 释放。
- ArgoCD 客户端不得修改 Application annotation。
