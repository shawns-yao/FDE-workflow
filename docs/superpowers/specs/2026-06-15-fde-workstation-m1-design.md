# FDE Workstation 里程碑一设计文档

**版本**：v1.3  
**日期**：2026-06-16  
**状态**：设计评审通过，架构口径已收敛  
**负责人**：FDE团队

---

## ⚠️ M1 范围调整说明（v1.3更新）

### 调整原因
基于设计评审反馈，原v1.0方案存在"范围过大、平台化过早"的问题。M1应聚焦验证"Agent编排能力"，而非完整的FDE Workstation平台。

### 核心调整

**收敛原则**：跑通"Tekton构建 → ArgoCD部署 → 自动诊断 → 飞书通知"的最短闭环

**保留（17个任务）**：
- Pipeline/Diagnosis/Collaboration 三个Orchestrator
- 规则引擎优先 + LLM增强的诊断架构
- PostgreSQL Outbox事件表 + 可选Redis Pub/Sub唤醒
- 飞书通知 + 回滚申请（创建MR）
- 最小API（部署列表、详情、日志查询）

**推迟到M2**：
- 自研日志系统（Loki-inspired）
- 完整前端（React + ECharts）
- 评估驱动引擎
- 知识库自动沉淀

**推迟到M3+**：
- FDE Workstation五层十二域模块

### M1权威架构决策

本设计文档以 [`docs/m1-architecture-decisions.md`](../../m1-architecture-decisions.md) 为 M1 实施权威口径。若本文旧章节、示例代码或历史说明与该基线冲突，以基线文档为准。

M1 主链路统一为：

```text
Tekton构建成功
  -> Webhook通知FDE API
  -> 创建部署记录，状态pending
  -> YAML变更引擎修改Git配置仓库
  -> 提交配置变更
  -> ArgoCD自动同步，或在dev环境主动sync
  -> 观察ArgoCD / Kubernetes状态
  -> 失败时从K8s API读取日志和Events
  -> 规则诊断 + LLM增强
  -> 飞书通知和回滚申请
```

M1 不使用 ArgoCD Image Updater 作为主链路，不通过修改 ArgoCD Application annotation 触发部署，也不让后端直接修改 ArgoCD Application 配置。

### 关键架构调整

**诊断引擎**：
- ~~原设计~~：规则引擎(80%) + LLM(20%)兜底
- **新设计**：规则引擎优先（快速路径）+ LLM增强（未匹配时）

**业务指标**：
- 移除"项目周期4周→2周"（M1无法证明）
- 保留可验证指标（镜像更新耗时、诊断时间、人工交互）

---

## 一、项目概述

### 1.1 背景

FDE（Forward Deployed Engineer）岗位在过去两年增长42倍，但现有工具生态高度集中在"如何构建AI应用"，缺乏"如何在客户现场证明AI价值并推动落地"的专用工具。FDE Workstation旨在填补这一空白，成为FDE的"交付操作系统"。

里程碑一聚焦内部验证场景：以公司内部运维CI/CD提效需求为实践抓手，交付**运维提效Agent Trio**和**FDE Workstation MVP**，验证"平台+FDE"模式可行性。

### 1.2 核心目标

**业务目标**：
- 镜像更新环节：5-10分钟 → 0秒（自动化）
- 问题诊断时间：平均2小时 → 5分钟（智能诊断）
- 人工交互次数：5-10轮 → 0-1轮（自动协作）

**产品目标**：
- 完成3个Agent协作系统（Pipeline/Diagnosis/Collaboration）
- 跑通内部CI/CD运维提效闭环
- 为后续验证"平台+FDE"模式提供内部实践样本

### 1.3 设计原则

1. **GitOps优先**：通过YAML变更引擎修改Git配置仓库，由ArgoCD同步目标状态
2. **现场优先**：考虑离线、无Docker、无公网的客户环境
3. **傻瓜式操作**：目标用户是FDE（非纯技术背景），配置声明式、部署一键化
4. **模块解耦**：每个模块职责单一、接口清晰、可独立测试
5. **性能为先**：接口响应<500ms，页面加载<1.5s，数据库强制索引

---

## 二、整体架构

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                  FDE Workstation Platform (MVP)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Layer 5: 评估驱动引擎 (EDD Engine)                       │   │
│  │  - 指标采集 (Prometheus)                                 │   │
│  │  - 基线对比                                              │   │
│  │  - 报告生成                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↑                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Orchestration Layer (核心编排层)                         │   │
│  │                                                           │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────┐│   │
│  │  │   Pipeline     │  │   Diagnosis    │  │Collaboration││   │
│  │  │ Orchestrator   │→ │ Orchestrator   │→ │Orchestrator││   │
│  │  └────────────────┘  └────────────────┘  └────────────┘│   │
│  │          ↓                   ↓                  ↓        │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────┐│   │
│  │  │ Event Store    │  │Diagnosis Data │  │IM Connector││   │
│  │  │(PostgreSQL)    │  │ (PostgreSQL)   │  │  (Feishu)  ││   │
│  │  └────────────────┘  └────────────────┘  └────────────┘│   │
│  │                                                           │   │
│  │  ┌────────────────┐  ┌────────────────┐                │   │
│  │  │ Diagnosis      │  │   K8s Log      │                │   │
│  │  │ Engine         │  │   Reader       │                │   │
│  │  │ (Rule + LLM)   │  │                │                │   │
│  │  └────────────────┘  └────────────────┘                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Integration Layer (开源工具集成)                         │   │
│  │                                                           │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐    │   │
│  │  │   Tekton    │  │   ArgoCD     │  │ Prometheus  │    │   │
│  │  │  Webhook    │  │ Sync/Status  │  │             │    │   │
│  │  └─────────────┘  └──────────────┘  └─────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Infrastructure Layer                                      │   │
│  │  GitLab → Tekton → ArgoCD → Kubernetes                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计思路

**复用成熟工具**：
- **ArgoCD**：同步Git中的目标状态，提供Application状态查询和dev环境主动sync能力
- **Tekton Webhook / Triggers**：构建成功后把镜像信息回调给FDE API
- **Prometheus**：监控指标采集（Apache 2.0）

**自研核心价值**：
1. **编排层**：串联工具链，实现端到端自动化
2. **诊断引擎**：规则引擎优先 + LLM增强，平衡准确率和成本
3. **YAML变更引擎**：结构化修改Raw Kubernetes YAML，后续扩展Helm和Kustomize
4. **诊断记录**：M1保存诊断结果和证据摘要；知识库自动沉淀推迟到M2
5. **飞书集成**：交互式协作（不只是通知，还有回调处理）

---

## 三、技术选型

