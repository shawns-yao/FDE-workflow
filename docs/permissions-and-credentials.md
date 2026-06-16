# 权限与凭证设计（M1必读）

**版本**：v1.0  
**日期**：2026-06-16  
**状态**：必须在Week 1实施前确认

---

## 文档角色

本文是 Week 0 权限和凭证准备文档。文档分类和阅读顺序见 [`docs/document-index.md`](document-index.md)，M1 架构决策以 [`docs/m1-architecture-decisions.md`](m1-architecture-decisions.md) 为最高优先级。

---

## 核心原则

1. **GitOps优先**：修改Git配置仓库，让ArgoCD自动同步，而非直接操作ArgoCD
2. **按环境分级**：dev自动化，staging审批，prod严格控制
3. **最小权限**：从Day 1就按最小权限设计，绝不用admin token
4. **审计可追溯**：所有操作记录到数据库，操作者身份可追溯
5. **凭证隔离**：每个环境独立凭证，不共用

---

## 一、Git配置仓库权限（核心）

### 为什么Git权限最重要

**GitOps架构**下，修改部署配置的正确方式是：
```
修改Git配置仓库 → ArgoCD自动发现变更 → 自动同步部署
```

而不是：
```
❌ 直接调用ArgoCD API修改Application配置
```

### 需要的Git权限

| 环境 | 权限策略 | 理由 |
|------|----------|------|
| dev | 机器人账号直接提交到main分支 | 快速迭代，风险可控 |
| staging | 创建MR/PR，允许自动合并（可选） | 保留审计记录 |
| prod | 只创建MR/PR，必须人工审核 | 严格控制生产变更 |

### 需要准备的配置

```yaml
# config/git.yaml
git:
  bot_username: "fde-bot"
  bot_email: "fde-bot@company.com"
  
  # 方式1：SSH Key（推荐）
  ssh_key_path: "/secrets/git-ssh-key"
  
  # 方式2：Personal Access Token
  # token: "${GIT_TOKEN}"
  
  repos:
    - name: "k8s-configs"
      url: "git@gitlab.com:company/k8s-configs.git"
      branch_strategy:
        dev: "direct_commit"      # 直接提交
        staging: "create_mr"      # 创建MR
        prod: "create_mr_no_auto" # 创建MR，不自动合并
```

### Git操作映射

**应用名 → 配置文件路径**：
```yaml
# config/app-mappings.yaml
applications:
  - name: "my-app"
    git_repo: "k8s-configs"
    environments:
      - name: dev
        config_path: "apps/my-app/overlays/dev/kustomization.yaml"
        image_field: "images[0].newTag"
      - name: staging
        config_path: "apps/my-app/overlays/staging/kustomization.yaml"
      - name: prod
        config_path: "apps/my-app/overlays/prod/kustomization.yaml"
```

### Git提交规范

```bash
# 提交信息格式
feat(my-app): update image to v1.2.3

- Image: registry.com/my-app:v1.2.3
- Commit: abc123def456
- Author: developer@company.com
- Deploy ID: 550e8400-e29b-41d4-a716-446655440000
- Triggered by: FDE Workstation Pipeline Agent
```

---

## 二、ArgoCD权限（最小化）

### ArgoCD权限分级

| 操作 | dev | staging | prod | 说明 |
|------|-----|---------|------|------|
| 读取Application状态 | ✅ | ✅ | ✅ | 查询同步状态、健康状态 |
| 主动触发同步 | ✅ | ⚠️ 可选 | ❌ | dev可以，prod禁止 |
| 回滚到历史版本 | ✅ | ❌ | ❌ | 只允许dev环境 |
| 修改Application配置 | ❌ | ❌ | ❌ | 所有环境禁止 |
| 删除Application | ❌ | ❌ | ❌ | 所有环境禁止 |

### ArgoCD RBAC配置

**创建专用账号**：
```bash
# 在ArgoCD ConfigMap中添加本地账号
argocd account create fde-pipeline \
  --account-description "FDE Workstation Pipeline Agent"
```

