# YAML变更引擎设计（M1核心模块）

**版本**：v1.0  
**日期**：2026-06-16  
**状态**：Week 1必须实现

---

## 一、核心问题

### 问题1：能否直接同步？

**答案：可以**，但需要满足条件：
1. Tekton Pipeline已成功结束
2. 生成的镜像标识明确（如`registry.com/app:20260616-abc123`）
3. 镜像已推送到仓库，ArgoCD集群可拉取
4. YAML替换的是ArgoCD监听的Git仓库和分支
5. 配置变更已提交到Git
6. ArgoCD有权限读取该仓库

### 问题2：需要区分微服务和单体应用吗？

**答案：需要**，但差异在**映射关系**，不在**变更引擎**：

| 类型 | 复杂度 | 映射关系 |
|------|--------|----------|
| 单体应用 | 简单 | 1个GitLab项目 → 1个镜像 → 1个YAML → 1个ArgoCD App |
| 微服务 | 复杂 | 1个系统 → N个服务 → N个镜像 → N个YAML → 1或N个ArgoCD App |

**M1策略**：先支持单体应用，设计上预留微服务扩展能力。

### 问题3：如何做成通用的YAML变更引擎？

**答案：不要做"字符串替换"，要做"结构化变更引擎"**：
```
输入不是：把字符串A替换成B
输入是：对哪个应用、哪个环境、哪个资源、哪个字段执行 set/add/remove 操作
```

---

## 二、架构设计

### 2.1 核心模型

**通用性 = 资源定位 + 操作类型 + 校验规则 + 渲染验证**

```python
# 变更请求结构
class YamlChangeRequest:
    change_id: str
    application: str         # demo-app
    environment: str         # dev
    source: Source          # Tekton PipelineRun信息
    changes: List[Change]   # 变更列表
    
class Change:
    action: str             # set/add/remove/create/delete
    target: Target          # 资源定位
    value: Any             # 新值
    policy: Policy         # 约束策略

class Target:
    resource_kind: str      # Deployment
    resource_name: str      # demo-app
    path: str              # spec.template.spec.containers[name=demo-app].image
```

### 2.2 双层架构

```
┌─────────────────────────────────────────┐
│         业务动作层（高层）                 │
│  update_image / add_env / set_replicas  │
│  ↓ 转换为结构化Patch                     │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│       通用Patch引擎（底层）                │
│  set / add / remove / create / delete   │
│  ↓ 操作YAML文件                          │
└─────────────────────────────────────────┘
```

**优势**：
- 业务层控制权限和策略
- Patch层保证通用性和可扩展性
- 单体和微服务复用同一套Patch引擎

---

## 三、支持的变更类型

### 3.1 第一类：更新字段（M1必须）

**场景**：更新镜像、副本数、资源限制、环境变量值

**示例**：
```yaml
# 更新镜像
action: update_image
target:
  resource_kind: Deployment
  resource_name: demo-app
  container_name: demo-app
value:
  image: registry.com/demo-app:20260616-abc123
```

**处理流程**：
1. 定位YAML文件
2. 定位Kubernetes资源（Deployment/demo-app）
3. 定位字段路径（containers[name=demo-app].image）
4. 执行set操作
5. 保存文件
6. 提交Git

### 3.2 第二类：新增字段或列表项（M1必须）

**场景**：新增环境变量、volume、annotation、sidecar容器

**关键**：必须有唯一性规则，避免重复执行时重复新增

**示例**：
```yaml
# 新增环境变量
action: add_env
target:
  resource_kind: Deployment
  resource_name: demo-app
  container_name: demo-app
value:
  name: FEATURE_FLAG
  value: enabled
policy:
  if_exists: update  # 或 reject
```

**处理逻辑**：
1. 检查环境变量列表中是否已存在`name=FEATURE_FLAG`
2. 如果存在且`policy=reject`，则拒绝
3. 如果存在且`policy=update`，则更新值
4. 如果不存在，则追加到env列表

### 3.3 第三类：删除字段或列表项（M1可选）

**场景**：删除环境变量、annotation、某个容器、某个volume

**保护规则**：
- 只允许删除指定name的条目
- 删除前确认该条目存在
- 删除后确认Deployment仍然合法
- 不能删除主容器
- 不能删除必要label
- 不能删除selector

**示例**：
```yaml
# 删除环境变量
action: remove_env
target:
  resource_kind: Deployment
  resource_name: demo-app
  container_name: demo-app
value:
  name: DEPRECATED_FLAG
policy:
  if_missing: ignore  # 或 fail
```

### 3.4 第四类：新增整个资源（M2）

**场景**：新增ConfigMap、Secret、Service、Ingress、HPA

