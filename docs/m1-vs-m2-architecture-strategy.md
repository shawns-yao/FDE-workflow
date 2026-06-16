# M1与M2架构衔接策略

**日期**：2026-06-16  
**核心问题**：M1如何设计才能快速完成，同时避免M2大量重构？
**文档定位**：策略参考，不覆盖 `docs/m1-architecture-decisions.md` 和 `docs/implementation-plan-week1.md`。如果本文提到的 `applications` 表、配置注册表或 Adapter 工厂未进入架构基线，则不能作为 Week 1 强制任务。

---

## 一、核心矛盾

### 长期架构风险

**最终产品需要**：
- 前端管理界面配置Git仓库
- 支持Raw Kubernetes / Helm / Kustomize无缝切换
- 多应用、多环境动态管理
- 不同应用不同策略

**如果M1硬编码**：
```python
# M1硬编码方式
CONFIG = {
    "config_repo": "git@gitlab.com/ops/demo-gitops.git",
    "config_file": "apps/demo-app/deployment.yaml",
    "config_type": "raw-kubernetes"
}

# M2需要大量重构，改成：
app_config = await db.get_application(app_name)
adapter = factory.create(app_config.config_type)
```

**结果**：M2需要大量重构，M1代码基本废弃。

---

## 二、建议方案：分层架构

### 核心原则

```text
数据层和架构层：M1就做通用
实现层：M1只做最小子集
配置管理：M1用文件，M2换前端（接口不变）
```

### 架构分层

```text
┌─────────────────────────────────────┐
│  Layer 4: 前端管理界面                │  ← M2实现
│  应用配置表单、环境策略配置           │     0行代码
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Layer 3: 配置加载层                  │  ← M1做通用
│  ApplicationRegistry                 │     M2无需修改
│  - load_from_yaml() (M1)            │     只新增load_from_form()
│  - load_from_api() (M2)             │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Layer 2: 数据存储层                  │  ← M1做通用
│  applications表（通用schema）         │     M2无需修改
│  - Git配置、K8s配置、ArgoCD配置       │     0%重构
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Layer 1: Adapter工厂                │  ← M1做架构
│  ConfigAdapterFactory                │     M2只新增Adapter
│  - RawKubernetesAdapter (M1)        │     不改现有代码
│  - HelmValuesAdapter (M2 new)       │
│  - KustomizeAdapter (M2 new)        │
└─────────────────────────────────────┘
```

---

## 三、M1具体实施方案

### Week 1 Day 1：通用数据层

**数据库设计（M1就是通用的）**：

```python
# models/application.py
class Application(Base):
    """应用配置表（M1就设计成通用schema）"""
    __tablename__ = 'applications'
    
    # 基本信息
    id = Column(UUID, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    type = Column(String(20))  # monolith / microservice
    
    # Git配置（通用字段）
    code_repo_url = Column(String(255))
    config_repo_url = Column(String(255))
    config_repo_branch = Column(String(100), default='main')
    config_file_path = Column(String(255))
    
    # 配置类型（M1只用raw-kubernetes，但字段是扩展的）
    config_type = Column(String(50))  # raw-kubernetes / helm-values / kustomize
    config_schema = Column(JSONB)  # Helm字段映射等
    
    # Kubernetes配置
    namespace = Column(String(100))
    deployment_name = Column(String(100))
    container_name = Column(String(100))
    labels = Column(JSONB)
    
    # ArgoCD配置
    argocd_application = Column(String(100))
    argocd_auto_sync = Column(Boolean, default=True)
    
    # 镜像配置
    image_registry = Column(String(255))
    image_repository = Column(String(255))
    image_tag_pattern = Column(String(100))
    
    # 环境策略（M2扩展，M1预留）
    environments = Column(JSONB)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

**YAML配置文件（M1临时用）**：

```yaml
# config/applications/demo-app.yaml
name: demo-app
type: monolith

git:
  code_repo: git@gitlab.com/app/demo-app.git
  config_repo: git@gitlab.com/ops/demo-gitops.git
  config_branch: main
  config_file: apps/demo-app/dev/deployment.yaml

config:
  type: raw-kubernetes
  schema: {}  # M2 Helm时填充

kubernetes:
  namespace: demo
  deployment_name: demo-app
  container_name: demo-app
  labels:
    app: demo-app

argocd:
  application: demo-app-dev
  auto_sync: true

image:
  registry: registry.example.com
  repository: demo-app
  tag_pattern: "{date}-{short_sha}"

environments:
  dev:
    auto_deploy: true
    require_approval: false
