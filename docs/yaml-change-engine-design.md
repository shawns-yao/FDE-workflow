# YAML变更引擎设计（M1核心模块）

**版本**：v1.0  
**日期**：2026-06-16  
**状态**：Week 1必须实现

---

## 文档角色

本文是配置变更引擎专项设计文档。文档分类和阅读顺序见 [`docs/document-index.md`](document-index.md)，M1 架构决策以 [`docs/m1-architecture-decisions.md`](m1-architecture-decisions.md) 为最高优先级。

M1 只实现 Raw Kubernetes 子集；Helm 和 Kustomize 保留 Adapter 设计，不作为 Week 1 必交付内容。

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

### 问题4：前端应该暴露什么能力？

**答案：前端暴露业务开关和受控表单，不是任意YAML编辑器**

**错误做法**：
```
前端：一个YAML编辑器，用户直接修改任意路径
后端：接收YAML，直接提交Git
```

**正确做法**：
```
前端：开启Debug模式 / 启用Ingress / 修改副本数
后端：翻译为受控action，根据配置类型选择适配器
```

**完整数据流**：
```
前端业务操作
  → 后端变更意图（ChangeRequest）
  → 策略校验（权限+环境）
  → 配置类型适配器（Raw/Helm/Kustomize）
  → YAML/values/kustomization修改
  → diff校验
  → Git提交
  → ArgoCD同步
```

---

## 二、前端Schema驱动设计（⭐ 新增）

### 2.1 前端不应该做的

❌ **任意YAML编辑器**（主路径）  
❌ **让用户输入YAML path**（如`spec.template.spec.containers[0].env[3].value`）  
❌ **直接传YAML内容给后端**  
❌ **绕过权限和策略的"专家模式"**

### 2.2 前端应该做的

✅ **业务开关和表单**：
```
基础发布:
  - 镜像版本选择器
  - 自动同步开关
  - 发布环境选择
  - 同步策略

运行配置:
  - 副本数输入（1-10）
  - CPU/内存配置
  - 环境变量表格
  - 启动参数

网络配置:
  - Service类型选择
  - Ingress开关
  - 域名配置
  - TLS开关

配置项:
  - ConfigMap key-value编辑
  - Secret引用选择
  - 外部配置引用

高级能力:
  - 灰度开关（M2）
  - 回滚策略（M2）
  - 健康检查配置
  - 自动诊断开关
```

### 2.3 配置Schema设计

**每个应用必须注册配置Schema**：

```yaml
# config/schemas/demo-app.yaml
application: demo-app
configType: raw-kubernetes  # 或 helm-values / kustomize

capabilities:
  # 更新镜像
  - name: update_image
    label: "镜像版本"
    control: text
    required: true
    default: "latest"
    validation: "^[\\w.-]+:[\\w.-]+$"
    environments: [dev, staging, prod]
    requiresApproval: false
  
  # 副本数
  - name: set_replicas
    label: "副本数"
    control: number
    required: true
    default: 2
    min: 1
    max: 10
    environments: [dev, staging, prod]
    requiresApproval:
      prod: true  # prod需要审批
  
  # 环境变量
  - name: set_env
    label: "环境变量"
    control: key-value-table
    required: false
    sensitive: false
    environments: [dev, staging, prod]
  
  # Ingress开关
  - name: set_ingress_enabled
    label: "启用Ingress"
    control: switch
    required: false
    default: false
    environments: [dev, staging]
    requiresApproval: false
    relatedFields:
      - name: ingress_host
        label: "域名"
        control: text
        required: true
        when: "ingress_enabled == true"
```

### 2.4 前端渲染逻辑

```typescript
// 前端伪代码
async function loadAppConfig(appName: string, environment: string) {
  const schema = await api.getAppSchema(appName, environment);
  
  // 根据schema渲染表单
  schema.capabilities.forEach(cap => {
    if (!cap.environments.includes(environment)) return;
    
    switch (cap.control) {
      case 'text':
        renderTextInput(cap);
        break;
      case 'number':
        renderNumberInput(cap);
        break;
      case 'switch':
        renderSwitch(cap);
        break;
      case 'key-value-table':
        renderKeyValueTable(cap);
        break;
    }
  });
}
```