### 3.1 技术栈

| 组件 | 技术选型 | 版本 | 选型理由 |
|------|----------|------|----------|
| **后端框架** | Python 3.11 + FastAPI | 0.110+ | 异步高性能、LLM生态丰富、开发效率高 |
| **事件机制** | PostgreSQL + 可选Redis | Outbox事件表 + Pub/Sub唤醒 | M1低并发，PostgreSQL负责可靠性和审计 |
| **持久化数据库** | PostgreSQL 15 | - | 关系型数据、全文搜索、JSONB支持 |
| **任务队列** | Celery + Redis | 5.3+ | 异步LLM诊断、长任务处理 |
| **LLM API** | 可配置Provider | - | 不写死模型名，按可用账号和供应商配置 |
| **日志采集** | Kubernetes API | - | M1实时读取Pod日志，不自研日志系统 |
| **CI/CD工具** | Tekton + ArgoCD + YAML变更引擎 | 已有/自研 | Tekton构建，YAML引擎写Git，ArgoCD同步 |
| **IM集成** | 飞书 Webhook + 回调服务器 | - | 内部通讯工具 |
| **部署** | Docker Compose / Kubernetes | - | 开发用Compose，生产用K8s |
| **前端（延后）** | React + Tailwind + Ant Design | - | 现代化、组件丰富、AI辅助开发友好 |

### 3.2 开源工具许可证

| 工具 | 许可证 | 商业使用 | 说明 |
|------|--------|----------|------|
| ArgoCD | Apache 2.0 | ✅ 完全允许 | 只调用状态查询和同步API |
| Tekton Triggers | Apache 2.0 | ✅ 完全允许 | CNCF项目 |
| Prometheus | Apache 2.0 | ✅ 完全允许 | 监控标准 |
| Grafana Loki | AGPLv3 | ⚠️ 有限制 | 仅作为M2日志系统设计参考，M1不直接依赖 |

**结论**：我们只调用开源工具的API，不修改其源码，完全符合商业使用要求。

---

## 四、三大Orchestrator详细设计

### 4.1 Pipeline Orchestrator（管道编排器）

**职责**：编排"代码提交 → 构建 → YAML更新 → 部署"全流程

**工作流**：
```
1. 监听Tekton PipelineRun完成事件（通过Tekton Triggers EventListener）
2. 提取镜像信息（registry/image:tag、commit、author）
3. 创建部署记录（deployments表，状态pending）
4. 调用YAML变更引擎生成结构化变更
5. 修改Git配置仓库并提交
6. dev环境可调用ArgoCD sync；其他环境按策略创建MR或等待自动同步
7. 写入"deploy.started"事件到PostgreSQL events表，并可选发布Redis Pub/Sub唤醒worker
8. 发送飞书通知："部署进行中"
```

**核心代码结构**：
```python
# orchestrators/pipeline.py
class PipelineOrchestrator:
    def __init__(self):
        self.event_bus = EventBus()
        self.yaml_engine = YamlChangeEngine()
        self.git = GitConfigClient()
        self.argocd = ArgoCDClient()
        self.feishu = FeishuClient()
        self.db = DatabaseSession()
        
    async def handle_build_complete(self, event: TektonBuildEvent):
        """处理构建完成事件"""
        # 1. 提取镜像信息
        image_info = self.parse_image_info(event)
        
        # 2. 创建部署记录
        deploy = await self.db.create_deployment(
            app_name=event.app_name,
            image=image_info.full_name,
            tag=image_info.tag,
            commit_sha=event.commit_sha,
            author=event.author,
            environment=event.environment,
            status="pending"
        )
        
        # 3. 结构化修改Git配置仓库
        change_result = await self.yaml_engine.update_image(
            application=event.app_name,
            environment=event.environment,
            image_ref=image_info.full_name,
            deploy_id=str(deploy.id)
        )
        await self.db.update_deployment(
            deploy.id,
            status="committing",
            git_commit=change_result.commit_sha
        )
        
        # 4. dev环境可主动触发ArgoCD sync
        if event.environment == "dev":
            await self.argocd.trigger_sync(event.argocd_application)
            await self.db.update_deployment(deploy.id, status="syncing")
        
        # 5. 发布事件
        await self.event_bus.publish("deploy.started", {
            "deploy_id": str(deploy.id),
            "image": image_info.full_name,
            "commit": event.commit_sha,
            "author": event.author,
            "environment": event.environment,
            "git_commit": change_result.commit_sha
        })
        
        # 6. 飞书通知
        await self.feishu.send_notification(
            user=event.author,
            title="部署开始",
            message=f"镜像 {image_info.full_name} 正在部署到 {event.environment}",
            deploy_id=str(deploy.id)
        )
```

**集成方式**：
- 使用Tekton Triggers的EventListener接收Webhook
- 通过YAML变更引擎修改Git配置仓库并提交
- ArgoCD只负责读取状态和同步Git中的目标状态
- dev环境允许主动sync，staging/prod默认创建MR或等待审批

**配置示例**（应用映射）：
```yaml
applications:
  - name: my-app
    type: monolith
    config_type: raw-kubernetes
    git_repo: git@gitlab.com:ops/k8s-configs.git
    environments:
      dev:
        config_path: apps/my-app/dev/deployment.yaml
        resource_kind: Deployment
        resource_name: my-app
        container_name: my-app
        argocd_application: my-app-dev
        auto_sync: true
```

---

### 4.2 Diagnosis Orchestrator（诊断编排器）

**职责**：监控部署状态，自动诊断问题，沉淀知识

**工作流**：
```
1. 订阅"deploy.started"事件
2. 监听ArgoCD Application状态变化
3. 如果状态非Healthy：
   a. 从K8s API直接拉取Pod日志（最近500行）
   b. 从K8s获取Events
   c. 获取Git commit信息
4. 调用诊断引擎（规则优先 + LLM增强）
5. 生成诊断报告（根因、分类、修复建议）
6. 存储到diagnosis_records表
7. 发布"diagnosis.completed"事件
```

**诊断引擎设计（v1.1调整）**：

