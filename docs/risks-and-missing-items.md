# M1风险与遗漏清单

**版本**：v1.0  
**日期**：2026-06-16  
**状态**：Week 1必须补齐前3项

---

## 文档角色

本文是 M1 风险和遗漏项约束文档。文档分类和阅读顺序见 [`docs/document-index.md`](document-index.md)，M1 架构决策以 [`docs/m1-architecture-decisions.md`](m1-architecture-decisions.md) 为最高优先级。

---

## 核心判断

当前设计已覆盖：
- ✅ YAML/Helm/Kustomize适配
- ✅ 前端开关 + Schema驱动
- ✅ 后端受控变更
- ✅ GitOps + ArgoCD同步

**但还缺22类关键问题，其中3个必须立即补齐。**

---

## 🔴 P0：必须立即补齐（Week 1）

### 1. 渲染校验没有纳入主链路

**问题**：只修改YAML不够，必须确认修改后的配置能被实际渲染和同步。

**不同配置类型的校验**：

| 配置类型 | 必须校验 |
|----------|----------|
| Raw Kubernetes | YAML可解析、K8s schema合法、kind/name/namespace正确 |
| Helm | values.yaml可解析、`helm template`可渲染、chart dependency可用 |
| Kustomize | kustomization.yaml可解析、`kustomize build`可渲染、patch/component/images生效 |

**实现方案**：
```python
# engines/yaml_validator.py
class YamlValidator:
    """YAML渲染校验器"""
    
    async def validate_raw_kubernetes(self, yaml_file: str) -> ValidationResult:
        """校验原生Kubernetes YAML"""
        # 1. YAML可解析
        try:
            docs = yaml.safe_load_all(open(yaml_file))
        except yaml.YAMLError as e:
            return ValidationResult(valid=False, error=f"YAML解析失败: {e}")
        
        # 2. Kubernetes schema合法
        for doc in docs:
            if not self.validate_k8s_schema(doc):
                return ValidationResult(
                    valid=False, 
                    error=f"资源 {doc['kind']}/{doc['metadata']['name']} schema不合法"
                )
        
        # 3. 目标资源正确
        if not self.validate_resource_target(docs, expected_kind, expected_name):
            return ValidationResult(valid=False, error="目标资源不匹配")
        
        return ValidationResult(valid=True)
    
    async def validate_helm(self, values_file: str, chart_path: str) -> ValidationResult:
        """校验Helm配置"""
        # 1. values.yaml可解析
        try:
            values = yaml.safe_load(open(values_file))
        except yaml.YAMLError as e:
            return ValidationResult(valid=False, error=f"values.yaml解析失败: {e}")
        
        # 2. helm template可渲染
        result = await self.run_command(
            f"helm template {chart_path} -f {values_file} --dry-run"
        )
        if result.returncode != 0:
            return ValidationResult(
                valid=False, 
                error=f"Helm渲染失败: {result.stderr}"
            )
        
        # 3. 渲染结果合法
        rendered = yaml.safe_load_all(result.stdout)
        for doc in rendered:
            if not self.validate_k8s_schema(doc):
                return ValidationResult(valid=False, error="渲染结果schema不合法")
        
        return ValidationResult(valid=True)
    
    async def validate_kustomize(self, kustomization_dir: str) -> ValidationResult:
        """校验Kustomize配置"""
        # 1. kustomization.yaml可解析
        kustomization_file = os.path.join(kustomization_dir, 'kustomization.yaml')
        try:
            kustomization = yaml.safe_load(open(kustomization_file))
        except yaml.YAMLError as e:
            return ValidationResult(valid=False, error=f"kustomization.yaml解析失败: {e}")
        
        # 2. kustomize build可渲染
        result = await self.run_command(
            f"kustomize build {kustomization_dir}"
        )
        if result.returncode != 0:
            return ValidationResult(
                valid=False, 
                error=f"Kustomize渲染失败: {result.stderr}"
            )
        
        # 3. patch/component/images生效
        rendered = yaml.safe_load_all(result.stdout)
        for doc in rendered:
            if not self.validate_k8s_schema(doc):
                return ValidationResult(valid=False, error="渲染结果schema不合法")
        
        return ValidationResult(valid=True)
```