**RBAC Policy（argocd-rbac-cm）**：
```yaml
policy.csv: |
  # FDE Pipeline Agent权限
  p, role:fde-pipeline, applications, get, dev/*, allow
  p, role:fde-pipeline, applications, sync, dev/*, allow
  p, role:fde-pipeline, applications, get, staging/*, allow
  p, role:fde-pipeline, applications, get, prod/*, allow
  
  # 绑定账号到角色
  g, fde-pipeline, role:fde-pipeline
  
policy.default: role:readonly
```

### ArgoCD Token管理

```bash
# 生成Token（设置过期时间）
argocd account generate-token \
  --account fde-pipeline \
  --expires-in 90d

# 存储到K8s Secret
kubectl create secret generic argocd-token \
  --from-literal=token=<token> \
  -n fde-workstation
```

### M1只需要的ArgoCD API

```python
# integrations/argocd.py
class ArgoCDClient:
    """最小化ArgoCD客户端（M1版本）"""
    
    async def get_application_status(self, app_name: str) -> dict:
        """获取Application状态（只读）"""
        response = await self.client.get(
            f"{self.server_url}/api/v1/applications/{app_name}",
            headers=self.headers
        )
        return response.json()
    
    async def trigger_sync(self, app_name: str, prune: bool = False):
        """触发同步（仅dev环境）"""
        if not self.is_dev_environment(app_name):
            raise PermissionError("只允许dev环境主动同步")
        
        response = await self.client.post(
            f"{self.server_url}/api/v1/applications/{app_name}/sync",
            headers=self.headers,
            json={"prune": prune, "dryRun": False}
        )
        return response.json()
```

**关键点**：M1不需要ArgoCD Image Updater的修改权限，因为我们通过Git修改配置。

---

## 三、Kubernetes权限（只读+日志）

### 需要的K8s权限

```yaml
# deploy/k8s/rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fde-diagnosis
  namespace: fde-workstation
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: fde-diagnosis-reader
  namespace: dev  # 每个环境一个Role
rules:
  # 读取Pod和日志
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  
  # 读取Events
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list", "watch"]
  
  # 读取Deployment/ReplicaSet
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
  
  # 读取Service（可选）
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: fde-diagnosis-binding
  namespace: dev
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: fde-diagnosis-reader
subjects:
  - kind: ServiceAccount
    name: fde-diagnosis
    namespace: fde-workstation
```

### K8s客户端配置

```python
# integrations/kubernetes.py
from kubernetes import client, config

class KubernetesClient:
    """最小权限K8s客户端"""
    
    def __init__(self):
        # 集群内部署时使用ServiceAccount
        config.load_incluster_config()
        self.core_v1 = client.CoreV1Api()
        self.apps_v1 = client.AppsV1Api()
    
    async def get_pod_logs(
        self, 
        namespace: str, 
        pod_name: str, 
        container: str = None,
        tail_lines: int = 500
    ) -> str:
        """读取Pod日志（限制行数）"""
        return self.core_v1.read_namespaced_pod_log(
            name=pod_name,
            namespace=namespace,
            container=container,
            tail_lines=tail_lines,
            timestamps=True
        )
```

### ⚠️ M1绝对不给的权限

```yaml
# ❌ 不要给这些权限
- pods: delete, update, patch, create
- deployments: update, patch, delete
- secrets: get, list
- configmaps: update, delete
- 任何写操作
- cluster-admin
```

---

## 四、Tekton事件权限

### 方式1：Webhook回调（推荐）

**Tekton Trigger配置**：
```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata:
  name: fde-pipeline-listener
spec:
  serviceAccountName: tekton-triggers
  triggers:
    - name: build-complete
      interceptors:
        - ref:
            name: cel
          params:
            - name: filter
              value: >
                body.status == 'Succeeded'
      bindings:
        - name: app-name
          value: $(body.metadata.labels.app)
        - name: image
          value: $(body.status.results.image)
        - name: tag
          value: $(body.status.results.tag)
      template:
        spec:
          params:
            - name: webhook-url
              value: "http://fde-api:8000/api/v1/webhooks/tekton"
```