```python
# engines/diagnosis_engine.py
class DiagnosisEngine:
    """规则优先 + LLM增强诊断引擎"""
    
    def __init__(self):
        self.rule_engine = RuleEngine()
        self.llm_client = LLMProviderFactory.from_config(config.llm)
    
    async def diagnose(self, deploy_id: str) -> DiagnosisResult:
        # 1. 收集数据
        logs = await self.k8s_client.get_pod_logs(deploy_id, tail_lines=500)
        events = await self.k8s_client.get_events(deploy_id)
        commit_info = await self.get_commit_info(deploy_id)
        
        # 2. 规则引擎优先（快速路径，80%场景）
        rule_result = self.rule_engine.match(logs, events)
        
        if rule_result.confidence >= 0.80:
            # 规则引擎高置信度，直接返回（<3秒）
            return DiagnosisResult(
                method="rule",
                root_cause=rule_result.root_cause,
                solution=rule_result.solution,
                confidence=rule_result.confidence,
                category=rule_result.category
            )
        
        # 3. LLM增强诊断（仅当规则未匹配或低置信度）
        try:
            llm_result = await self.llm_client.diagnose(
                logs=logs,
                events=events,
                commit_info=commit_info,
                rule_hint=rule_result if rule_result.confidence > 0 else None
            )
            
            return DiagnosisResult(
                method="llm",
                root_cause=llm_result.root_cause,
                solution=llm_result.solution_steps,
                confidence=llm_result.confidence,
                category=llm_result.category
            )
            
        except (LLMTimeout, LLMUnavailable) as e:
            # 4. LLM失败，降级到规则引擎基础诊断
            if rule_result.confidence > 0:
                return rule_result  # 返回低置信度的规则诊断
            else:
                return DiagnosisResult(
                    method="fallback",
                    root_cause="诊断超时，请查看原始日志分析",
                    solution="查看K8s Events和Pod日志",
                    confidence=0.0,
                    category="未知"
                )
```

**规则引擎（Top 10常见错误）**：
```python
# engines/rule_engine.py
RULES = [
    {
        "name": "ImagePullBackOff",
        "pattern": r"Failed to pull image.*ErrImagePull",
        "category": "镜像问题",
        "solution": "检查镜像名称和标签，确认镜像仓库可访问",
        "confidence": 0.95
    },
    {
        "name": "CrashLoopBackOff",
        "pattern": r"CrashLoopBackOff",
        "category": "启动失败",
        "solution": "查看容器日志，检查启动命令和环境变量",
        "confidence": 0.90
    },
    # 更多规则...
]
```

**LLM诊断（Celery异步任务）**：
```python
# workers/diagnosis_worker.py
@celery.task
async def llm_diagnose(logs: str, events: List[dict], metrics: dict):
    prompt = f"""你是Kubernetes部署诊断专家。分析以下信息：

日志摘要：
{logs[:2000]}

K8s Events：
{format_events(events)}

指标：CPU={metrics['cpu']}, Memory={metrics['memory']}

请输出JSON格式：
{{
  "root_cause": "一句话根本原因",
  "category": "镜像问题|启动失败|资源不足|配置错误",
  "solution": "步骤化修复建议",
  "confidence": 0.0-1.0
}}
"""
    
    response = await llm_client.complete(
        model=config.LLM_MODEL,
        prompt=prompt,
        max_tokens=1000
    )
    
    return parse_json(response)
```

---

### 4.3 Collaboration Orchestrator（协作编排器）

**职责**：智能路由通知，处理人机交互，追踪修复进度

**工作流（v1.1调整）**：
```
1. 订阅"diagnosis.completed"事件
2. 根据诊断结果智能路由：
   - 成功 → 通知开发者"✅ {版本} 已上线"
   - 失败(代码问题) → @开发者，附诊断摘要
   - 失败(配置问题) → @运维，附诊断摘要
   - 失败(未知) → 同时@开发和运维
3. 发送飞书交互卡片（按钮：查看完整日志、申请回滚）
4. 监听用户回调：
   - "查看日志" → 返回日志详情URL
   - "申请回滚" → 创建GitLab MR（回退YAML到上一版本）
5. 追踪修复进度（可选，M1简化）
```

**飞书交互卡片（v1.1调整）**：
```python
# integrations/feishu.py
def create_failure_card(diagnosis: DiagnosisResult) -> dict:
    return {
        "card": {
            "header": {
                "title": {"content": "❌ 部署失败诊断"},
                "template": "red"
            },
            "elements": [
                {"tag": "div", "text": {
                    "tag": "lark_md",
                    "content": f"**根本原因**\n{diagnosis.root_cause}"
                }},
                {"tag": "div", "text": {
                    "tag": "lark_md",
                    "content": f"**修复建议**\n{diagnosis.solution}"
                }},
                {"tag": "action", "actions": [
                    {"tag": "button", "text": {"content": "查看完整日志"},
                     "type": "primary", 
                     "value": {"action": "view_logs", "deploy_id": diagnosis.deploy_id}},
                    {"tag": "button", "text": {"content": "申请回滚"},
                     "type": "danger",
                     "value": {"action": "request_rollback", "deploy_id": diagnosis.deploy_id}},
                    {"tag": "button", "text": {"content": "已修复"},
                     "value": {"action": "confirm_fixed", "deploy_id": diagnosis.deploy_id}}
                ]}
            ]
        }
    }
```

**回调处理（v1.1调整）**：
```python
# api/routers/webhooks.py
@router.post("/feishu/callback")
async def handle_feishu_callback(request: Request):
    """处理飞书卡片交互"""
    data = await request.json()
    action = data["action"]["value"]["action"]
    deploy_id = data["action"]["value"]["deploy_id"]
    user_id = data["open_id"]  # 飞书用户ID
    
    if action == "request_rollback":
        # 创建回滚MR（需人工审核）
        deploy = await db.get_deployment(deploy_id)
        previous_deploy = await db.get_previous_successful_deploy(deploy.app_name)
        
        mr_url = await gitlab_service.create_rollback_mr(
            app_name=deploy.app_name,
            current_image=deploy.image,
            rollback_to_image=previous_deploy.image,
            reason=f"回滚部署 {deploy_id}，原因：部署失败",
            author=user_id
        )
        
        return {"msg": f"回滚MR已创建，等待审核：{mr_url}"}
    
    elif action == "view_logs":
        log_url = await log_service.generate_log_url(deploy_id)
        return {"url": log_url}
```

---

## 五、M1不做自研日志系统（v1.2调整）

### 5.1 调整说明

原设计包含完整的Loki-inspired日志系统（Stream + Chunk + Snappy压缩），但经评审确认：
- M1核心验证是"诊断闭环"，不是"日志平台"
- 自研日志系统会消耗大量开发时间
- 直接从K8s API读取日志足够满足M1需求

### 5.2 M1日志采集方案

**简化方案**：
```python
# integrations/kubernetes.py (M1简化版)
from kubernetes import client

class LogCollector:
    async def collect_pod_logs(
        self, namespace: str, pod_name: str, 
        container_name: str = None, tail_lines: int = 500
    ) -> str:
        """直接从K8s API读取Pod日志"""
        logs = self.k8s_client.read_namespaced_pod_log(
            name=pod_name,
            namespace=namespace,
            container=container_name,
            tail_lines=tail_lines,
            timestamps=True
        )
        return logs
```