**集成到变更流程**：
```python
# engines/yaml_engine.py
async def apply_changes(self, request: YamlChangeRequest):
    # ... 修改YAML
    
    # ⭐ 渲染校验
    validation_result = await self.validator.validate(
        config_type=app_config.configType,
        file_path=yaml_file,
        chart_path=app_config.get('chartPath'),
        kustomization_dir=app_config.get('kustomizationDir')
    )
    
    if not validation_result.valid:
        raise ValidationError(f"渲染校验失败: {validation_result.error}")
    
    # ... 提交Git
```

**M1实施**：
- Week 1 Day 3: 实现RawKubernetes渲染校验
- Week 2: 实现Helm和Kustomize渲染校验（如果需要）

---

### 2. 并发写Git仓库的问题

**问题**：两个Tekton构建同时成功，同时修改同一个YAML，可能导致：
- 后提交覆盖先提交
- Git rebase冲突
- ArgoCD同步到非预期版本
- 部署状态和构建记录对不上

**解决方案**：应用+环境维度串行队列

```python
# shared/lock_manager.py
import asyncio
import time
import uuid
from contextlib import asynccontextmanager
import redis.asyncio as redis

class DeploymentLockManager:
    """部署锁管理器"""
    
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.lock_timeout = 300  # 5分钟超时
    
    async def acquire_lock(self, app_name: str, environment: str) -> str | None:
        """获取部署锁"""
        lock_key = f"deploy_lock:{app_name}:{environment}"
        owner_token = str(uuid.uuid4())
        
        acquired = await self.redis.set(
            lock_key, 
            owner_token,
            nx=True,
            ex=self.lock_timeout
        )
        
        return owner_token if acquired else None
    
    async def release_lock(self, app_name: str, environment: str, owner_token: str):
        """只允许锁持有者释放锁"""
        lock_key = f"deploy_lock:{app_name}:{environment}"
        script = """
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        end
        return 0
        """
        await self.redis.eval(script, 1, lock_key, owner_token)
    
    async def wait_for_lock(self, app_name: str, environment: str, timeout: int = 600) -> str:
        """等待获取锁"""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            owner_token = await self.acquire_lock(app_name, environment)
            if owner_token:
                return owner_token
            await asyncio.sleep(1)
        
        raise TimeoutError(f"等待部署锁超时: {app_name}/{environment}")

    @asynccontextmanager
    async def locked(self, app_name: str, environment: str, timeout: int = 600):
        """部署锁上下文，保证获取者释放"""
        owner_token = await self.wait_for_lock(app_name, environment, timeout)
        try:
            yield
        finally:
            await self.release_lock(app_name, environment, owner_token)
```

**集成到Pipeline Orchestrator**：
```python
# orchestrators/pipeline.py
async def handle_build_complete(payload: dict):
    app_name = payload["application"]
    environment = payload["environment"]
    
    lock_manager = DeploymentLockManager(redis_client)
    
    async with lock_manager.locked(app_name, environment):
        # 执行部署变更
        await perform_deployment(payload)
```

**额外保护**：Git工作区隔离
```python
# integrations/git_client.py
async def commit_and_push(self, message: str, files: List[str]):
    # 1. 提交前重新拉取最新分支
    await self.run_command("git pull --rebase origin main")
    
    # 2. 检查冲突
    if self.has_conflicts():
        raise ConflictError("Git rebase冲突，请手动解决")
    
    # 3. 提交
    await self.run_command(f"git add {' '.join(files)}")
    await self.run_command(f"git commit -m '{message}'")
    
    # 4. 推送（带重试）
    for attempt in range(3):
        try:
            await self.run_command("git push origin main")
            return
        except GitError:
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)  # 指数退避
                await self.run_command("git pull --rebase origin main")
            else:
                raise
```

**M1实施**：
- Week 1 Day 3: 实现Redis锁管理器
- Week 1 Day 3: 集成到Pipeline Orchestrator

