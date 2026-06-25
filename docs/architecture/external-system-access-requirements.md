# 外部系统接入信息清单

**日期**：2026-06-17  
**状态**：按双 AI 载体方向校准  
**适用范围**：Redis、GitLab CI、Tekton Task、ArgoCD、Kubernetes、Feishu、FDE code_runtime、Claude API

---

## 1. 接入原则

M1 不把外部系统接入集中到自建 MCP HTTP 服务。外部系统按运行位置接入：

```text
Redis Streams：
  事件总线，提供可靠投递、消费组、ACK 和死信能力
  所有 Agent 通过 EventBroker 接口消费事件

GitLab CI / Tekton Task：
  运行 FDE code_runtime
  读取代码、diff、配置仓库、构建日志
  输出报告、diff、patch、artifact

Diagnosis / Collaboration 后端能力：
  调用 Claude API
  读取 ArgoCD / K8s / GitLab / Tekton 摘要
  生成诊断、通知、日报
```

凭据不写入仓库。GitLab CI 使用 masked variables，Tekton 使用 Secret 或平台注入，后端服务使用环境变量或密钥管理系统。

---

## 2. Redis

| 信息项 | 说明 |
| --- | --- |
| 用途 | 事件总线（Redis Streams）、幂等去重、短期状态缓存 |
| 运行位置 | 后端服务、事件发布方、事件消费方 |
| 必要凭据 | `REDIS_HOST`、`REDIS_PORT` |
| 可选凭据 | `REDIS_PASSWORD`、`REDIS_TLS` |
| M1 角色 | 核心基础设施，所有事件投递依赖 Redis Streams |

环境变量：

```text
REDIS_HOST（必填）
REDIS_PORT（必填，默认 6379）
REDIS_PASSWORD（可选）
REDIS_TLS（可选，默认 false）
REDIS_STREAM_NAME（可选，默认 fde.events）
REDIS_DLQ_STREAM_NAME（可选，默认 fde.events.dlq）
```

Redis Streams 核心配置：

```text
stream: fde.events
dlq_stream: fde.events.dlq

consumer groups:
  - agent.pipeline
  - agent.diagnosis
  - agent.collaboration
  - agent.audit
```

使用约束：

```text
Redis Streams 用于事件投递，不用于业务状态存储
事件投递使用 at-least-once 语义，消费端必须幂等
大 payload 写入 artifact，Redis 只保存事件引用
Redis 重启后 stream 数据持久化（取决于 Redis 配置）
```

凭据就绪检查：

```text
最小可测条件：Redis 实例可连接，stream 可写入和读取
未就绪时处理：使用 MemoryEventBroker 替代（仅用于测试）
```

---

## 3. FDE code_runtime

| 信息项 | 说明 |
| --- | --- |
| 运行位置 | GitLab CI job、Tekton Task 容器 |
| 安装方式 | CI 运行时安装或预构建镜像 |
| 必要凭据 | `ANTHROPIC_API_KEY` 或企业云模型接入凭据 |
| 权限控制 | `--allowedTools` 按任务最小化 |
| 主要用途 | MR 合规扫描、YAML 智能校验、构建失败自修复 |

GitLab CI/CD variables：

```text
ANTHROPIC_API_KEY
```

可选企业模型变量：

```text
AWS_ROLE_TO_ASSUME
AWS_REGION
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_SERVICE_ACCOUNT
```

---

## 4. Claude API

| 信息项 | 说明 |
| --- | --- |
| 运行位置 | Diagnosis Agent、Collaboration Agent |
| 必要凭据 | `ANTHROPIC_API_KEY` |
| 主要用途 | 日志速析、根因推理、通知摘要、日报生成 |
| 禁止事项 | 不直接修改仓库文件，不直接触发生产发布 |

环境变量：

```text
ANTHROPIC_API_KEY
ANTHROPIC_BASE_URL（可选）
ANTHROPIC_MODEL（可选）
```

---

## 5. GitLab