### 2.5 三层操作模式

**普通模式**（M1必须）：
- 只展示开关、输入框、选择器
- 用户修改后提交
- 后端自动生成diff并执行

**高级模式**（M1可选）：
- 展示变更diff（YAML格式）
- 用户只能确认或取消
- 不能直接编辑YAML

**专家模式**（M2）：
- YAML只读预览
- 可创建MR但不能直接同步
- 需要特殊权限

**M1只做普通模式**，高级模式和专家模式推迟到M2。

---

## 三、架构设计（更新）

### 3.1 核心模型

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

### 3.2 双层架构

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

## 四、支持的变更类型

### 4.1 第一类：更新字段（M1必须）

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

### 4.2 第二类：新增字段或列表项（M1必须）

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

### 4.3 第三类：删除字段或列表项（M1可选）

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

### 4.4 第四类：新增整个资源（M2）

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

### 4.5 第五类：删除整个资源（M2）

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

## 五、M1实现范围

### 5.1 必须支持的操作（Week 1-2）

| 操作 | 用途 | 优先级 |
|------|------|--------|
| `update_image` | 更新镜像tag | P0 |
| `add_env` | 新增环境变量 | P0 |
| `update_env` | 更新环境变量值 | P0 |
| `remove_env` | 删除环境变量 | P1 |
| `set_replicas` | 更新副本数 | P1 |

### 5.2 暂不支持（M2）

- 新增或删除annotation
- 新增sidecar容器
- 修改selector
- 修改serviceAccountName
- 新增hostPath
- 新增privileged container
- 删除主容器
- 修改namespace
- 修改ArgoCD Application destination

---

## 六、配置类型适配器

### 6.1 三种配置类型

```
YamlAdapter (抽象层)
├── RawKubernetesAdapter   # 原生Kubernetes YAML
├── KustomizeAdapter       # Kustomize配置
└── HelmValuesAdapter      # Helm values.yaml
```

### 6.2 RawKubernetesAdapter（M1优先）

**适用场景**：直接修改Deployment.yaml

**实现**：
```python
from pathlib import Path

class RawKubernetesAdapter:
    """原生Kubernetes YAML适配器"""
    
    def update_image(self, yaml_file: str, target: Target, image: str):
        """更新镜像"""
        # 1. 加载YAML
        yaml_path = Path(yaml_file)
        docs = list(yaml.safe_load_all(yaml_path.read_text(encoding="utf-8")))
        
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
        yaml_path.write_text(
            yaml.safe_dump_all(docs, sort_keys=False, allow_unicode=True),
            encoding="utf-8"
        )
        
        return {
            "old_image": old_image,
            "new_image": image
        }
```

### 6.3 KustomizeAdapter（M2）

**适用场景**：Kustomize配置，优先修改`kustomization.yaml`和`patches`

**同一个业务操作的不同实现**：

| 业务操作 | Kustomize实现 |
|----------|---------------|
| 更新镜像 | 修改`images[].newTag` |
| 新增env | 添加patch文件 |
| 启用Ingress | 启用component |
| 修改副本数 | 添加replicas patch |

**示例1：更新镜像**
```yaml
# kustomization.yaml
images:
  - name: registry.com/demo-app
    newTag: 20260616-abc123
```

**示例2：新增环境变量**
```yaml
# 新增patch文件：patches/add-env-feature-flag.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-app
spec:
  template:
    spec:
      containers:
        - name: demo-app
          env:
            - name: FEATURE_FLAG
              value: enabled

# 引用patch：kustomization.yaml
patches:
  - path: patches/add-env-feature-flag.yaml
```

**示例3：启用Ingress**
```yaml
# kustomization.yaml
components:
  - components/ingress  # 启用Ingress component
```

