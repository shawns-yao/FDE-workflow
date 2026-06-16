# M1开发可行性分析

**日期**：2026-06-16  
**视角**：M1进入实现前的开发可行性与阻塞项评估

---

## 一、当前设计的主要问题

### P0：严重问题（会卡住开发）

#### 1. 测试项目的关键信息缺失

**问题**：缺少以下关键信息时，无法开始真实编码：

```text
测试项目使用什么配置格式？
   - Raw Kubernetes YAML？
   - Helm values.yaml？
   - Kustomize？

配置仓库在哪里？
   - Git地址是什么？
   - 目录结构是什么样？
   - YAML文件路径是什么？

ArgoCD Application配置如何？
   - Application名称是什么？
   - 监听哪个Git仓库和路径？
   - 是否开启了autoSync？

Tekton Pipeline输出什么？
   - 镜像格式是 registry/image:tag 还是带digest？
   - Webhook payload结构是什么？
   - 哪些字段可用？

Kubernetes环境信息？
   - namespace名称？
   - Deployment名称？
   - 容器名称？
   - label selector规则？
```

**影响**：
- 无法编写真实的YAML变更代码
- 无法编写真实的ArgoCD集成代码
- 无法编写真实的K8s日志读取代码
- Week 1 Day 3的代码只能是"假代码"

**解决方案**：
在Week 0完成时，必须提供一个**真实的测试项目配置清单**：

```yaml
# config/test-project.yaml
test_project:
  name: demo-app
  
  code_repo:
    url: git@gitlab.example.com:app/demo-app.git
    branch: main
  
  config_repo:
    url: git@gitlab.example.com:ops/demo-gitops.git
    branch: main
    config_file: apps/demo-app/dev/deployment.yaml
    config_type: raw-kubernetes  # 或 helm-values / kustomize
  
  argocd:
    application_name: demo-app-dev
    namespace: demo
    auto_sync_enabled: true
  
  kubernetes:
    namespace: demo
    deployment_name: demo-app
    container_name: demo-app
    labels:
      app: demo-app
      env: dev
  
  tekton:
    webhook_url: https://fde.example.com/webhooks/tekton
    image_format: "registry.example.com/demo-app:{commit_sha}"
    
  image:
    registry: registry.example.com
    repository: demo-app
    tag_pattern: "{date}-{short_sha}"  # 例如 20260616-abc123
```

**没有这个配置，Week 1 Day 3根本写不出真实代码。**

---

#### 2. 前端完全缺失导致的链路验证问题

**问题**：M1没有前端，那如何验证完整链路？

当前设计说：
- Tekton构建完成 → 自动触发YAML更新
- 但前端开关、Schema、配置面板都设计了

**矛盾**：
- 如果M1只做自动触发，为什么设计前端Schema？
- 如果M1要做前端，Week 1-3的17个任务里完全没提到

**待确认点**：
```text
场景1：Tekton构建完成自动发布
  - 这个链路清楚
  - Week 1可以验证
  - 但为什么设计了前端Schema和配置面板？

场景2：人工通过前端修改配置
  - M1做不做前端？
  - 如果不做，如何测试"前端修改副本数"这个场景？
  - 如果做，Week 1-3任务里没有前端任务

场景3：飞书回调回滚
  - 这个链路清楚
  - 但回滚是创建MR，谁来合并MR？
  - 合并后如何验证回滚成功？
```

**建议**：
明确M1的**最小可验证链路**：

```text
Week 1验收链路（自动发布）：
1. 手动触发Tekton构建
2. Tekton构建成功，回调FDE API
3. FDE修改Git配置仓库YAML
4. ArgoCD同步
5. K8s滚动更新
6. 飞书通知成功

Week 2验收链路（失败诊断）：
1. 故意让构建镜像有问题（CrashLoopBackOff）
2. FDE检测失败
3. 读取日志和Events
4. 规则诊断
5. 飞书通知失败原因

Week 3验收链路（回滚申请）：
1. 点击飞书"申请回滚"按钮
2. FDE创建GitLab MR
3. 人工合并MR
4. ArgoCD同步旧版本
5. 飞书通知回滚成功

不验证的链路（推迟到M2）：
- 前端配置面板
- 前端修改副本数、环境变量
- 前端开关
```