| 信息项 | 说明 |
| --- | --- |
| 用途 | MR 触发、CI job、artifact、分支、MR 审批 |
| 默认凭据 | `CI_JOB_TOKEN` |
| 可选凭据 | `GITLAB_ACCESS_TOKEN`，需要 `api` 或最小可用 scope |
| 主要事件 | merge_request_event、web/API trigger、manual job |

GitLab CI/CD variables：

```text
GITLAB_ACCESS_TOKEN（可选）
AI_FLOW_INPUT（可选）
AI_FLOW_CONTEXT（可选）
AI_FLOW_EVENT（可选）
```

权限建议：

```text
MR 扫描只需要读代码和读 diff
自动修复需要创建分支或更新非保护分支
禁止直接推送受保护分支
```

---

## 6. Tekton

| 信息项 | 说明 |
| --- | --- |
| 用途 | 构建前预检、YAML audit、失败修复触发 |
| 凭据来源 | Kubernetes Secret、ServiceAccount、Workspace |
| 输入 | 源码 workspace、配置仓库 workspace、构建日志 |
| 输出 | TaskRun 结果、artifact、diff |

需要确认：

```text
Tekton 版本
是否允许 Task 容器访问外网安装 code_runtime 依赖
是否需要预构建含 code_runtime 依赖的镜像
配置仓库 checkout 方式
构建日志传递方式
```

---

## 7. ArgoCD

| 信息项 | 说明 |
| --- | --- |
| 用途 | 同步部署、读取 Application 状态 |
| M1 权限 | dev/test 可同步，prod 默认只读或审批后同步 |
| 凭据 | `ARGOCD_BASE_URL`、`ARGOCD_TOKEN` |

环境变量：

```text
ARGOCD_BASE_URL
ARGOCD_TOKEN
ARGOCD_APP_NAME
```

权限建议：

```text
Diagnosis Agent 优先使用只读权限
Pipeline 同步权限按环境拆分
prod 不允许 AI 自动 sync
```

---

## 8. Kubernetes

| 信息项 | 说明 |
| --- | --- |
| 用途 | 诊断证据收集 |
| M1 权限 | 只读 |
| 数据 | Events、Pod logs、Deployment status、describe 摘要 |

环境变量：

```text
KUBERNETES_API_SERVER
KUBERNETES_TOKEN
KUBERNETES_DEFAULT_NAMESPACE
```

权限建议：

```text
只允许 get/list/watch events、pods、deployments、replicasets
只允许读取 pod logs
禁止写操作、delete、exec
```

---

## 9. Feishu

| 信息项 | 说明 |
| --- | --- |
| 用途 | 故障通知、审批提醒、进度追踪、日报 |
| 测试方式 | 可先接个人飞书或测试群 |
| 凭据 | webhook 或 OpenAPI app |

Webhook 模式：

```text
FEISHU_WEBHOOK_URL
FEISHU_WEBHOOK_SECRET（可选）
```

OpenAPI 模式：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_CALLBACK_URL
FEISHU_DEFAULT_CHAT_ID
```

需要确认：

```text
是否先用个人飞书测试
是否需要审批卡片交互
是否需要回调公网地址
用户映射使用邮箱、open_id 还是 union_id
```

---

## 10. 凭据就绪检查

M1 允许凭据未全部就绪，但必须标明状态：

| 系统 | 最小可测条件 | 未就绪时处理 |
| --- | --- | --- |
| Redis | Redis 实例可连接，stream 可读写 | 使用 MemoryEventBroker（测试用） |
| FDE code_runtime | CI job 能调用内部 Agent Runtime API | 使用模板占位，不运行真实任务 |
| Claude API | 后端能完成一次 mock 输入诊断 | 返回未配置状态 |
| GitLab | MR job 可触发 | 用 manual job 验证 |
| Tekton | Task 可接收 workspace | 先输出 Task YAML |
| ArgoCD | 可读 Application 状态 | 用样例 JSON 替代 |
| Kubernetes | 可读 Events 和 Pod logs | 用样例日志替代 |
| Feishu | 可发送测试消息 | 本地保存 Markdown 报告 |