**实现**：
```python
class KustomizeAdapter:
    """Kustomize适配器"""
    
    def update_image(self, kustomization_file: str, image: str, tag: str):
        """更新镜像"""
        kustomization = yaml.safe_load(open(kustomization_file))
        
        # 查找或创建images配置
        if 'images' not in kustomization:
            kustomization['images'] = []
        
        # 查找现有镜像配置
        image_config = None
        for img in kustomization['images']:
            if img['name'] == image:
                image_config = img
                break
        
        # 更新或新增
        if image_config:
            image_config['newTag'] = tag
        else:
            kustomization['images'].append({
                'name': image,
                'newTag': tag
            })
        
        yaml.safe_dump(kustomization, open(kustomization_file, 'w'))
    
    def add_env(self, base_path: str, deployment_name: str, env_name: str, env_value: str):
        """新增环境变量（通过patch）"""
        patch_file = f"patches/add-env-{env_name.lower()}.yaml"
        patch_content = {
            'apiVersion': 'apps/v1',
            'kind': 'Deployment',
            'metadata': {'name': deployment_name},
            'spec': {
                'template': {
                    'spec': {
                        'containers': [{
                            'name': deployment_name,
                            'env': [{
                                'name': env_name,
                                'value': env_value
                            }]
                        }]
                    }
                }
            }
        }
        
        # 写入patch文件
        yaml.safe_dump(patch_content, open(os.path.join(base_path, patch_file), 'w'))
        
        # 更新kustomization.yaml
        kustomization_file = os.path.join(base_path, 'kustomization.yaml')
        kustomization = yaml.safe_load(open(kustomization_file))
        
        if 'patches' not in kustomization:
            kustomization['patches'] = []
        
        if {'path': patch_file} not in kustomization['patches']:
            kustomization['patches'].append({'path': patch_file})
        
        yaml.safe_dump(kustomization, open(kustomization_file, 'w'))
```

### 6.4 HelmValuesAdapter（M2）

**适用场景**：Helm Chart，优先修改`values.yaml`

**关键**：每个Chart的values结构可能不同，需要应用注册Schema

**同一个业务操作的不同实现**：

| 业务操作 | Helm实现 |
|----------|----------|
| 更新镜像 | 修改`image.tag` |
| 新增env | 追加到`env`或`extraEnv` |
| 启用Ingress | 设置`ingress.enabled=true` |
| 修改副本数 | 设置`replicaCount` |

**示例1：更新镜像**
```yaml
# values.yaml
image:
  repository: registry.com/demo-app
  tag: 20260616-abc123
  pullPolicy: IfNotPresent
```

**示例2：新增环境变量**
```yaml
# values.yaml
env:
  - name: DATABASE_URL
    value: postgres://...
  - name: FEATURE_FLAG
    value: enabled
```

**示例3：启用Ingress**
```yaml
# values.yaml
ingress:
  enabled: true
  hosts:
    - host: demo.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: demo-tls
      hosts:
        - demo.example.com
```

**实现**：
```python
class HelmValuesAdapter:
    """Helm Values适配器"""
    
    def __init__(self, values_schema: dict):
        """需要加载应用的values schema"""
        self.schema = values_schema
    
    def update_image(self, values_file: str, tag: str):
        """更新镜像tag"""
        values = yaml.safe_load(open(values_file))
        
        # 根据schema确定路径
        image_path = self.schema.get('image_tag_path', 'image.tag')
        
        # 更新值
        self.set_nested_value(values, image_path, tag)
        
        yaml.safe_dump(values, open(values_file, 'w'))
    
    def add_env(self, values_file: str, env_name: str, env_value: str):
        """新增环境变量"""
        values = yaml.safe_load(open(values_file))
        
        # 根据schema确定env列表路径
        env_path = self.schema.get('env_path', 'env')
        
        # 获取env列表
        env_list = self.get_nested_value(values, env_path, [])
        
        # 检查是否已存在
        for env in env_list:
            if env.get('name') == env_name:
                env['value'] = env_value  # 更新
                break
        else:
            # 新增
            env_list.append({'name': env_name, 'value': env_value})
        
        # 写回
        self.set_nested_value(values, env_path, env_list)
        yaml.safe_dump(values, open(values_file, 'w'))
    
    def set_ingress_enabled(self, values_file: str, enabled: bool, host: str = None):
        """设置Ingress开关"""
        values = yaml.safe_load(open(values_file))
        
        if 'ingress' not in values:
            values['ingress'] = {}
        
        values['ingress']['enabled'] = enabled
        
        if enabled and host:
            if 'hosts' not in values['ingress']:
                values['ingress']['hosts'] = []
            
            # 更新或新增host
            if not values['ingress']['hosts']:
                values['ingress']['hosts'].append({
                    'host': host,
                    'paths': [{'path': '/', 'pathType': 'Prefix'}]
                })
            else:
                values['ingress']['hosts'][0]['host'] = host
        
        yaml.safe_dump(values, open(values_file, 'w'))
    
    def set_nested_value(self, data: dict, path: str, value):
        """设置嵌套字典值（例如 image.tag）"""
        keys = path.split('.')
        current = data
        for key in keys[:-1]:
            if key not in current:
                current[key] = {}
            current = current[key]
        current[keys[-1]] = value
    
    def get_nested_value(self, data: dict, path: str, default=None):
        """获取嵌套字典值"""
        keys = path.split('.')
        current = data
        for key in keys:
            if key not in current:
                return default
            current = current[key]
        return current
```