```

---

### Week 1 Day 2：通用配置加载层

```python
# services/application_registry.py
class ApplicationRegistry:
    """应用配置注册中心（M1通用接口，M2只扩展）"""
    
    def __init__(self, db: Session):
        self.db = db
        self._cache = {}
    
    async def load_from_yaml(self, yaml_file: str):
        """从YAML加载（M1用）"""
        config = yaml.safe_load(open(yaml_file))
        
        app = Application(
            name=config["name"],
            type=config["type"],
            code_repo_url=config["git"]["code_repo"],
            config_repo_url=config["git"]["config_repo"],
            config_repo_branch=config["git"].get("config_branch", "main"),
            config_file_path=config["git"]["config_file"],
            config_type=config["config"]["type"],
            config_schema=config["config"].get("schema", {}),
            namespace=config["kubernetes"]["namespace"],
            deployment_name=config["kubernetes"]["deployment_name"],
            container_name=config["kubernetes"]["container_name"],
            labels=config["kubernetes"]["labels"],
            argocd_application=config["argocd"]["application"],
            argocd_auto_sync=config["argocd"]["auto_sync"],
            image_registry=config["image"]["registry"],
            image_repository=config["image"]["repository"],
            image_tag_pattern=config["image"]["tag_pattern"],
            environments=config.get("environments", {})
        )
        
        self.db.merge(app)
        await self.db.commit()
        
        # 更新缓存
        self._cache[app.name] = app
        return app
    
    async def load_from_api(self, app_data: dict):
        """从API加载（M2用，接口相同）"""
        app = Application(**app_data)
        self.db.merge(app)
        await self.db.commit()
        self._cache[app.name] = app
        return app
    
    async def get(self, app_name: str) -> Application:
        """获取应用配置（M1和M2都用这个接口）"""
        if app_name in self._cache:
            return self._cache[app_name]
        
        app = await self.db.query(Application).filter_by(name=app_name).first()
        if not app:
            raise ApplicationNotFound(app_name)
        
        self._cache[app_name] = app
        return app
    
    async def list_all(self) -> List[Application]:
        """列出所有应用（M2前端用）"""
        return await self.db.query(Application).all()
```

---

### Week 1 Day 3：Adapter工厂（通用架构）

```python
# engines/adapter_factory.py
class ConfigAdapter(ABC):
    """配置适配器接口（M1定义，M2扩展）"""
    
    @abstractmethod
    async def update_image(self, new_image: str):
        """更新镜像"""
        pass
    
    @abstractmethod
    async def set_replicas(self, replicas: int):
        """设置副本数（M2实现）"""
        pass
    
    @abstractmethod
    async def add_env(self, name: str, value: str):
        """添加环境变量（M2实现）"""
        pass


class ConfigAdapterFactory:
    """适配器工厂（M1架构，M2扩展）"""
    
    @staticmethod
    def create(app_config: Application) -> ConfigAdapter:
        """根据配置类型创建适配器"""
        config_type = app_config.config_type
        
        if config_type == "raw-kubernetes":
            return RawKubernetesAdapter(app_config)
        
        elif config_type == "helm-values":
            # M1：抛异常说明未实现
            raise NotImplementedError(
                f"Helm adapter will be implemented in M2. "
                f"Application '{app_config.name}' uses Helm, "
                f"please convert to raw-kubernetes for M1."
            )
        
        elif config_type == "kustomize":
            # M1：抛异常说明未实现
            raise NotImplementedError(
                f"Kustomize adapter will be implemented in M2."
            )
        
        else:
            raise ValueError(f"Unknown config type: {config_type}")


class RawKubernetesAdapter(ConfigAdapter):
    """原生Kubernetes YAML适配器（M1完整实现）"""
    
    def __init__(self, app_config: Application):
        self.app_config = app_config
    
    async def update_image(self, new_image: str):
        """更新镜像（M1实现）"""
        # 克隆配置仓库
        repo = await GitRepository.clone(
            self.app_config.config_repo_url,
            branch=self.app_config.config_repo_branch
        )
        
        try:
            # 读取YAML
            yaml_file = repo.get_file_path(self.app_config.config_file_path)
            deployment = yaml.safe_load(open(yaml_file))
            
            # 修改镜像
            containers = deployment['spec']['template']['spec']['containers']
            for container in containers:
                if container['name'] == self.app_config.container_name:
                    old_image = container['image']
                    container['image'] = new_image
                    break
            else:
                raise ValueError(f"Container '{self.app_config.container_name}' not found")
            
            # 保存YAML
            yaml.safe_dump(deployment, open(yaml_file, 'w'))
            
            # 提交Git
            await repo.commit_and_push(
                message=f"chore: update {self.app_config.name} image to {new_image}",
                files=[self.app_config.config_file_path]
            )
            
            return {
                "old_image": old_image,
                "new_image": new_image,
                "git_commit": repo.last_commit_sha
            }
        
        finally:
            await repo.cleanup()
    
    async def set_replicas(self, replicas: int):
        """设置副本数（M2实现）"""
        raise NotImplementedError("Will be implemented in M2")
    
    async def add_env(self, name: str, value: str):
        """添加环境变量（M2实现）"""
        raise NotImplementedError("Will be implemented in M2")