**存储方案**：
- 诊断时实时从K8s读取日志
- 只存储诊断摘要到PostgreSQL（不存储完整日志）
- 如需查看完整日志，通过API再次从K8s读取

**M2再考虑**：
- 接入现有Loki/Grafana
- 或根据日志量需求决定是否自研

---

## 六、M2日志系统候选设计

M2日志系统候选方案已拆分到 [`docs/m2-log-system-design.md`](../../m2-log-system-design.md)。

M1 不实现自研日志系统，不建立 `log_streams`、`log_chunks`、`log_chunks_data` 表，不保存完整 Pod 原始日志。M1 只在诊断时通过 Kubernetes API 读取最近日志，并保存诊断摘要、证据摘要、错误指纹和必要的脱敏片段。

---

## 七、M1完整数据库Schema

```sql
-- ============================================
-- 部署相关表
-- ============================================

-- 部署记录表
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_name VARCHAR(100) NOT NULL,
    environment VARCHAR(50) NOT NULL,  -- dev/staging/prod
    image VARCHAR(255) NOT NULL,
    tag VARCHAR(50) NOT NULL,
    commit_sha VARCHAR(40),
    author VARCHAR(100),
    status VARCHAR(20) NOT NULL CHECK (
        status IN (
            'pending', 'planning', 'committing', 'syncing', 'rolling_out',
            'healthy', 'degraded', 'diagnosing', 'notified', 'failed', 'cancelled'
        )
    ),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_deploy_status ON deployments(status);
CREATE INDEX idx_deploy_time ON deployments(started_at DESC);
CREATE INDEX idx_deploy_app ON deployments(app_name, environment);

-- 诊断记录表
CREATE TABLE diagnosis_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deploy_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    root_cause TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,  -- 镜像问题/启动失败/资源不足/配置错误
    solution TEXT NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    method VARCHAR(20) NOT NULL,  -- rule/llm/hybrid
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_diagnosis_deploy ON diagnosis_records(deploy_id);
CREATE INDEX idx_diagnosis_category ON diagnosis_records(category);

-- ============================================
-- 事件表（v1.2：PostgreSQL Outbox，作为可靠事件源）
-- ============================================

-- 事件表（用于可靠事件传递）
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,  -- deploy.started/diagnosis.completed
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (
        status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')
    ),
    retry_count INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP
);

CREATE INDEX idx_event_status ON events(status, created_at);
CREATE INDEX idx_event_type ON events(event_type);

-- ============================================
-- 通知和协作表
-- ============================================

-- 飞书通知记录表
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deploy_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    recipient VARCHAR(100) NOT NULL,
    message_type VARCHAR(20) NOT NULL,  -- success/failure/progress
    card_content JSONB,
    sent_at TIMESTAMP DEFAULT NOW(),
    read_at TIMESTAMP,
    action_taken VARCHAR(50)  -- request_rollback/view_logs
);

CREATE INDEX idx_notif_deploy ON notifications(deploy_id);
CREATE INDEX idx_notif_recipient ON notifications(recipient, sent_at DESC);

-- ============================================
-- 变更请求和审计表
-- ============================================

-- 配置变更请求表
CREATE TABLE change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deploy_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    app_name VARCHAR(100) NOT NULL,
    environment VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    request_payload JSONB NOT NULL,
    diff_summary JSONB,
    git_commit_sha VARCHAR(40),
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_change_deploy ON change_requests(deploy_id);
CREATE INDEX idx_change_app_env ON change_requests(app_name, environment);

-- 审计日志表
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor VARCHAR(100) NOT NULL,
    source VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);

-- ============================================
-- 配置和系统表
-- ============================================

-- LLM配置表（支持多模型切换）
CREATE TABLE llm_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,  -- default-diagnosis-model/provider-model-alias
    provider VARCHAR(50) NOT NULL,  -- anthropic/openai/local
    api_endpoint TEXT,
    model_name VARCHAR(100) NOT NULL,
    max_tokens INT DEFAULT 1000,
    temperature FLOAT DEFAULT 0.7,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 环境配置表
CREATE TABLE environment_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_name VARCHAR(100) NOT NULL,
    environment VARCHAR(50) NOT NULL,  -- dev/staging/prod
    namespace VARCHAR(100) NOT NULL,
    argocd_app_name VARCHAR(100) NOT NULL,
    auto_merge BOOLEAN DEFAULT false,  -- 是否自动合并（dev=true, prod=false）
    config JSONB,  -- 其他配置
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(app_name, environment)
);

-- ============================================
-- 性能优化：复合索引
-- ============================================

CREATE INDEX idx_deploy_app_env_time ON deployments(app_name, environment, started_at DESC);
CREATE INDEX idx_diagnosis_deploy_method ON diagnosis_records(deploy_id, method);
```

---

## 八、API接口设计

### 8.1 RESTful API规范

**基础路径**：`/api/v1`

**认证**：Bearer Token（K8s ServiceAccount Token或自定义JWT）

**响应格式**：
```json
{
  "success": true,
  "data": {...},
  "message": "操作成功",
  "timestamp": "2026-06-15T20:00:00Z"
}
```

### 8.2 核心接口

#### **部署相关**

```
GET    /api/v1/deployments
       查询部署历史
       Query: app_name, environment, status, limit, offset
       Response: { deployments: [...], total: 100 }

GET    /api/v1/deployments/{deploy_id}
       获取部署详情
       Response: { deployment: {...}, diagnosis: {...}, logs_summary: [...] }

POST   /api/v1/deployments/{deploy_id}/rollback
       创建回滚MR（M1不直接回滚集群）
       Response: { rollback_mr_url: "https://gitlab.example.com/...", status: "mr_created" }
```

#### **诊断相关**

```
GET    /api/v1/diagnosis/{deploy_id}
       获取诊断报告
       Response: { root_cause, category, solution, confidence, logs_link }

POST   /api/v1/diagnosis/{deploy_id}/confirm
       确认诊断准确（M1只记录反馈，M2再用于memory候选）
       Body: { is_accurate: true, feedback: "实际是XXX问题" }
```

#### **日志相关**

```
GET    /api/v1/logs/query
       查询日志
       Query: deploy_id, keyword, start_time, end_time, limit
       Response: { logs: ["line1", "line2"], total_lines: 5000 }

GET    /api/v1/logs/download/{deploy_id}
       下载完整日志
       Response: application/x-gzip
```

#### **Memory / 知识库 / Skill 候选能力**