**Helm Values Schema配置**：
```yaml
# config/schemas/order-api-helm.yaml
application: order-api
configType: helm-values
valuesFile: environments/dev/order-api/values.yaml

# Values结构映射
valuesSchema:
  image_tag_path: image.tag
  image_repository_path: image.repository
  replicas_path: replicaCount
  env_path: env
  resources_path: resources
  ingress_enabled_path: ingress.enabled
  ingress_hosts_path: ingress.hosts
```

---

## 七、同一业务操作的三种实现

### 7.1 示例：启用Ingress

**前端操作**：
```typescript
{
  action: "set_ingress_enabled",
  value: {
    enabled: true,
    host: "demo.example.com"
  }
}
```

**Raw Kubernetes实现**：
```python
# 创建或修改 ingress.yaml
ingress = {
    'apiVersion': 'networking.k8s.io/v1',
    'kind': 'Ingress',
    'metadata': {'name': 'demo-app'},
    'spec': {
        'rules': [{
            'host': 'demo.example.com',
            'http': {
                'paths': [{
                    'path': '/',
                    'pathType': 'Prefix',
                    'backend': {
                        'service': {
                            'name': 'demo-app',
                            'port': {'number': 80}
                        }
                    }
                }]
            }
        }]
    }
}
```

**Helm实现**：
```yaml
# values.yaml
ingress:
  enabled: true
  hosts:
    - host: demo.example.com
      paths:
        - path: /
          pathType: Prefix
```

**Kustomize实现**：
```yaml
# kustomization.yaml
components:
  - components/ingress

# components/ingress/kustomization.yaml
resources:
  - ingress.yaml

# components/ingress/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: demo-app
spec:
  rules:
    - host: demo.example.com
      # ...
```

**后端路由逻辑**：
```python
async def handle_set_ingress_enabled(request: ChangeRequest):
    app_config = await load_app_config(request.application)
    
    if app_config.configType == "raw-kubernetes":
        adapter = RawKubernetesAdapter()
        await adapter.create_or_update_ingress(...)
    
    elif app_config.configType == "helm-values":
        adapter = HelmValuesAdapter(app_config.valuesSchema)
        await adapter.set_ingress_enabled(...)
    
    elif app_config.configType == "kustomize":
        adapter = KustomizeAdapter()
        await adapter.enable_component("ingress")
```

### 7.2 示例：更新镜像

| 配置类型 | 修改位置 | 修改内容 |
|----------|----------|----------|
| Raw Kubernetes | `deployment.yaml` | `spec.template.spec.containers[0].image` |
| Helm | `values.yaml` | `image.tag: 20260616-abc123` |
| Kustomize | `kustomization.yaml` | `images[].newTag: 20260616-abc123` |

**关键**：前端只提交`update_image`操作，后端根据配置类型自动选择实现方式。

---

## 八、单体应用实现（M1）

### 8.1 配置模型

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

### 8.2 完整流程

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

## 九、微服务扩展（M2）