---

### 3. 回滚模型还没有定义清楚

**问题**：回滚不是简单把tag改回去。

**三种回滚方式对比**：

| 回滚方式 | 优点 | 缺点 | M1推荐 |
|----------|------|------|--------|
| Git revert | 符合GitOps、审计清楚 | 需要revert commit | ✅ **推荐** |
| ArgoCD回滚 | 快速 | 可能与Git状态不一致、容易drift | ❌ 不推荐 |
| Kubernetes直接回滚 | 最快 | 绕过Git、与GitOps冲突 | ❌ 禁止 |

**推荐方案：回滚也通过Git提交完成**

```python
# services/rollback_service.py
class RollbackService:
    """回滚服务"""
    
    async def rollback_deployment(self, deploy_id: str, reason: str) -> RollbackResult:
        """回滚部署（通过Git revert）"""
        # 1. 获取部署记录
        deployment = await db.get_deployment(deploy_id)
        
        # 2. 找到上一次成功的部署
        previous_deployment = await db.get_previous_successful_deployment(
            app_name=deployment.app_name,
            environment=deployment.environment,
            before=deployment.started_at
        )
        
        if not previous_deployment:
            raise RollbackError("没有可回滚的历史版本")
        
        # 3. 创建回滚变更请求
        rollback_request = YamlChangeRequest(
            application=deployment.app_name,
            environment=deployment.environment,
            source=Source(
                type="rollback",
                rollback_from=deploy_id,
                rollback_to=str(previous_deployment.id),
                reason=reason
            ),
            changes=[
                Change(
                    action="update_image",
                    target=Target(
                        resource_kind="Deployment",
                        resource_name=deployment.app_name
                    ),
                    value={"image": previous_deployment.image}
                )
            ]
        )
        
        # 4. 执行回滚（走正常变更流程）
        result = await yaml_engine.apply_changes(rollback_request)
        
        # 5. 记录回滚
        rollback_record = RollbackRecord(
            from_deploy_id=deploy_id,
            to_deploy_id=previous_deployment.id,
            reason=reason,
            git_commit=result.commit_sha,
            created_at=datetime.utcnow()
        )
        await db.save_rollback_record(rollback_record)
        
        return RollbackResult(
            success=True,
            rollback_to=previous_deployment.image,
            git_commit=result.commit_sha
        )
```

**飞书回滚申请流程**：
```python
# api/routers/webhooks.py
@router.post("/feishu/callback")
async def handle_feishu_callback(request: Request):
    action = data["action"]["value"]["action"]
    deploy_id = data["action"]["value"]["deploy_id"]
    user_id = data["open_id"]
    
    if action == "request_rollback":
        deployment = await db.get_deployment(deploy_id)
        
        # ⭐ dev环境：直接回滚
        if deployment.environment == "dev":
            result = await rollback_service.rollback_deployment(
                deploy_id=deploy_id,
                reason=f"飞书回滚申请 by {user_id}"
            )
            return {"msg": f"已回滚到 {result.rollback_to}"}
        
        # ⭐ staging/prod环境：创建MR
        else:
            mr_url = await gitlab_service.create_rollback_mr(
                deploy_id=deploy_id,
                requester=user_id,
                reason="飞书回滚申请"
            )
            return {"msg": f"回滚MR已创建，等待审批：{mr_url}"}
```

**M1实施**：
- Week 2: 实现RollbackService（通过Git）
- Week 2: 集成到飞书回调
- Week 3: 测试回滚流程

---

## 🟡 P1：M1必须考虑（Week 2）

### 4. 事件幂等和重放保护

**问题**：Tekton事件、Webhook、飞书回调可能重复发送。