Memory、知识库和 skill 候选能力已拆分到 [`docs/m2-memory-skill-design.md`](../../m2-memory-skill-design.md)。M1最小API不提供相关管理接口。

#### **配置管理**

```
GET    /api/v1/config/llm
       获取LLM配置列表
       Response: { configs: [...], active: "default-diagnosis-model" }

POST   /api/v1/config/llm/switch
       切换LLM模型
       Body: { model_name: "gpt-4" }

GET    /api/v1/config/environments
       获取环境配置
       Response: { environments: [...] }
```

#### **监控和健康检查**

```
GET    /health
       健康检查
       Response: { status: "healthy", components: { db: "ok", redis: "optional", argocd: "ok" } }

GET    /metrics
       Prometheus指标导出
       Response: text/plain (Prometheus格式)

GET    /api/v1/stats/dashboard
       仪表盘统计数据
       Response: { 
         success_rate, avg_deploy_time, total_deployments,
         recent_failures: [...] 
       }
```

### 8.3 WebSocket接口（实时日志）

```
WS     /api/v1/logs/stream/{deploy_id}
       实时日志流
       Message: { "timestamp": "...", "line": "log content" }
```

---

## 九、配置文件格式

### 9.1 项目配置文件（源码仓库）

**路径**：`.fde/pipeline-config.yaml`

```yaml
# FDE Workstation 配置文件
version: "1.0"
project_name: "my-app"

# GitLab配置仓库
gitlab_config_repo: "https://gitlab.com/ops/k8s-configs.git"

# 环境配置
environments:
  - name: dev
    namespace: dev
    argocd_app: "my-app-dev"
    auto_merge: true  # 直接提交，无需审核
    
  - name: staging
    namespace: staging
    argocd_app: "my-app-staging"
    auto_merge: true
    
  - name: prod
    namespace: production
    argocd_app: "my-app-prod"
    auto_merge: false  # 创建MR，需人工审核

# 镜像到YAML的映射
image_mappings:
  - image_pattern: "registry.com/my-app"
    target_files:
      - path: "apps/my-app/deployment.yaml"
        container_name: "app"  # 可选，不填则更新所有匹配容器
```

### 9.2 系统配置文件（部署环境）

**路径**：`config/production.yaml`

```yaml
# FDE Workstation 系统配置
server:
  host: "0.0.0.0"
  port: 8000
  workers: 4

database:
  url: "postgresql://user:${DB_PASSWORD}@postgres:5432/fde_workstation"
  pool_size: 20
  max_overflow: 10

redis:
  url: "redis://:${REDIS_PASSWORD}@redis:6379/0"
  max_connections: 50

llm:
  default_provider: "anthropic"
  models:
    - name: "default-diagnosis-model"
      provider: "${LLM_PROVIDER}"
      model_name: "${LLM_MODEL}"
      api_key: "${LLM_API_KEY}"
      max_tokens: 2000
      temperature: 0.7

kubernetes:
  in_cluster: true  # 部署在K8s内部
  namespace: "fde-workstation"

argocd:
  server: "https://argocd.example.com"
  token: "${ARGOCD_TOKEN}"

tekton:
  namespace: "tekton-pipelines"
  event_listener_url: "http://el-fde-listener:8080"

feishu:
  webhook_url: "${FEISHU_WEBHOOK_URL}"
  app_id: "${FEISHU_APP_ID}"
  app_secret: "${FEISHU_APP_SECRET}"
  webhook_verify_token: "${FEISHU_VERIFY_TOKEN}"

logging:
  level: "INFO"
  format: "json"  # 结构化日志

monitoring:
  prometheus_enabled: true
  metrics_port: 9090
```

---

## 十、项目目录结构

```
fde-workstation/
├── backend/
│   ├── api/                          # FastAPI应用
│   │   ├── main.py                   # 应用入口
│   │   ├── dependencies.py           # 依赖注入
│   │   └── routers/
│   │       ├── deployments.py        # 部署相关API
│   │       ├── diagnosis.py          # 诊断相关API
│   │       ├── logs.py               # 日志查询API
│   │       ├── config.py             # 配置管理API
│   │       └── webhooks.py           # 飞书回调
│   │
│   ├── orchestrators/                # 三大编排器
│   │   ├── __init__.py
│   │   ├── pipeline.py               # Pipeline Orchestrator
│   │   ├── diagnosis.py              # Diagnosis Orchestrator
│   │   └── collaboration.py          # Collaboration Orchestrator
│   │
│   ├── engines/                      # 核心引擎
│   │   ├── __init__.py
│   │   ├── yaml_change_engine.py     # YAML变更引擎（M1核心）
│   │   ├── diagnosis_engine.py       # 诊断引擎（规则+LLM）
│   │   ├── rule_engine.py            # 规则引擎
│   │   └── llm_client.py             # LLM客户端抽象层
│   │
│   ├── log_system/                   # M2候选：自研日志系统，M1不创建
│   │   └── README.md                 # 记录M2设计，不进入Week 1交付
│   │
│   ├── integrations/                 # 外部工具集成
│   │   ├── __init__.py
│   │   ├── argocd.py                 # ArgoCD API客户端
│   │   ├── tekton.py                 # Tekton Webhook解析
│   │   ├── kubernetes.py             # K8s API客户端
│   │   ├── prometheus.py             # Prometheus查询
│   │   └── feishu.py                 # 飞书集成
│   │
│   ├── models/                       # 数据模型（SQLAlchemy）
│   │   ├── __init__.py
│   │   ├── deployment.py
│   │   ├── diagnosis.py
│   │   ├── notification.py
│   │   └── config.py
│   │
│   ├── db/                           # 数据库
│   │   ├── __init__.py
│   │   ├── base.py                   # Base类
│   │   ├── session.py                # Session管理
│   │   └── migrations/               # Alembic迁移脚本
│   │
│   ├── workers/                      # Celery异步任务
│   │   ├── __init__.py
│   │   ├── celery_app.py             # Celery配置
│   │   └── diagnosis_worker.py       # LLM诊断任务
│   │
│   ├── shared/                       # 共享模块
│   │   ├── __init__.py
│   │   ├── event_bus.py              # PostgreSQL Outbox + 可选Redis Pub/Sub唤醒
│   │   ├── config_loader.py          # 配置加载
│   │   └── utils.py
│   │
│   ├── config.py                     # 配置加载
│   ├── exceptions.py                 # 自定义异常
│   └── requirements.txt
│
├── config/                           # 配置文件
│   ├── development.yaml
│   ├── production.yaml
│   └── local.yaml.example
│
├── deploy/                           # 部署文件
│   ├── docker-compose.yml            # 开发环境
│   ├── Dockerfile
│   ├── k8s/                          # 生产K8s部署
│   │   ├── namespace.yaml
│   │   ├── configmap.yaml
│   │   ├── secret.yaml.example
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── ingress.yaml
│   └── argocd/                       # ArgoCD配置
│       └── application.yaml
│
├── docs/                             # 文档
│   ├── api/                          # API文档
│   ├── architecture/                 # 架构设计
│   └── superpowers/
│       └── specs/
│           └── 2026-06-15-fde-workstation-m1-design.md
│
├── tests/                            # 测试
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── scripts/                          # 工具脚本
│   └── init_db.py                    # 初始化数据库
│
├── .gitignore
├── README.md
└── pyproject.toml                    # Poetry项目配置
```