**示例**：
```yaml
action: create_document
target:
  resource_kind: ConfigMap
  resource_name: demo-app-config
value:
  apiVersion: v1
  kind: ConfigMap
  metadata:
    name: demo-app-config
  data:
    key1: value1
```

### 3.5 第五类：删除整个资源（M2）

**场景**：删除Ingress、HPA

**示例**：
```yaml
action: delete_document
target:
  resource_kind: Ingress
  resource_name: demo-app-ingress
```

**⚠️ 生产环境删除资源风险高，必须审批**

---

## 四、M1实现范围

### 4.1 必须支持的操作（Week 1-2）

| 操作 | 用途 | 优先级 |
|------|------|--------|
| `update_image` | 更新镜像tag | P0 |
| `add_env` | 新增环境变量 | P0 |
| `update_env` | 更新环境变量值 | P0 |
| `remove_env` | 删除环境变量 | P1 |
| `set_replicas` | 更新副本数 | P1 |
| `add_annotation` | 新增annotation | P1 |
| `remove_annotation` | 删除annotation | P2 |

### 4.2 暂不支持（M2）

- 新增sidecar容器
- 修改selector
- 修改serviceAccountName
- 新增hostPath
- 新增privileged container
- 删除主容器
- 修改namespace
- 修改ArgoCD Application destination

---

## 五、配置类型适配器

### 5.1 三种配置类型

```
YamlAdapter (抽象层)
├── RawKubernetesAdapter   # 原生Kubernetes YAML
├── KustomizeAdapter       # Kustomize配置
└── HelmValuesAdapter      # Helm values.yaml
```

### 5.2 RawKubernetesAdapter（M1优先）

**适用场景**：直接修改Deployment.yaml

**实现**：
```python
class RawKubernetesAdapter:
    """原生Kubernetes YAML适配器"""
    
    def update_image(self, yaml_file: str, target: Target, image: str):
        """更新镜像"""
        # 1. 加载YAML
        docs = yaml.safe_load_all(open(yaml_file))
        
        # 2. 定位资源
        deployment = self.find_resource(
            docs, 
            kind="Deployment", 
            name=target.resource_name
        )
        
        # 3. 定位容器
        container = self.find_container(
            deployment, 
            name=target.container_name
        )
        
        # 4. 更新镜像
        old_image = container['image']
        container['image'] = image
        
        # 5. 验证变更
        self.validate_deployment(deployment)
        
        # 6. 保存文件
        yaml.safe_dump_all(docs, open(yaml_file, 'w'))
        
        return {
            "old_image": old_image,
            "new_image": image
        }
```

### 5.3 KustomizeAdapter（M2）

**优先修改**：
```yaml
# kustomization.yaml
images:
  - name: registry.com/demo-app
    newTag: 20260616-abc123
```

而不是直接修改base/deployment.yaml

### 5.4 HelmValuesAdapter（M2）

**优先修改**：
```yaml
# values.yaml
image:
  repository: registry.com/demo-app
  tag: 20260616-abc123
```

而不是直接修改templates/deployment.yaml

---

## 六、单体应用实现（M1）

### 6.1 配置模型

```yaml
# config/applications.yaml
applications:
  - name: demo-app
    type: monolith
    environment: dev
    
    # Git配置
    git:
      repo: git@gitlab.com:ops/demo-gitops.git
      branch: main
      config_file: apps/demo-app/deployment.yaml
      yaml_mode: raw-kubernetes
    
    # 镜像配置
    image:
      repository: registry.com/demo-app
      container_name: demo-app
    
    # ArgoCD配置
    argocd:
      application: demo-app-dev
      namespace: demo
      auto_sync: true
    
    # 策略配置
    policy:
      auto_commit: true
      allowed_operations:
        - update_image
        - add_env
        - update_env
        - remove_env
        - set_replicas
```

### 6.2 完整流程