**幂等策略**：
```python
# models/idempotency.py
class IdempotencyKey:
    """幂等键"""
    
    @staticmethod
    def generate(
        application: str,
        environment: str,
        pipeline_run_id: str,
        image_ref: str
    ) -> str:
        """生成幂等键"""
        return f"{application}:{environment}:{pipeline_run_id}:{image_ref}"
    
    @staticmethod
    async def check_and_record(redis_client: redis.Redis, key: str) -> bool:
        """检查并记录幂等键"""
        # 尝试设置键，24小时过期
        recorded = await redis_client.set(
            f"idempotency:{key}",
            "processed",
            nx=True,
            ex=86400
        )
        return recorded is not None

# orchestrators/pipeline.py
async def handle_build_complete(payload: dict):
    # ⭐ 幂等检查
    idempotency_key = IdempotencyKey.generate(
        application=payload["application"],
        environment=payload["environment"],
        pipeline_run_id=payload["pipeline_run"],
        image_ref=payload["image"]
    )
    
    if not await IdempotencyKey.check_and_record(redis_client, idempotency_key):
        logger.info(
            "duplicate_event_ignored",
            idempotency_key=idempotency_key
        )
        return  # 重复事件，忽略
    
    # 继续处理
    await perform_deployment(payload)
```

**事件签名校验**：
```python
# api/routers/webhooks.py
import hmac
import hashlib

def verify_tekton_signature(payload: bytes, signature: str, secret: str) -> bool:
    """校验Tekton签名"""
    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

@router.post("/webhooks/tekton")
async def handle_tekton_webhook(request: Request):
    # ⭐ 签名校验
    signature = request.headers.get("X-Tekton-Signature")
    payload = await request.body()
    
    if not verify_tekton_signature(payload, signature, config.TEKTON_WEBHOOK_SECRET):
        raise HTTPException(403, "Invalid signature")
    
    # ⭐ 时间戳校验
    data = json.loads(payload)
    event_time = datetime.fromisoformat(data["timestamp"])
    if datetime.utcnow() - event_time > timedelta(minutes=5):
        raise HTTPException(400, "Event expired")
    
    # 处理事件
    await handle_build_complete(data)
```

---

### 5. GitOps漂移检测

**问题**：不能只看Git提交成功，也不能只看ArgoCD sync调用成功。

**完整状态检查**：
```python
# services/sync_verifier.py
class SyncVerifier:
    """同步验证器"""
    
    async def verify_deployment_success(
        self, 
        deploy_id: str,
        timeout: int = 300
    ) -> VerificationResult:
        """验证部署成功"""
        deployment = await db.get_deployment(deploy_id)
        
        checks = []
        
        # 1. Git已更新
        git_check = await self.verify_git_updated(deployment.git_commit)
        checks.append(("Git已更新", git_check))
        
        # 2. ArgoCD已同步
        argocd_check = await self.verify_argocd_synced(deployment.argocd_app)
        checks.append(("ArgoCD已同步", argocd_check))
        
        # 3. ArgoCD health是Healthy
        health_check = await self.verify_argocd_healthy(deployment.argocd_app)
        checks.append(("ArgoCD Healthy", health_check))
        
        # 4. Kubernetes rollout成功
        rollout_check = await self.verify_k8s_rollout(
            deployment.namespace,
            deployment.app_name
        )
        checks.append(("Kubernetes Rollout", rollout_check))
        
        # 5. Pod运行正常
        pod_check = await self.verify_pods_running(
            deployment.namespace,
            deployment.app_name
        )
        checks.append(("Pod运行正常", pod_check))
        
        all_passed = all(check[1] for check in checks)
        
        return VerificationResult(
            success=all_passed,
            checks=checks
        )
```

---

### 6. Secret不直接管理明文

**M1策略**：只允许引用已有Secret，不提供Secret创建和明文编辑。

**配置Schema限制**：
```yaml
# config/schemas/demo-app.yaml
capabilities:
  - name: set_env
    label: "环境变量"
    control: key-value-table
    sensitive: false  # 不允许输入敏感信息
    
  - name: set_secret_ref
    label: "Secret引用"
    control: select
    options:
      - label: "database-credentials"
        value: "database-credentials"
      - label: "api-keys"
        value: "api-keys"
    description: "选择已有的Secret"
```