```

---

### Week 1 Day 4-5：Pipeline Orchestrator（通用逻辑）

```python
# orchestrators/pipeline.py
class PipelineOrchestrator:
    """管道编排器（M1就是通用的）"""
    
    def __init__(self):
        self.registry = ApplicationRegistry(db)
        self.factory = ConfigAdapterFactory()
        self.argocd = ArgoCDClient()
        self.feishu = FeishuClient()
    
    async def handle_build_complete(self, payload: dict):
        """处理构建完成事件（M1和M2都用这个逻辑）"""
        app_name = payload["application"]
        environment = payload["environment"]
        new_image = payload["image"]
        
        # 1. 加载应用配置（通用接口）
        try:
            app_config = await self.registry.get(app_name)
        except ApplicationNotFound:
            logger.error(f"Application '{app_name}' not registered")
            return
        
        # 2. 检查环境策略（通用）
        env_policy = app_config.environments.get(environment, {})
        if not env_policy.get("auto_deploy", False):
            logger.info(f"Auto deploy disabled for {app_name}/{environment}")
            return
        
        # 3. 创建部署记录（通用）
        deploy = await db.create_deployment(
            app_name=app_name,
            environment=environment,
            image=new_image,
            status="pending"
        )
        
        try:
            # 4. 创建适配器（通用架构）
            try:
                adapter = self.factory.create(app_config)
            except NotImplementedError as e:
                # M1：如果配置类型不支持，记录失败
                await db.update_deployment(
                    deploy.id,
                    status="failed",
                    error=str(e)
                )
                await self.feishu.send_error(app_name, str(e))
                return
            
            # 5. 更新配置（通用接口）
            result = await adapter.update_image(new_image)
            await db.update_deployment(
                deploy.id,
                status="committing",
                git_commit=result["git_commit"]
            )
            
            # 6. 触发ArgoCD同步（通用）
            if environment == "dev" and not app_config.argocd_auto_sync:
                await self.argocd.sync(app_config.argocd_application)
            
            # 7. 更新状态（通用）
            await db.update_deployment(deploy.id, status="syncing")
            
            # 8. 飞书通知（通用）
            await self.feishu.send_deploy_started(
                app_name=app_name,
                environment=environment,
                image=new_image,
                deploy_id=str(deploy.id)
            )
        
        except Exception as e:
            await db.update_deployment(
                deploy.id,
                status="failed",
                error=str(e)
            )
            await self.feishu.send_error(app_name, str(e))
```

---

## 四、M1初始化流程

### 项目启动时执行

```python
# scripts/init_applications.py
"""初始化应用配置（M1一次性执行）"""

async def main():
    db = get_database()
    registry = ApplicationRegistry(db)
    
    # 加载测试项目配置
    print("Loading demo-app configuration...")
    app = await registry.load_from_yaml("config/applications/demo-app.yaml")
    
    print(f"Application '{app.name}' registered:")
    print(f"   Config type: {app.config_type}")
    print(f"   Config repo: {app.config_repo_url}")
    print(f"   ArgoCD app: {app.argocd_application}")
    print(f"   Kubernetes namespace: {app.namespace}")
    
    # M1只有1个应用，但架构支持多个
    # 如果有其他应用，继续加载：
    # await registry.load_from_yaml("config/applications/order-api.yaml")

if __name__ == "__main__":
    asyncio.run(main())
```

**执行**：
```bash
# Week 1 Day 1完成数据库迁移后执行
python scripts/init_applications.py
```

---

## 五、M2扩展路径

### M2 Phase 1：前端管理界面（不改后端代码）

**新增前端页面**：
```typescript
// frontend/src/pages/Applications.tsx
function ApplicationsPage() {
  return (
    <div>
      <ApplicationList />  {/* 列表页 */}
      <ApplicationForm />  {/* 配置表单 */}
    </div>
  )
}
```

**新增API（不改现有逻辑）**：
```python
# api/routers/applications.py
@router.post("/api/v1/applications")
async def create_application(app: ApplicationCreate):
    """创建应用配置（M2新增）"""
    registry = ApplicationRegistry(db)
    
    # 复用M1的load_from_api接口
    await registry.load_from_api(app.dict())
    
    return {"status": "ok"}