```python
# orchestrators/pipeline.py
async def handle_build_complete(payload: dict):
    """处理Tekton构建完成"""
    app_name = payload["application"]
    environment = payload["environment"]
    image_ref = payload["image"]
    
    # 1. 加载应用配置
    app_config = config_loader.get_app_config(app_name, environment)
    
    # 2. 创建变更请求
    change_request = YamlChangeRequest(
        application=app_name,
        environment=environment,
        source=Source(
            pipeline_run=payload["pipeline_run"],
            commit_sha=payload["commit_sha"],
            image_ref=image_ref
        ),
        changes=[
            Change(
                action="update_image",
                target=Target(
                    resource_kind="Deployment",
                    resource_name=app_config.argocd.application,
                    container_name=app_config.image.container_name
                ),
                value={"image": image_ref}
            )
        ]
    )
    
    # 3. 执行变更
    yaml_engine = YamlChangeEngine()
    result = await yaml_engine.apply_changes(change_request)
    
    # 4. 提交Git
    git_client = GitClient(app_config.git)
    commit_sha = await git_client.commit_and_push(
        message=f"feat({app_name}): update image to {image_ref}",
        files=[app_config.git.config_file],
        metadata={
            "deploy_id": str(deployment.id),
            "pipeline_run": payload["pipeline_run"],
            "author": payload["author"]
        }
    )
    
    # 5. 触发ArgoCD同步（可选）
    if not app_config.argocd.auto_sync:
        await argocd_client.trigger_sync(app_config.argocd.application)
    
    # 6. 发布事件
    await event_bus.publish("deploy.started", {
        "deploy_id": str(deployment.id),
        "git_commit": commit_sha
    })
```

---

## 七、微服务扩展（M2）

### 7.1 配置模型差异

```yaml
# 微服务配置
systems:
  - name: order-platform
    services:
      - name: order-api
        environment: dev
        git:
          repo: git@gitlab.com:ops/order-gitops.git
          config_file: apps/order-platform/order-api/deployment.yaml
        image:
          repository: registry.com/order/api
          container_name: order-api
        argocd:
          application: order-api-dev  # 或 order-platform-dev
          namespace: order
      
      - name: order-worker
        environment: dev
        # ...
```

### 7.2 变更引擎不变

**关键**：微服务只是多了一层服务映射，Patch引擎完全复用：

```python
# 单体应用
app_config = get_app_config("demo-app", "dev")

# 微服务
system_config = get_system_config("order-platform")
service_config = system_config.get_service("order-api", "dev")

# 都调用同一个变更引擎
yaml_engine.apply_changes(change_request)
```

---

## 八、关键校验

### 8.1 修改前校验

```python
def validate_before_change(change_request: YamlChangeRequest):
    """修改前校验"""
    # 1. 文件存在
    assert os.path.exists(yaml_file), "YAML文件不存在"
    
    # 2. 文件可解析
    docs = yaml.safe_load_all(open(yaml_file))
    
    # 3. 目标资源存在
    resource = find_resource(docs, kind, name)
    assert resource is not None, "目标资源不存在"
    
    # 4. 当前应用有权限
    assert change.action in app_config.policy.allowed_operations
    
    # 5. 当前环境允许
    assert app_config.policy.auto_commit or environment != "prod"
    
    # 6. 无并发任务
    assert not has_concurrent_task(app_name, environment)
```

### 8.2 修改后校验

```python
def validate_after_change(yaml_file: str, diff: dict):
    """修改后校验"""
    # 1. YAML仍可解析
    docs = yaml.safe_load_all(open(yaml_file))
    
    # 2. 只修改了允许的字段
    for change in diff["changes"]:
        assert change["path"] in ALLOWED_PATHS
    
    # 3. Kubernetes schema合法
    validate_k8s_schema(docs)
    
    # 4. selector未被修改
    assert deployment["spec"]["selector"] == old_selector
    
    # 5. namespace未越权
    assert deployment["metadata"]["namespace"] == expected_namespace
```

### 8.3 提交前校验

```python
def prepare_git_commit(change_result: dict):
    """提交前准备"""
    # 1. 生成结构化diff
    diff = generate_structured_diff(
        old_yaml=change_result["old"],
        new_yaml=change_result["new"]
    )
    
    # 2. 生成提交信息
    commit_message = f"""feat({app_name}): update image to {new_image}

- Image: {new_image}
- Commit: {commit_sha}
- Pipeline: {pipeline_run}
- Deploy ID: {deploy_id}
- Triggered by: FDE Workstation Pipeline Agent

Diff:
{format_diff(diff)}
"""
    
    return commit_message
```

---

## 九、不要做的事（⚠️ 重要）

### 9.1 绝对禁止

```python
# ❌ 错误做法1：字符串替换
def update_image_wrong(yaml_file, old_image, new_image):
    content = open(yaml_file).read()
    content = content.replace(old_image, new_image)  # 危险！
    open(yaml_file, 'w').write(content)

# ❌ 错误做法2：正则替换
def update_image_wrong(yaml_file, new_image):
    content = open(yaml_file).read()
    content = re.sub(r'image: .*', f'image: {new_image}', content)  # 危险！

# ❌ 错误做法3：允许任意路径
def update_field_wrong(yaml_file, path, value):
    # 调用方传入path="spec.template.spec.serviceAccountName"
    # 可能导致权限提升
    set_yaml_path(yaml_file, path, value)  # 危险！

# ❌ 错误做法4：让LLM直接生成YAML
def update_yaml_wrong(yaml_file, prompt):
    llm_output = llm.generate(f"修改YAML: {prompt}")
    open(yaml_file, 'w').write(llm_output)  # 危险！
```