---

## 十一、部署方案

### 11.1 开发环境（Docker Compose）

**一键启动**：
```bash
docker-compose up -d
```

**docker-compose.yml**：
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: fde_workstation
      POSTGRES_USER: fde
      POSTGRES_PASSWORD: fde_dev_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass redis_dev_password
    ports:
      - "6379:6379"

  api:
    build: .
    command: uvicorn backend.api.main:app --host 0.0.0.0 --reload
    environment:
      - CONFIG_FILE=config/development.yaml
      - DB_PASSWORD=fde_dev_password
      - REDIS_PASSWORD=redis_dev_password
    volumes:
      - ./backend:/app/backend
      - ./config:/app/config
    ports:
      - "8000:8000"
    depends_on:
      - postgres
      - redis

  celery_worker:
    build: .
    command: celery -A backend.workers.celery_app worker --loglevel=info
    environment:
      - CONFIG_FILE=config/development.yaml
      - DB_PASSWORD=fde_dev_password
      - REDIS_PASSWORD=redis_dev_password
    volumes:
      - ./backend:/app/backend
    depends_on:
      - redis
      - postgres

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./config/prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

volumes:
  postgres_data:
```

### 11.2 生产环境（Kubernetes）

**部署步骤**：

1. **创建Namespace**：
```bash
kubectl apply -f deploy/k8s/namespace.yaml
```

2. **配置Secret**：
```bash
kubectl create secret generic fde-secrets \
  --from-literal=db-password=<password> \
  --from-literal=redis-password=<password> \
  --from-literal=anthropic-api-key=<key> \
  -n fde-workstation
```

3. **部署应用**：
```bash
kubectl apply -f deploy/k8s/
```

**关键配置**（deployment.yaml片段）：
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fde-api
  namespace: fde-workstation
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        image: registry.com/fde-workstation:latest
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 2000m
            memory: 4Gi
        env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: fde-secrets
              key: db-password
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 5
```

---

## 十二、性能优化设计

### 12.1 数据库优化

**强制索引**（所有查询必须使用索引）：
```sql
-- 部署查询热点
CREATE INDEX idx_deploy_app_env_time ON deployments(app_name, environment, started_at DESC);

-- 诊断记录关联查询
CREATE INDEX idx_diagnosis_deploy_method ON diagnosis_records(deploy_id, method);

-- M1日志查询实时读取K8s API，不建立log_chunks索引

-- M1不建立知识库索引；memory/knowledge/skill候选能力见 docs/m2-memory-skill-design.md
```

**连接池配置**：
```python
# config.py
DATABASE_POOL_SIZE = 20
DATABASE_MAX_OVERFLOW = 10
DATABASE_POOL_RECYCLE = 3600  # 1小时回收连接
```

### 12.2 缓存策略

**缓存层次（M1可选）**：
```python
# 热点数据缓存
- 仪表盘统计：TTL 30s
- 最近10次部署：TTL 10s
- LLM配置：TTL 5分钟
- 诊断摘要：TTL 1小时

# 不缓存
- 实时日志流
- 进行中的部署状态
```

**实现示例**：
```python
from functools import wraps

def cache_result(ttl: int):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            cache_key = f"{func.__name__}:{args}:{kwargs}"
            cached = await redis.get(cache_key)
            if cached:
                return json.loads(cached)
            
            result = await func(*args, **kwargs)
            await redis.setex(cache_key, ttl, json.dumps(result))
            return result
        return wrapper
    return decorator

@cache_result(ttl=30)
async def get_dashboard_stats():
    return await db.query(...)
```

### 12.3 异步处理

**Celery任务队列**：
```python
# LLM诊断不阻塞主流程
@celery.task(bind=True, max_retries=3)
def llm_diagnose_task(self, logs, events, metrics):
    try:
        result = await llm_client.complete(prompt)
        return result
    except Exception as e:
        self.retry(exc=e, countdown=60)
```

### 12.4 性能指标

| 接口类型 | 响应时间目标 | 优化手段 |
|---------|-------------|---------|
| 仪表盘统计 | < 500ms | 数据库索引；Redis缓存可选 |
| 部署历史列表 | < 300ms | 复合索引 + 分页（limit 20） |
| 单条部署详情 | < 200ms | 主键查询 + JOIN优化 |
| 日志查询 | < 5s | K8s API tail_lines限制 + 超时控制 |
| LLM诊断 | < 5s | 异步任务 + 前端轮询 |

---

## 十三、安全设计

### 13.1 认证和授权

**API认证**：
```python
# JWT Token验证
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer

security = HTTPBearer()

async def verify_token(credentials = Depends(security)):
    token = credentials.credentials
    payload = jwt.decode(token, SECRET_KEY)
    return payload["user_id"]
```

**K8s ServiceAccount**：
```yaml
# 生产环境使用K8s ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fde-api
  namespace: fde-workstation
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: fde-log-reader
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["events"]
  verbs: ["get", "list"]
```

### 13.2 敏感信息管理

**环境变量 + K8s Secret**：
```yaml
# deploy/k8s/secret.yaml.example
apiVersion: v1
kind: Secret
metadata:
  name: fde-secrets
type: Opaque
stringData:
  db-password: <PASSWORD>
  redis-password: <PASSWORD>
  anthropic-api-key: <API_KEY>
  feishu-webhook-url: <WEBHOOK>
  feishu-verify-token: <TOKEN>
```

**配置文件脱敏**：
```yaml
# config/production.yaml
database:
  url: "postgresql://user:${DB_PASSWORD}@postgres:5432/db"
  # 不直接写密码
```

### 13.3 飞书Webhook签名验证

```python
# api/routers/webhooks.py
import hmac
import hashlib

def verify_feishu_signature(
    timestamp: str, nonce: str, body: str, signature: str
) -> bool:
    """验证飞书Webhook签名"""
    token = config.FEISHU_VERIFY_TOKEN
    sign_str = f"{timestamp}{nonce}{token}{body}"
    expected_sig = hmac.new(
        token.encode(),
        sign_str.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected_sig, signature)
```