@router.get("/api/v1/applications")
async def list_applications():
    """列出所有应用（M2新增）"""
    registry = ApplicationRegistry(db)
    
    # 复用M1的list_all接口
    apps = await registry.list_all()
    return apps
```

**关键**：
- Pipeline Orchestrator不需要改
- ApplicationRegistry不需要改
- 只是配置来源从YAML变成API

---

### M2 Phase 2：Helm支持（新增Adapter）

```python
# engines/helm_adapter.py（M2新增文件）
class HelmValuesAdapter(ConfigAdapter):
    """Helm Values适配器（M2新增）"""
    
    def __init__(self, app_config: Application):
        self.app_config = app_config
        self.schema = app_config.config_schema  # 字段映射
    
    async def update_image(self, new_image: str):
        """更新镜像（M2实现）"""
        repo = await GitRepository.clone(self.app_config.config_repo_url)
        
        try:
            # 读取values.yaml
            values_file = repo.get_file_path(self.app_config.config_file_path)
            values = yaml.safe_load(open(values_file))
            
            # 根据schema找到镜像字段
            image_path = self.schema.get("image_tag_path", "image.tag")
            self._set_nested_value(values, image_path, new_image)
            
            # 保存values.yaml
            yaml.safe_dump(values, open(values_file, 'w'))
            
            # 提交Git
            await repo.commit_and_push(...)
        
        finally:
            await repo.cleanup()
```

**ConfigAdapterFactory修改**（只改一行）：
```python
class ConfigAdapterFactory:
    @staticmethod
    def create(app_config: Application) -> ConfigAdapter:
        config_type = app_config.config_type
        
        if config_type == "raw-kubernetes":
            return RawKubernetesAdapter(app_config)
        
        elif config_type == "helm-values":
            # M2：从抛异常改为返回实例
            return HelmValuesAdapter(app_config)  # ← 只改这一行
        
        elif config_type == "kustomize":
            raise NotImplementedError(...)
```

**关键**：
- Pipeline Orchestrator不需要改
- RawKubernetesAdapter不需要改
- 只新增HelmValuesAdapter文件

---

## 六、重构程度对比

### 方案A：M1硬编码

| 模块 | M1代码行数 | M2重构行数 | 重构比例 |
|------|------------|------------|----------|
| 配置存储 | 0 | 200 | 100% |
| 配置加载 | 50 | 50 | 100% |
| Adapter | 100 | 100 | 100% |
| Orchestrator | 200 | 150 | 75% |
| **总计** | **350** | **500** | **85%** |

### 方案B：分层架构方案

| 模块 | M1代码行数 | M2新增行数 | M2修改行数 | 重构比例 |
|------|------------|------------|------------|----------|
| 数据存储层 | 100 | 0 | 0 | 0% |
| 配置加载层 | 150 | 50 | 0 | 0% |
| Adapter工厂 | 50 | 0 | 1 | 2% |
| RawK8sAdapter | 200 | 100 | 0 | 0% |
| HelmAdapter | 0 | 200 | 0 | 新增 |
| Orchestrator | 250 | 0 | 0 | 0% |
| 前端管理 | 0 | 500 | 0 | 新增 |
| **总计** | **750** | **850** | **1** | **0.1%** |

**结论**：
- 方案A：M2需要重构85%的M1代码
- 方案B：M2只需要修改1行代码，其余都是新增

---

## 七、最终建议

### 长期风险判断

如果M1硬编码，M2确实会大量重构。

### 方案可行性

**M1做通用架构**：
- 通用数据层（applications表）
- 通用接口层（ApplicationRegistry）
- 通用工厂层（ConfigAdapterFactory）

**M1只实现最小子集**：
- 只实现RawKubernetesAdapter
- 只实现update_image操作
- YAML配置文件（不做前端）

**M2无缝扩展**：
- 前端替换YAML（不改后端）
- 新增Helm/Kustomize Adapter（不改现有）
- 扩展操作（set_replicas等）

### Week 1可完成

```text
Day 1：applications表 + Registry服务 + demo-app.yaml
Day 2：RawKubernetesAdapter（只实现update_image）
Day 3：ConfigAdapterFactory + Pipeline Orchestrator
Day 4-5：完整链路测试
```

---

## 结论

**采用分层架构方案**：
- M1：数据层和架构层做通用
- M1：实现层只做Raw Kubernetes
- M1：配置用YAML文件
- M2：前端、Helm/Kustomize都是新增，不改M1代码

该方案既满足M1快速验证，也为M2通用产品保留扩展空间。