**没有明确的验收链路，开发会迷失方向。**

---

#### 3. 事件机制需要控制实现复杂度

**问题**：当前项目基本不涉及高并发，事件机制不能按高吞吐、多消费者系统设计。

**实际需求**：
- M1只有1个测试项目
- 基本不会有并发
- 每天可能只发布几次

**M1只需要可靠状态流转**：
```python
async def handle_build_complete(payload):
    # 1. 创建部署记录
    deploy = await db.create_deployment(...)
    
    # 2. 修改YAML
    await yaml_engine.update_image(...)
    
    # 3. 提交Git
    await git_client.commit_and_push(...)
    
    # 4. 观察ArgoCD状态
    await argocd_client.wait_for_sync(...)
    
    # 5. 飞书通知
    await feishu_client.send_notification(...)
```

**事件机制的边界**：
- PostgreSQL events表作为可靠事件源和审计记录。
- Worker定时扫描pending事件做补偿。
- Redis Pub/Sub只作为可选唤醒，丢失不影响最终处理。
- Redis Streams不作为M1强制依赖。

**需要避免的过度设计**：
- 为单测试项目引入完整消息中间件语义。
- 设计消费者组、分区、吞吐扩展等M1不需要的能力。
- 把事件机制做成独立平台，而不是部署状态流转的辅助模块。

**建议**：
```text
M1轻量方案：
- Pipeline Orchestrator先写deployments和events表
- Worker扫描pending事件并执行YAML变更、Git提交、ArgoCD同步
- 每个事件使用idempotency_key保证重复处理安全
- Redis Pub/Sub只做唤醒优化，不参与可靠性判断

好处：
- Week 1可以快速跑通链路
- 代码简单易调试
- 满足M1验证目标
- 后续升级Redis Streams不影响主数据模型
```

---

### P1：中等问题（会降低开发效率）

#### 4. YAML变更引擎设计超出M1需求

**问题**：设计了完整的Adapter体系，但M1只需要改一个字段。

**当前设计**：
- RawKubernetesAdapter
- HelmValuesAdapter
- KustomizeAdapter
- 双层架构（业务动作 + Patch引擎）
- Schema驱动
- 三层操作模式

**M1实际需求**：
```python
# M1只需要这个
def update_image_in_yaml(yaml_file: str, new_image: str) -> str:
    """修改deployment.yaml中的镜像"""
    deployment = yaml.safe_load(open(yaml_file))
    deployment['spec']['template']['spec']['containers'][0]['image'] = new_image
    yaml.safe_dump(deployment, open(yaml_file, 'w'))
    return new_image
```

**真实情况**：
- M1只有1个测试项目
- 只需要改镜像tag
- 不需要改副本数、环境变量、Ingress
- 不需要前端

**建议**：
```text
Week 1：
- 写最简单的update_image函数
- 硬编码Deployment路径
- 只验证能改镜像、能提交Git、能触发ArgoCD

Week 2：
- 如果需要，再抽象Adapter

Week 3：
- 如果需要，再做Schema

好处：
- Week 1 Day 3能快速完成
- 代码量减少70%
- 调试容易
- 满足M1验证目标
```

**过度设计的后果**：
- Week 1 Day 3可能完成不了
- 增加bug风险
- 分散注意力

---

#### 5. 权限准备的实际困难

**问题**：Week 0的7个权限准备，实际可能需要1-2周。