### 13.4 数据库连接加密

```python
DATABASE_URL = (
    "postgresql://user:pass@host:5432/db"
    "?sslmode=require&sslrootcert=/path/to/ca.pem"
)
```

---

## 十四、监控和可观测性

### 14.1 Prometheus指标

**指标导出**：
```python
from prometheus_client import Counter, Histogram, Gauge

# 部署相关指标
deploy_total = Counter('fde_deployments_total', 'Total deployments', ['app', 'env', 'status'])
deploy_duration = Histogram('fde_deploy_duration_seconds', 'Deploy duration')

# 诊断相关指标
diagnosis_accuracy = Gauge('fde_diagnosis_accuracy', 'Diagnosis accuracy', ['method'])
diagnosis_latency = Histogram('fde_diagnosis_latency_seconds', 'Diagnosis latency')

# 日志读取指标
log_read_total = Counter('fde_log_read_total', 'Total K8s log reads', ['app', 'env', 'status'])
log_read_latency = Histogram('fde_log_read_latency_seconds', 'K8s log read latency')
```

**Grafana仪表盘指标**：
- 部署成功率（成功数/总数）
- 平均部署耗时
- 人工交互次数趋势
- LLM诊断准确率
- 诊断记录增长曲线
- K8s日志读取耗时

### 14.2 结构化日志

```python
import structlog

logger = structlog.get_logger()

# 结构化日志示例
logger.info(
    "deployment_completed",
    deploy_id=deploy_id,
    app_name=app_name,
    environment=environment,
    duration_seconds=duration,
    status="success"
)
```

### 14.3 健康检查

```python
# api/routers/health.py
@router.get("/health")
async def health_check():
    checks = {
        "database": await check_database(),
        "redis": await check_redis_if_enabled(),
        "argocd": await check_argocd(),
        "feishu": await check_feishu()
    }
    
    all_healthy = all(checks.values())
    status_code = 200 if all_healthy else 503
    
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if all_healthy else "degraded",
            "components": checks,
            "timestamp": datetime.now().isoformat()
        }
    )
```

---

## 十五、开发计划（3周，v1.2调整为17任务）

### Week 1: 基础设施 + Pipeline Orchestrator（5任务）

| 任务 | 负责人 | 交付物 | 验收标准 |
|------|--------|--------|----------|
| W1-T1: 项目初始化 | 后端 | docker-compose.yml + PostgreSQL + 可选Redis | `docker-compose up -d`启动成功 |
| W1-T2: 数据库Schema | 后端 | deployments、diagnosis_records、events表 | 表+索引创建成功 |
| W1-T3: PostgreSQL Outbox事件机制 | 后端 | shared/event_bus.py | events表可靠存储，worker补偿扫描，可选Pub/Sub唤醒 |
| W1-T4: Pipeline Orchestrator | 后端 | orchestrators/pipeline.py | 接收Tekton Webhook → 创建部署记录 → 发布事件 |
| W1-T5: YAML变更引擎 + Git提交 + ArgoCD同步 | 后端 | engines/yaml_change_engine.py + integrations/git.py + integrations/argocd.py | YAML结构化更新成功，Git提交成功，dev环境可同步 |

**Week 1里程碑**：Tekton构建完成 → YAML更新 → 部署记录入库

---

### Week 2: 诊断引擎 + 飞书通知（7任务）

| 任务 | 负责人 | 交付物 | 验收标准 |
|------|--------|--------|----------|
| W2-T1: Diagnosis Orchestrator | 后端 | orchestrators/diagnosis.py | 监听ArgoCD状态，捕获Degraded/Failed |
| W2-T2: K8s数据采集 | 后端 | integrations/kubernetes.py | 从K8s API读取Events + Pod logs |
| W2-T3: 规则引擎 | 后端 | engines/rule_engine.py | Top 10常见错误，准确率>90%，<3秒 |
| W2-T4: LLM诊断引擎 | 后端+算法 | engines/llm_client.py | 可配置Provider，输出结构化报告 |
| W2-T5: 诊断编排逻辑 | 后端 | engines/diagnosis_engine.py | 规则优先 + LLM增强，降级策略 |
| W2-T6: 飞书Webhook + 卡片 | 后端 | integrations/feishu.py | 通知送达，展示诊断摘要 |
| W2-T7: Collaboration Orchestrator + 回滚申请 | 后端 | orchestrators/collaboration.py | 智能路由，飞书按钮→创建GitLab MR |

**Week 2里程碑**：注入故障 → 规则/LLM诊断 → 飞书通知 → 回滚申请

---

### Week 3: API + 失败场景测试 + 交付（5任务）