**后端校验**：
```python
def validate_env_value(value: str):
    """校验环境变量值不能包含敏感信息"""
    sensitive_patterns = [
        r'password["\']?\s*[:=]\s*["\']?\S+',
        r'token["\']?\s*[:=]\s*["\']?\S+',
        r'secret["\']?\s*[:=]\s*["\']?\S+',
        r'key["\']?\s*[:=]\s*["\']?\S+',
    ]
    
    for pattern in sensitive_patterns:
        if re.search(pattern, value, re.IGNORECASE):
            raise ValidationError("环境变量值疑似包含敏感信息，请使用Secret引用")
```

---

### 7. Diff展示和审计记录

**Diff生成**：
```python
# engines/diff_generator.py
class DiffGenerator:
    """变更Diff生成器"""
    
    def generate_diff(self, old_content: str, new_content: str) -> Diff:
        """生成结构化Diff"""
        import difflib
        
        old_lines = old_content.splitlines()
        new_lines = new_content.splitlines()
        
        diff_lines = list(difflib.unified_diff(
            old_lines,
            new_lines,
            lineterm=''
        ))
        
        return Diff(
            old_content=old_content,
            new_content=new_content,
            diff_lines=diff_lines,
            changed_fields=self.extract_changed_fields(old_content, new_content)
        )
```

**审计日志完整字段**：
```python
# models/audit.py
class AuditLog:
    """审计日志"""
    
    id: UUID
    operator: str  # 操作者
    source: str  # tekton/manual/scheduled
    application: str
    environment: str
    operation: str  # update_image/add_env/set_replicas
    old_value: dict  # 旧值摘要
    new_value: dict  # 新值摘要
    git_commit: str
    pipeline_run: str
    argocd_app: str
    approver: str  # 审批人（如果需要）
    result: str  # success/failed
    error_message: str
    created_at: datetime
```

---

### 8. CI循环防护

**方案1：机器人提交跳过CI**
```python
# integrations/git_client.py
async def commit_and_push(self, message: str, files: List[str]):
    # ⭐ 提交信息包含[skip ci]
    full_message = f"{message}\n\n[skip ci]"
    
    await self.run_command(f"git commit -m '{full_message}'")
    await self.run_command("git push origin main")
```

**方案2：配置仓库和代码仓库分离**
```yaml
# 推荐结构
代码仓库: gitlab.com/app/demo-app
  -> 触发Tekton构建

配置仓库: gitlab.com/ops/demo-gitops
  -> 不触发Tekton
  -> 只触发ArgoCD同步
```

---

## 🟢 P2：M1可以延后（M2）

### 9-22. 其他遗漏点

详见完整清单（略），包括：
- Helm values schema差异
- Kustomize patch文件管理
- ArgoCD Application结构
- 自动同步和手动同步策略
- 变更审批模型
- 配置漂移与手工修改冲突
- 状态机设计
- 通知策略
- 权限模型
- 镜像tag策略
- 供应链检查
- 多环境配置晋级
- 应用映射生命周期

**这些在M2再补齐。**

---

## M1实施优先级

### Week 1 Day 3（必须）
- [ ] 渲染校验（RawKubernetes）
- [ ] 并发控制（Redis锁）
- [ ] Git工作区隔离

### Week 2（必须）
- [ ] 事件幂等
- [ ] 回滚模型（Git revert）
- [ ] GitOps漂移检测
- [ ] Diff展示
- [ ] 审计日志

### Week 3（必须）
- [ ] Secret引用校验
- [ ] CI循环防护
- [ ] 完整端到端测试

---

## 总结

### M1必须补的3个

1. **渲染校验** - 确保修改后配置可用
2. **并发控制** - 避免同时修改同一YAML
3. **Git回滚** - 回滚也走GitOps

**这三个不补，进入真实频繁发布会出现状态错乱、误覆盖和不可追溯问题。**

### M1可以延后的

- 完整Helm schema识别
- 复杂Kustomize component
- 多服务依赖编排
- prod审批流
- 镜像签名和SBOM
- 多租户权限

**M1边界：只支持少量高频、安全、可审计的操作。**