**现实情况**：
```text
Git机器人账号：
  - 需要GitLab管理员审批
  - 可能需要安全审查
  - 可能需要申请流程
  - 预计：2-3天

ArgoCD Token：
  - 需要ArgoCD管理员配置RBAC
  - 需要测试权限范围
  - 可能需要多次调整
  - 预计：1-2天

K8s ServiceAccount：
  - 需要K8s管理员创建
  - 需要配置Role和RoleBinding
  - 需要多个namespace
  - 预计：1-2天

Tekton Webhook：
  - 需要修改Tekton Pipeline
  - 需要配置EventListener
  - 需要测试回调
  - 预计：1-2天

飞书应用：
  - 需要企业管理员审批
  - 可能需要审核流程
  - 预计：3-5天

LLM API Key：
  - 如果公司有账号，1天
  - 如果需要新申请，1-2周

总计：可能需要1-2周，不是1-2天
```

**建议**：
- 立即开始Week 0准备（不要等Week 1代码）
- 并行进行：一边准备权限，一边写本地模拟代码
- Week 1 Day 1-2可以先写不依赖权限的部分
- Week 1 Day 3-5再接入真实系统

---

#### 6. 诊断引擎的LLM调用成本

**问题**：每次失败都调用LLM，成本可能很高。

**场景**：
```text
场景1：镜像拉取失败（ImagePullBackOff）
  - 这是最常见错误
  - 规则引擎就能诊断
  - 不需要LLM

场景2：启动失败（CrashLoopBackOff）
  - 可能是多种原因
  - 规则引擎先匹配常见原因
  - 匹配不到再用LLM

场景3：性能问题（OOM Killed）
  - 规则引擎能识别
  - 不需要LLM
```

**成本估算**：
```text
假设每次失败诊断：
- 日志500行
- Events 10条
- LLM输入：3000 tokens
- LLM输出：500 tokens

LLM服务价格示例：
- 输入：$15/1M tokens
- 输出：$75/1M tokens

每次诊断成本：
- 3000 * $15/1M + 500 * $75/1M
- = $0.045 + $0.0375
- = $0.0825 (约¥0.6)

如果每天失败10次：
- 每天成本：¥6
- 每月成本：¥180

如果规则引擎能挡住90%：
- 每月成本：¥18
```

**建议**：
- Week 2先做规则引擎
- 规则引擎能处理80%常见错误
- LLM只处理规则未匹配的情况
- 记录LLM调用次数和成本

---

### P2：小问题（可以接受）

#### 7. 文档示例代码的可执行性

**问题**：文档中的代码是设计示例，不是可运行代码。

**现状**：
- import路径是假的
- 函数签名不完整
- 缺少错误处理
- 缺少类型注解

**影响**：
- 不能直接复制使用
- 需要重新理解设计意图
- 可能理解错误

**建议**：
- Week 1实际编码时，代码质量比示例代码高
- 示例代码只用于理解设计
- 不要期望复制粘贴就能用

---

## 二、建议实施方式

### Week 0（准备阶段，1-2周）

**目标**：准备权限 + 确认测试项目信息

```text
Day 1-3：申请权限
- 同时进行，不等待
- Git机器人、ArgoCD Token、K8s ServiceAccount、飞书应用

Day 4-7：等待审批
- 利用这段时间搭建本地开发环境
- 写Mock数据进行本地测试

Day 8-10：验证权限
- 逐个验证权限是否可用
- 记录到test-project.yaml

完成标志：
- 所有权限可用
- test-project.yaml配置完整
- 本地开发环境可运行
```

---

### Week 1（基础链路，5天）

**目标**：跑通"Tekton → YAML → ArgoCD → 飞书"最简链路

#### Day 1：项目初始化（保持不变）
```bash
- docker-compose.yml
- PostgreSQL + Redis
- 基础目录结构
- Alembic迁移
```

#### Day 2：数据库和基础模型（保持不变）
```bash
- deployments表 + 状态机约束
- events表
- SQLAlchemy模型
- 基础API框架
```