**需要准备**：
- Webhook URL（集群内部地址）
- Webhook Secret（验证签名）
- 事件payload格式

### 方式2：Watch PipelineRun（备选）

需要额外权限：
```yaml
- apiGroups: ["tekton.dev"]
  resources: ["pipelineruns"]
  verbs: ["get", "list", "watch"]
```

**M1推荐方式1**，因为权限更小，实现更简单。

---

## 五、飞书权限与安全

### 飞书应用配置

```yaml
# config/feishu.yaml
feishu:
  app_id: "cli_xxx"
  app_secret: "${FEISHU_APP_SECRET}"
  
  # Webhook签名验证
  webhook_verify_token: "${FEISHU_VERIFY_TOKEN}"
  webhook_encrypt_key: "${FEISHU_ENCRYPT_KEY}"
  
  # 通知映射
  notifications:
    my-app:
      dev: "ou_xxx"    # 开发者飞书ID
      staging: "ou_yyy"
      prod: "chat_zzz" # 生产群ID
```

### 飞书回调权限校验

```python
# api/routers/webhooks.py
import hmac
import hashlib

def verify_feishu_signature(
    timestamp: str, 
    nonce: str, 
    body: str, 
    signature: str
) -> bool:
    """验证飞书签名"""
    token = config.FEISHU_VERIFY_TOKEN
    sign_str = f"{timestamp}{nonce}{token}{body}"
    expected = hmac.new(
        token.encode(),
        sign_str.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

@router.post("/feishu/callback")
async def handle_feishu_callback(request: Request):
    # 1. 验证签名
    if not verify_feishu_signature(...):
        raise HTTPException(403, "Invalid signature")
    
    # 2. 验证操作者权限
    user_id = data["open_id"]
    action = data["action"]["value"]["action"]
    deploy_id = data["action"]["value"]["deploy_id"]
    
    deployment = await db.get_deployment(deploy_id)
    
    # 3. 权限检查
    if action == "request_rollback":
        if deployment.environment == "prod":
            if not await has_prod_rollback_permission(user_id):
                return {"msg": "无权限操作生产环境"}
    
    # 4. 执行操作
    # ...
```

### M1飞书功能范围

| 功能 | M1 | M2 | 说明 |
|------|----|----|------|
| 发送通知 | ✅ | ✅ | 基础功能 |
| 交互卡片 | ✅ | ✅ | 查看日志、申请回滚 |
| 按钮权限校验 | ✅ | ✅ | 必须做 |
| 审批流程 | ❌ | ✅ | M2再做 |
| 群聊机器人 | ✅ | ✅ | M1先做 |
| 私聊通知 | ❌ | ✅ | M2再做 |

---

## 六、LLM权限与脱敏

### LLM配置

```yaml
# config/llm.yaml
llm:
  provider: "${LLM_PROVIDER}"
  model: "${LLM_MODEL}"
  api_key: "${LLM_API_KEY}"
  api_base_url: "${LLM_API_BASE_URL}"
  
  # 调用控制
  timeout: 10  # 秒
  max_tokens: 2000
  temperature: 0.7
  max_retries: 2
  
  # 成本控制
  enabled: true
  cost_limit_per_day: 100  # USD
  
  # 脱敏规则
  redact_patterns:
    - "Authorization: Bearer [\\w-]+"
    - "token=[\\w-]+"
    - "password=\\S+"
    - "SECRET_KEY=\\S+"
    - "\\d{11}"  # 手机号
    - "[\\w.-]+@[\\w.-]+\\.\\w+"  # 邮箱
```

### 日志脱敏实现