### 9.1 配置模型差异

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

### 9.2 变更引擎不变

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

## 十、关键校验

### 10.1 修改前校验

```python
from pathlib import Path

def validate_before_change(change_request: YamlChangeRequest):
    """修改前校验"""
    # 1. 文件存在
    yaml_path = Path(yaml_file)
    assert yaml_path.exists(), "YAML文件不存在"
    
    # 2. 文件可解析
    docs = list(yaml.safe_load_all(yaml_path.read_text(encoding="utf-8")))
    
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

### 10.2 修改后校验

```python
def validate_after_change(yaml_file: str, diff: dict):
    """修改后校验"""
    # 1. YAML仍可解析
    yaml_path = Path(yaml_file)
    docs = list(yaml.safe_load_all(yaml_path.read_text(encoding="utf-8")))
    
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

### 10.3 提交前校验

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

## 十一、不要做的事

### 11.1 绝对禁止

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

### 11.2 为什么危险

1. **字符串替换**：可能误伤注释、文档、其他容器
2. **正则替换**：无法保证YAML结构合法性
3. **任意路径**：可能修改selector、serviceAccount、namespace
4. **LLM生成**：不可控，可能引入安全漏洞

### 11.3 正确做法

```python
# ✅ 正确做法：结构化修改
def update_image_correct(yaml_file, target: Target, new_image: str):
    # 1. 解析YAML
    yaml_path = Path(yaml_file)
    docs = list(yaml.safe_load_all(yaml_path.read_text(encoding="utf-8")))
    
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
    yaml_path.write_text(
        yaml.safe_dump_all(docs, sort_keys=False, allow_unicode=True),
        encoding="utf-8"
    )
```

---

## 十二、M1实施检查清单

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

## 十三、示例代码

### 13.1 变更引擎核心

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

## 十四、总结

### ✅ M1核心原则（更新）

1. **前端暴露业务开关，不是YAML编辑器**
2. **Schema驱动表单渲染**
3. **结构化修改，不是字符串替换**
4. **业务动作 + 通用Patch，双层架构**
5. **三种适配器：Raw/Helm/Kustomize**
6. **先支持单体RawKubernetes，预留Helm/Kustomize扩展**
7. **修改前后都要校验**
8. **受控操作列表，不开放任意路径**

### ⚠️ M1明确不做

**前端侧**：
1. ❌ 任意YAML编辑器（作为主路径）
2. ❌ 让用户输入YAML path
3. ❌ 直接传YAML内容给后端
4. ❌ 绕过策略的"专家模式"

**后端侧**：
1. ❌ 字符串替换、正则替换
2. ❌ 允许任意YAML路径修改
3. ❌ LLM直接生成YAML
4. ❌ 修改selector、serviceAccount、namespace
5. ❌ 所有环境共用同一套配置

### 🚀 实施顺序（更新）

**Week 1 (Day 4-5)**: 
- RawKubernetesAdapter基础框架
- update_image操作
- 配置Schema加载器
- 基础校验逻辑

**Week 2**: 
- add_env / update_env / remove_env
- set_replicas
- 前端Schema API
- 结构化diff生成

**M2**: 
- HelmValuesAdapter
- KustomizeAdapter
- 前端配置面板
- 高级模式（diff预览）
- 更多业务操作（Ingress、ConfigMap等）

---

## 十五、当前测试项目确认

### 需要确认的问题

**你的测试项目使用哪种配置方式？**

- [ ] **A. 原生Kubernetes YAML**（直接修改Deployment.yaml）
- [ ] **B. Helm values.yaml**
- [ ] **C. Kustomize kustomization.yaml**
- [ ] **D. 混合使用**

### 根据不同类型的实施建议

**如果是A（原生Kubernetes YAML）**：
```
✅ 最适合M1快速验证
✅ 直接使用RawKubernetesAdapter
✅ 配置示例：
   configType: raw-kubernetes
   configFile: apps/demo-app/deployment.yaml
```