#### Day 3：最简Pipeline Orchestrator（简化）
```python
# 不做事件总线，直接顺序调用
@router.post("/webhooks/tekton")
async def handle_tekton_webhook(request: Request):
    # 1. 验证签名
    verify_signature(request)
    
    # 2. 解析payload
    payload = await request.json()
    
    # 3. 创建部署记录
    deploy = await db.create_deployment(
        app_name=payload["application"],
        image=payload["image"],
        status="pending"
    )
    
    # 4. 修改YAML（最简实现）
    yaml_file = clone_and_modify_yaml(
        repo_url=config.CONFIG_REPO,
        yaml_path="apps/demo-app/deployment.yaml",
        new_image=payload["image"]
    )
    
    # 5. 提交Git
    git_commit_and_push(
        message=f"Update image to {payload['image']}",
        files=[yaml_file]
    )
    
    # 6. 触发ArgoCD sync（如果需要）
    if config.ARGOCD_AUTO_SYNC:
        await argocd.sync("demo-app-dev")
    
    # 7. 更新状态
    await db.update_deployment(deploy.id, status="syncing")
    
    # 8. 飞书通知
    await feishu.send_message(f"部署已提交: {payload['image']}")
    
    return {"status": "ok", "deploy_id": str(deploy.id)}
```

**验收**：
- 手动调用Webhook API
- 验证Git提交成功
- 验证ArgoCD同步
- 验证飞书通知

#### Day 4：ArgoCD状态观察
```python
# 后台任务：观察ArgoCD同步状态
async def watch_argocd_status():
    while True:
        deploying = await db.get_deployments(status="syncing")
        for deploy in deploying:
            app_status = await argocd.get_application_status(deploy.argocd_app)
            
            if app_status.sync_status == "Synced":
                if app_status.health_status == "Healthy":
                    await db.update_deployment(deploy.id, status="healthy")
                    await feishu.send_message(f"部署成功: {deploy.image}")
                elif app_status.health_status == "Degraded":
                    await db.update_deployment(deploy.id, status="degraded")
```

#### Day 5：完整链路测试
```bash
# 手动触发测试
1. 修改测试项目代码
2. 触发Tekton构建
3. 等待Webhook回调
4. 验证YAML更新
5. 验证ArgoCD同步
6. 验证飞书通知

期望结果：
- 端到端流程跑通
- 每个状态都有日志
- 飞书收到通知
```

---

### Week 2（诊断能力，5天）

**目标**：检测失败 + 规则诊断 + LLM增强

#### Day 1-2：失败检测
```python
async def watch_argocd_status():
    # ... 前面的逻辑
    
    elif app_status.health_status == "Degraded":
        await db.update_deployment(deploy.id, status="diagnosing")
        
        # 读取K8s日志和Events
        logs = await k8s.get_pod_logs(deploy.namespace, deploy.app_name)
        events = await k8s.get_events(deploy.namespace, deploy.app_name)
        
        # 触发诊断
        await diagnose(deploy.id, logs, events)
```

#### Day 3：规则引擎
```python
# rules/common_errors.py
RULES = [
    {
        "pattern": r"ImagePullBackOff|ErrImagePull",
        "category": "image_pull_failed",
        "root_cause": "镜像拉取失败",
        "solution": "检查镜像地址和镜像仓库权限",
        "confidence": 0.95
    },
    {
        "pattern": r"CrashLoopBackOff",
        "category": "crash_loop",
        "root_cause": "容器启动后崩溃",
        "solution": "检查应用日志和启动命令",
        "confidence": 0.85
    },
    # ... 添加Top 10规则
]

def rule_based_diagnosis(logs: str, events: str) -> Diagnosis | None:
    for rule in RULES:
        if re.search(rule["pattern"], logs + events):
            return Diagnosis(**rule)
    return None
```