```python
# engines/log_redactor.py
import re

class LogRedactor:
    """日志脱敏器"""
    
    PATTERNS = [
        (r'Authorization:\s*Bearer\s+[\w-]+', 'Authorization: Bearer [REDACTED]'),
        (r'token["\']?\s*[:=]\s*["\']?[\w-]+', 'token=[REDACTED]'),
        (r'password["\']?\s*[:=]\s*["\']?\S+', 'password=[REDACTED]'),
        (r'SECRET_KEY\s*=\s*\S+', 'SECRET_KEY=[REDACTED]'),
        (r'\d{11}', '[PHONE_REDACTED]'),
        (r'[\w.-]+@[\w.-]+\.\w+', '[EMAIL_REDACTED]'),
        # 数据库连接串
        (r'postgres://[^@]+@', 'postgres://[REDACTED]@'),
        (r'mysql://[^@]+@', 'mysql://[REDACTED]@'),
    ]
    
    def redact(self, text: str) -> str:
        """脱敏处理"""
        for pattern, replacement in self.PATTERNS:
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        return text
```

### LLM调用流程

```python
# engines/llm_client.py
async def diagnose(self, logs: str, events: List[dict]) -> dict:
    # 1. 脱敏
    redacted_logs = self.redactor.redact(logs)
    
    # 2. 限制长度
    if len(redacted_logs) > 10000:
        redacted_logs = redacted_logs[:10000] + "\n... (truncated)"
    
    # 3. 调用LLM
    response = await self.client.complete(
        prompt=self.build_prompt(redacted_logs, events),
        timeout=self.timeout
    )
    
    # 4. 记录成本
    await self.log_usage(response.usage)
    
    return response
```

---

## 七、配置映射（核心）

### 应用配置映射表

```yaml
# config/app-mappings.yaml
applications:
  - name: "my-app"
    # Git配置
    git_repo: "k8s-configs"
    git_config_paths:
      dev: "apps/my-app/overlays/dev/kustomization.yaml"
      staging: "apps/my-app/overlays/staging/kustomization.yaml"
      prod: "apps/my-app/overlays/prod/kustomization.yaml"
    
    # ArgoCD配置
    argocd_applications:
      dev: "my-app-dev"
      staging: "my-app-staging"
      prod: "my-app-prod"
    
    # K8s配置
    kubernetes:
      dev:
        namespace: "dev"
        labels: {"app": "my-app"}
      staging:
        namespace: "staging"
        labels: {"app": "my-app"}
      prod:
        namespace: "production"
        labels: {"app": "my-app"}
    
    # 飞书通知
    feishu:
      dev: "ou_dev_user_id"
      staging: "ou_staging_user_id"
      prod: "chat_prod_group_id"
    
    # 环境策略
    policies:
      dev:
        auto_commit: true
        auto_sync: true
        auto_rollback: true
      staging:
        auto_commit: false  # 创建MR
        auto_sync: false
        auto_rollback: false
      prod:
        auto_commit: false
        auto_sync: false
        auto_rollback: false
        require_approval: true
```

### 加载配置映射

```python
# shared/config_loader.py
class AppConfigLoader:
    """应用配置加载器"""
    
    def get_git_config_path(self, app_name: str, environment: str) -> str:
        """获取Git配置文件路径"""
        app_config = self.mappings["applications"].get(app_name)
        if not app_config:
            raise ValueError(f"未找到应用配置: {app_name}")
        
        return app_config["git_config_paths"][environment]
    
    def get_policy(self, app_name: str, environment: str) -> dict:
        """获取环境策略"""
        app_config = self.mappings["applications"].get(app_name)
        return app_config["policies"][environment]
```

---

## 八、凭证管理

### K8s Secret存储

```bash
# 创建凭证Secret
kubectl create secret generic fde-credentials \
  --from-literal=git-ssh-key="$(cat ~/.ssh/id_rsa)" \
  --from-file=argocd-token=argocd-token.txt \
  --from-literal=anthropic-api-key="sk-xxx" \
  --from-literal=feishu-app-secret="xxx" \
  -n fde-workstation
```

### Pod挂载Secret