### 9.2 为什么危险

1. **字符串替换**：可能误伤注释、文档、其他容器
2. **正则替换**：无法保证YAML结构合法性
3. **任意路径**：可能修改selector、serviceAccount、namespace
4. **LLM生成**：不可控，可能引入安全漏洞

### 9.3 正确做法

```python
# ✅ 正确做法：结构化修改
def update_image_correct(yaml_file, target: Target, new_image: str):
    # 1. 解析YAML
    docs = yaml.safe_load_all(open(yaml_file))
    
    # 2. 定位资源
    deployment = find_resource(docs, kind="Deployment", name=target.resource_name)
    
    # 3. 定位容器
    container = find_container(deployment, name=target.container_name)
    
    # 4. 校验当前镜像
    old_image = container['image']
    assert old_image.startswith(ALLOWED_REGISTRY)
    
    # 5. 更新镜像
    container['image'] = new_image
    
    # 6. 验证变更
    validate_deployment(deployment)
    
    # 7. 保存
    yaml.safe_dump_all(docs, open(yaml_file, 'w'))
```

---

## 十、M1实施检查清单

### Week 1完成后

- [ ] RawKubernetesAdapter已实现
- [ ] `update_image`操作已实现并测试
- [ ] YAML修改前后都做了校验
- [ ] Git提交信息包含Deploy ID和Pipeline信息
- [ ] 单体测试应用配置已添加到applications.yaml

### Week 2完成后

- [ ] `add_env`操作已实现（含唯一性检查）
- [ ] `update_env`操作已实现
- [ ] `remove_env`操作已实现
- [ ] `set_replicas`操作已实现
- [ ] 结构化diff生成器已实现
- [ ] 并发控制已实现（同应用同环境串行）

### Week 3完成后

- [ ] 所有变更操作都有审计日志
- [ ] 所有变更操作都有回滚能力（Git revert）
- [ ] 修改后YAML能通过Kubernetes schema验证
- [ ] 微服务配置模型已设计（不实现）

---

## 十一、示例代码

### 11.1 变更引擎核心

```python
# engines/yaml_engine.py
class YamlChangeEngine:
    """YAML变更引擎"""
    
    def __init__(self):
        self.adapters = {
            "raw-kubernetes": RawKubernetesAdapter(),
            "kustomize": KustomizeAdapter(),
            "helm-values": HelmValuesAdapter()
        }
    
    async def apply_changes(self, request: YamlChangeRequest) -> ChangeResult:
        """应用变更"""
        # 1. 加载应用配置
        app_config = await self.load_app_config(
            request.application, 
            request.environment
        )
        
        # 2. 获取适配器
        adapter = self.adapters[app_config.git.yaml_mode]
        
        # 3. 校验权限
        self.validate_permissions(request, app_config)
        
        # 4. 获取文件锁（防止并发）
        async with self.acquire_lock(request.application, request.environment):
            # 5. 克隆Git仓库
            repo_path = await self.git_client.clone(app_config.git.repo)
            yaml_file = os.path.join(repo_path, app_config.git.config_file)
            
            # 6. 修改前校验
            self.validate_before_change(yaml_file, request)
            
            # 7. 执行变更
            result = await adapter.apply_changes(yaml_file, request.changes)
            
            # 8. 修改后校验
            self.validate_after_change(yaml_file, result)
            
            # 9. 生成diff
            diff = self.generate_diff(result)
            
            # 10. 提交Git
            commit_sha = await self.git_client.commit_and_push(
                message=self.generate_commit_message(request, diff),
                files=[app_config.git.config_file]
            )
            
            return ChangeResult(
                success=True,
                commit_sha=commit_sha,
                diff=diff
            )
```

---

## 总结

### ✅ M1核心原则

1. **结构化修改，不是字符串替换**
2. **业务动作 + 通用Patch，双层架构**
3. **先支持单体，设计兼容微服务**
4. **修改前后都要校验**
5. **受控操作列表，不开放任意路径**

### ⚠️ M1明确不做

1. ❌ 字符串替换、正则替换
2. ❌ 允许任意YAML路径修改
3. ❌ LLM直接生成YAML
4. ❌ 修改selector、serviceAccount、namespace
5. ❌ 所有环境共用同一套配置

### 🚀 实施顺序

**Week 1**: RawKubernetesAdapter + update_image  
**Week 2**: add_env / update_env / remove_env / set_replicas  
**M2**: KustomizeAdapter / HelmValuesAdapter / 新增资源 / 删除资源