| 任务 | 负责人 | 交付物 | 验收标准 |
|------|--------|--------|----------|
| W3-T1: 最小API | 后端 | api/routers/*.py | 部署列表、详情、日志查询，响应<500ms |
| W3-T2: 失败场景测试 | 测试 | 测试用例 | 事件重复、API不可用、LLM超时，降级策略生效 |
| W3-T3: 安全增强 | 后端 | 权限配置 + 脱敏逻辑 | K8s权限最小化，日志脱敏 |
| W3-T4: 性能测试 | 测试 | 性能报告 | 规则引擎<3s，LLM成本统计 |
| W3-T5: 集成测试 + 部署文档 | 全员 | README + 部署指南 | 端到端演示通过，能按文档部署 |

**Week 3里程碑**：完整闭环演示 + 失败场景不崩溃

---

## 十六、M2候选任务（不进入M1验收）
| 回滚功能 | 后端 | 一键回滚API | 能回滚到上一稳定版本 |
| Prometheus指标导出 | 后端 | /metrics接口 | 导出核心业务指标 |
| 健康检查 | 后端 | /health接口 | 检查所有组件状态 |
| 评估引擎基础版 | 产品+后端 | 指标采集和基线对比 | 自动计算3个核心指标 |
| 配置管理API | 后端 | api/routers/config.py | LLM模型切换、环境配置 |
| 前端基础框架 | 前端 | React项目搭建 | 仪表盘、部署历史、诊断记录页面 |
| 数据可视化 | 前端 | ECharts集成 | 成功率、耗时趋势图表 |
| 集成测试 | 测试 | 端到端测试用例 | 模拟完整流程，3个Agent协作无误 |
| 部署文档 | FDE | README + 部署指南 | 能按文档在K8s部署成功 |

**说明**：以上能力不作为M1通过条件。M1通过条件以“Agent Trio闭环 + 失败场景验收”为准。

---

## 十七、风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| YAML变更引擎误改配置 | 中 | 高 | 只开放受控action，修改前后做结构化校验和diff确认 |
| LLM诊断准确率不达标 | 中 | 中 | 规则引擎优先策略，LLM作为增强；M2再考虑知识沉淀 |
| K8s日志读取超时 | 中 | 中 | M1限制tail_lines和超时时间，后续再接入日志平台 |
| 飞书API限流 | 低 | 低 | 实现请求队列，控制发送频率 |
| K8s API权限不足 | 中 | 高 | Week 1确认权限，提前与运维沟通 |
| 前端开发延期 | 中 | 中 | Week 3才启动前端，如果延期可用Grafana+飞书临时替代 |
| 多环境配置复杂度 | 低 | 中 | MVP先支持单环境，后续扩展 |

---

## 十八、验收标准（Definition of Done，v1.2调整）

### 18.1 Agent Trio验收（成功路径）

| 验收项 | 验收标准 | 验证方式 |
|--------|----------|----------|
| Pipeline Agent | 开发者push代码后，5分钟内完成"构建→YAML更新→ArgoCD同步"，全程无人干预 | 实际演示3次 |
| Diagnosis Agent（规则） | 模拟Top 10常见故障，规则引擎能在3秒内返回诊断（准确率>90%） | 故障注入测试 |
| Diagnosis Agent（LLM） | 模拟复杂故障，LLM能在10秒内返回诊断（准确率>85%） | 故障注入测试 |
| Collaboration Agent | 部署失败后1分钟内，正确责任人收到飞书通知，包含诊断摘要 | 查看飞书消息记录 |
| 回滚申请 | 点击"申请回滚"按钮，能创建GitLab MR并返回链接 | 实际操作验证 |
| 端到端链路 | 从代码提交到问题诊断通知，人工交互次数≤2次 | 统计10次部署 |

### 18.2 失败场景验收（v1.2新增）

| 验收项 | 验收标准 | 验证方式 |
|--------|----------|----------|
| 事件重复投递 | Tekton事件重复时不会重复部署（幂等性） | 重复发送事件 |
| ArgoCD API不可用 | 事件进入failed状态，可重试 | 关闭ArgoCD服务 |
| K8s权限不足 | 诊断报告明确说明缺失权限 | 移除部分权限测试 |
| LLM超时/不可用 | 规则引擎兜底，返回基础诊断 | Mock LLM超时 |
| 飞书发送失败 | 通知状态标记为失败，记录错误日志 | Mock飞书API失败 |

### 18.3 性能验收

| 指标 | 目标 | 验证方式 |
|------|------|----------|
| API响应时间 | 列表<300ms，详情<200ms | Apache Bench压测 |
| 规则引擎诊断 | <3秒 | 实际测量 |
| LLM诊断 | <10秒 | 实际测量 |
| 数据库查询 | 所有查询使用索引 | EXPLAIN ANALYZE检查 |

### 18.4 功能验收（v1.2调整）

| 功能 | 验收标准 |
|------|----------|
| 规则引擎 | 覆盖Top 10常见错误，准确率>90% |
| LLM诊断 | 输出结构化JSON（root_cause/solution/confidence） |
| 日志查询 | 从K8s API读取最近500行日志，响应<5秒 |
| 飞书交互 | 支持"查看日志"、"申请回滚"两个按钮 |
| 监控导出 | /metrics接口导出核心业务指标 |
| 健康检查 | /health接口正确反映数据库、可选Redis、ArgoCD状态 |

---

## 十九、后续扩展规划（里程碑二及以后）

### 19.1 M2功能扩展

- **RAG召回**：向量数据库（pgvector/FAISS）语义检索历史案例
- **微服务支持**：一对多镜像映射，跨仓库编排
- **前端完善**：实时日志流、知识库管理界面、配置向导
- **回滚优化**：金丝雀发布、灰度回滚
- **评估增强**：A/B测试框架、客户共创看板

### 19.2 性能优化

- **分布式日志系统**：Ingester/Querier分离，支持TB级日志
- **缓存优化**：多级缓存（本地缓存 + Redis + CDN）
- **数据库优化**：读写分离、分库分表

### 19.3 生态集成

- **CI/CD工具扩展**：支持Jenkins、GitHub Actions、GitLab CI
- **IM扩展**：钉钉、企业微信、Slack
- **可观测性**：接入Grafana Loki、Jaeger分布式追踪

---

## 二十、总结

### 20.1 核心价值

本设计通过**GitOps优先**（YAML变更引擎修改Git配置仓库，ArgoCD同步目标状态）和**聚焦差异化价值**（编排层、智能诊断、飞书协作、审计闭环），在3周内交付一个可验证的MVP系统。

**技术亮点**：
1. **三Agent协作架构**：事件驱动、解耦设计、可独立扩展
2. **YAML变更引擎**：结构化修改Raw Kubernetes配置，后续扩展Helm和Kustomize
3. **混合诊断引擎**：规则引擎优先 + LLM增强，平衡准确率和成本
4. **审计闭环**：部署、变更、诊断、通知和回滚申请均可追溯

**商业价值**：
- 部署流程自动化率：20% → 95%
- 问题诊断时间：2小时 → 5分钟
- 人工交互次数：5-10轮 → 0-1轮

**附录：参考资料**

- [M1架构决策基线](../../m1-architecture-decisions.md)
- [M2日志系统候选设计](../../m2-log-system-design.md)
- [M2 Memory与Skill候选能力设计](../../m2-memory-skill-design.md)
- [Tekton Triggers文档](https://tekton.dev/docs/triggers/)
- [Grafana Loki架构设计](https://grafana.com/docs/loki/latest/get-started/architecture/)
- [Dify生产架构指南](https://markaicode.com/architecture/dify-production-system-design-architecture/)
- [Palantir AIP架构](https://www.palantir.com/docs/foundry/architecture-center/aip-architecture)

---

**文档版本历史**

| 版本 | 日期 | 变更说明 | 作者 |
|------|------|----------|------|
| v1.0 | 2026-06-15 | 初始版本，完成整体架构设计 | FDE团队 |
| v1.1 | 2026-06-15 | 设计评审后收敛M1范围，推迟自研日志系统、完整前端、EDD Engine和知识库自动沉淀 | FDE团队 |
| v1.2 | 2026-06-16 | 对齐M1架构决策基线，统一ArgoCD、YAML变更引擎、日志、事件机制、Schema、回滚和验收口径 | FDE团队 |
| v1.3 | 2026-06-16 | 删除简历亮点，拆分M2日志系统和memory/skill候选能力，明确M1不以高并发为目标 | FDE团队 |

---

**设计文档已完成v1.3结构调整，按M1架构决策基线执行。**