```yaml
# deploy/k8s/deployment.yaml
spec:
  containers:
  - name: api
    env:
      - name: ARGOCD_TOKEN
        valueFrom:
          secretKeyRef:
            name: fde-credentials
            key: argocd-token
      - name: ANTHROPIC_API_KEY
        valueFrom:
          secretKeyRef:
            name: fde-credentials
            key: anthropic-api-key
    volumeMounts:
      - name: git-ssh-key
        mountPath: /secrets
        readOnly: true
  volumes:
    - name: git-ssh-key
      secret:
        secretName: fde-credentials
        items:
          - key: git-ssh-key
            path: git-ssh-key
            mode: 0400
```

---

## 九、M1最小可实施清单

### 必须准备的凭证

- [ ] **Git机器人账号**：能修改dev环境配置仓库，staging/prod创建MR
- [ ] **ArgoCD低权限Token**：只能读取Application状态，dev能触发同步
- [ ] **K8s ServiceAccount**：只能读取Pod/日志/Events/Deployment
- [ ] **Tekton Webhook Secret**：验证Tekton回调签名
- [ ] **飞书App ID + Secret**：发送消息，接收回调
- [ ] **LLM API Key**：按实际Provider配置，不固定模型名
- [ ] **PostgreSQL凭证**：数据库连接

### 必须配置的映射

- [ ] **应用到Git路径映射**：`app_name + environment → config_file_path`
- [ ] **应用到ArgoCD映射**：`app_name + environment → argocd_application`
- [ ] **应用到K8s映射**：`app_name + environment → namespace + labels`
- [ ] **应用到飞书映射**：`app_name + environment → user_id / chat_id`
- [ ] **环境策略配置**：`environment → auto_commit / auto_sync / require_approval`

### 必须实现的权限校验

- [ ] **飞书回调签名验证**
- [ ] **飞书操作者权限校验**（prod回滚需要特定权限）
- [ ] **LLM日志脱敏**（至少10种常见敏感信息）
- [ ] **ArgoCD权限边界**（dev能同步，prod只读）
- [ ] **Git提交审计**（记录操作者、Deploy ID）

---

## 十、Week 1实施检查清单

**Day 1完成后必须确认**：
- [ ] Git机器人账号已创建，SSH Key已配置
- [ ] dev环境Git仓库写权限已授予
- [ ] K8s ServiceAccount已创建，Role已绑定
- [ ] ArgoCD Token已生成，权限已限制
- [ ] 所有凭证已存储到K8s Secret

**Day 2完成后必须确认**：
- [ ] 关键事件以PostgreSQL events表作为可靠事件源
- [ ] Redis Pub/Sub只作为可选worker唤醒机制
- [ ] Worker具备pending events补偿扫描能力
- [ ] 幂等性逻辑已实现

**Day 3完成后必须确认**：
- [ ] Pipeline Orchestrator只修改Git，不直接操作ArgoCD Application配置
- [ ] 部署记录包含完整审计信息（operator、commit、timestamp）

**Day 4-5完成后必须确认**：
- [ ] ArgoCD客户端只调用get和sync API
- [ ] staging/prod环境不会自动同步
- [ ] Git提交信息包含Deploy ID，可追溯

---

## 总结

### ✅ M1必须做对的权限设计

1. **GitOps优先**：修改Git让ArgoCD自动同步
2. **按环境分级**：dev自动化，prod严格控制
3. **最小权限**：绝不用admin token
4. **LLM脱敏**：日志进LLM前必须脱敏
5. **审计可追溯**：所有操作记录到数据库

### ❌ M1绝对不能做的

1. ❌ 使用ArgoCD admin token
2. ❌ 使用K8s cluster-admin
3. ❌ 所有环境共用一个token
4. ❌ 飞书按钮直接操作生产回滚
5. ❌ 完整日志原文发给LLM
6. ❌ 凭证写在配置文件或镜像中
7. ❌ 直接修改ArgoCD Application配置

---

**这份文档必须在Week 1 Day 1开始前完成准备和确认。**