#### Day 4：LLM诊断
```python
async def llm_diagnosis(logs: str, events: str) -> Diagnosis:
    # 脱敏
    logs = desensitize(logs)
    
    # 调用LLM
    prompt = f"""
    分析以下Kubernetes部署失败原因：
    
    Pod日志：
    {logs[-2000:]}  # 只取最后2000字符
    
    Events：
    {events}
    
    请返回JSON格式：
    {{
      "root_cause": "根本原因",
      "category": "分类",
      "solution": "解决方案",
      "confidence": 0.7
    }}
    """
    
    response = await llm_client.complete(prompt)
    return parse_llm_response(response)
```

#### Day 5：集成和测试
```python
async def diagnose(deploy_id: str, logs: str, events: str):
    # 1. 先用规则引擎
    diagnosis = rule_based_diagnosis(logs, events)
    
    # 2. 规则未匹配或置信度低，用LLM
    if not diagnosis or diagnosis.confidence < 0.8:
        diagnosis = await llm_diagnosis(logs, events)
    
    # 3. 保存诊断
    await db.save_diagnosis(deploy_id, diagnosis)
    
    # 4. 飞书通知
    await feishu.send_diagnosis(deploy_id, diagnosis)
```

---

### Week 3（回滚和完善，5天）

#### Day 1-2：回滚申请
```python
# 飞书回调
@router.post("/webhooks/feishu")
async def handle_feishu_callback(request: Request):
    data = await request.json()
    
    if data["action"] == "request_rollback":
        deploy_id = data["deploy_id"]
        deployment = await db.get_deployment(deploy_id)
        
        # 找上一个成功版本
        previous = await db.get_previous_successful_deployment(
            deployment.app_name,
            deployment.environment
        )
        
        # 创建GitLab MR
        mr_url = await gitlab.create_mr(
            title=f"回滚 {deployment.app_name} 到 {previous.image}",
            description=f"回滚失败部署 {deploy_id}",
            source_branch=create_rollback_branch(previous.image),
            target_branch="main"
        )
        
        await feishu.send_message(f"回滚MR已创建：{mr_url}")
```

#### Day 3-5：完善和测试
- 补充错误处理
- 补充日志
- 补充监控指标
- 完整端到端测试
- 编写部署文档

---

## 三、最大风险

### 风险1：Week 0可能超期
- **预计**：1-2周
- **实际**：可能3-4周
- **缓解**：立即开始，并行准备

### 风险2：测试项目信息不完整
- **影响**：Week 1 Day 3无法编写真实代码
- **缓解**：Week 0完成时必须提供test-project.yaml

### 风险3：设计过度复杂
- **影响**：Week 1-3可能完成不了
- **缓解**：先做最简实现，满足验收即可

### 风险4：ArgoCD行为不确定
- **问题**：不知道autoSync是否开启
- **影响**：不知道是否需要主动sync
- **缓解**：Week 0测试确认

### 风险5：LLM成本超预期
- **问题**：频繁调用成本高
- **缓解**：规则引擎挡住90%

---

## 四、建议

### 立即行动
1. **开始Week 0**（不要等设计完美）
2. **确认测试项目配置**（编写test-project.yaml）
3. **简化Week 1实现**（不做事件总线、不做完整Adapter）

### 设计调整
1. **统一事件总线**（选PostgreSQL方案）
2. **明确验收链路**（什么场景算通过）
3. **降低Week 1复杂度**（先跑通，再完善）

### 开发原则
1. **最简实现优先**
2. **真实可运行代码**
3. **逐步迭代完善**

---

## 总结

**最大挑战**：
1. 测试项目信息不完整（最严重）
2. 设计过度复杂（影响进度）
3. Week 0时间被低估（影响启动）
4. 事件总线设计不统一（影响决策）

**建议做法**：
1. 立即开始Week 0准备
2. 确认test-project.yaml配置
3. Week 1先做最简实现
4. 逐步迭代完善

**核心建议**：
- **先跑通，再完善**
- **真实项目信息比设计更重要**
- **3周时间很紧，必须聚焦最小验证链路**