**如果是B（Helm）**：
```
⚠️ 需要先定义values schema
✅ 可以先用RawKubernetesAdapter修改渲染后的YAML
✅ M2再切换到HelmValuesAdapter
✅ 配置示例：
   configType: helm-values
   valuesFile: environments/dev/values.yaml
   valuesSchema: config/schemas/demo-app-helm.yaml
```

**如果是C（Kustomize）**：
```
⚠️ 需要理解overlay结构
✅ 可以先用RawKubernetesAdapter修改base
✅ M2再切换到KustomizeAdapter
✅ 配置示例：
   configType: kustomize
   kustomizationFile: overlays/dev/kustomization.yaml
```

### M1推荐路径

**不管测试项目当前使用什么，M1都建议**：
1. 先用RawKubernetesAdapter
2. 只实现update_image操作
3. 验证完整链路可行性
4. Week 2再扩展其他操作
5. M2再根据实际需求切换适配器

**原因**：
- RawKubernetesAdapter最直接，调试容易
- 可以快速验证GitOps流程
- 即使项目用Helm/Kustomize，也可以先修改渲染后的YAML
- 等核心流程稳定后再切换到对应适配器

---

## 十六、M1实施检查清单（更新）

### Week 1 Day 4-5完成后

**配置Schema**：
- [ ] 创建`config/schemas/`目录
- [ ] 编写测试应用的schema（至少包含update_image）
- [ ] 实现Schema加载器

**RawKubernetesAdapter**：
- [ ] 实现基础框架
- [ ] 实现`update_image`操作
- [ ] YAML解析和保存逻辑
- [ ] 资源定位（kind + name）
- [ ] 容器定位（container name）

**校验逻辑**：
- [ ] 修改前校验（文件存在、可解析、权限）
- [ ] 修改后校验（仍可解析、只改了镜像字段）
- [ ] Git提交信息生成

### Week 2完成后

**更多操作**：
- [ ] `add_env`（含唯一性检查）
- [ ] `update_env`
- [ ] `remove_env`
- [ ] `set_replicas`

**前端支持**：
- [ ] Schema API：`GET /api/v1/schemas/{app_name}`
- [ ] 配置API：`GET /api/v1/configs/{app_name}/{env}`
- [ ] 变更API：`POST /api/v1/changes`
- [ ] Diff预览API：`POST /api/v1/changes/preview`

**审计和安全**：
- [ ] 所有变更操作记录到数据库
- [ ] 操作者身份记录
- [ ] 环境策略校验
- [ ] 并发控制（同应用同环境串行）

### M2规划

**Helm支持**：
- [ ] HelmValuesAdapter实现
- [ ] values schema定义规范
- [ ] Helm template渲染验证

**Kustomize支持**：
- [ ] KustomizeAdapter实现
- [ ] patch文件管理
- [ ] component启用/禁用

**前端配置面板**：
- [ ] 基于Schema动态渲染表单
- [ ] 开关、输入框、选择器
- [ ] 环境变量表格
- [ ] 变更diff预览
- [ ] 高级模式（YAML只读预览）

---

## 十七、方案对比总结

### 推荐方案：业务操作 + Adapter + Schema ✅

**优点**：
- 兼容Raw/Helm/Kustomize
- 前端可以做开关和表单
- 权限、审计、审批容易落地
- 单体和微服务复用同一套引擎

**缺点**：
- 前期需要定义action和schema
- 每个应用需要注册配置

**适用场景**：M1和长期方案

### 备选方案：直接YAML Patch ⚠️

**优点**：
- 实现快
- 任何YAML都能改

**缺点**：
- 安全风险高（任意路径）
- Helm/Kustomize不好抽象
- 难以控制权限和审批

**适用场景**：临时方案，不推荐

### 备选方案：全部Helm化 ⚠️

**优点**：
- 前端表单到values映射最清楚

**缺点**：
- 要求所有项目改造为Helm
- 对现有Raw/Kustomize项目不友好
- M1推进成本高

**适用场景**：新项目或全Helm组织

---

**最终推荐：业务操作 + Adapter + Schema，M1先用RawKubernetesAdapter验证流程**
**M2**: KustomizeAdapter / HelmValuesAdapter / 新增资源 / 删除资源
