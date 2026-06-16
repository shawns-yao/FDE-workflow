# Week 1 实施计划：基础设施 + Pipeline Orchestrator

**时间**：Week 1（5个工作日）  
**目标**：Pipeline Agent跑通端到端流程  
**验收**：Tekton构建完成 → YAML更新 → 部署记录入库

---

## M1实施基线

Week 1 以 [`docs/m1-architecture-decisions.md`](m1-architecture-decisions.md) 为权威口径：

- Pipeline Agent 通过 YAML 变更引擎修改 Git 配置仓库。
- ArgoCD 只用于读取 Application 状态，以及 dev 环境在 Git 提交后主动 sync。
- M1 不集成 ArgoCD Image Updater，不修改 ArgoCD Application annotation。
- Tekton 接入优先使用 Webhook；Watch PipelineRun 只作为备选。
- M1不以高并发为目标，事件机制使用PostgreSQL Outbox事件表；Redis Pub/Sub只作为可选worker唤醒。

---

## Day 1: 项目初始化 + 数据库Schema

### W1-T1: 项目初始化

**创建项目结构**：
```bash
mkdir -p backend/{api,orchestrators,engines,integrations,models,db,workers,shared}
mkdir -p backend/api/routers
mkdir -p config
mkdir -p deploy/{k8s,docker}
mkdir -p tests/{unit,integration}
mkdir -p scripts
```

**配置依赖（pyproject.toml）**：
```toml
[tool.poetry]
name = "fde-workstation"
version = "0.1.0"
description = "FDE Workstation MVP - Agent Trio"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.110.0"
uvicorn = {extras = ["standard"], version = "^0.27.0"}
sqlalchemy = "^2.0.25"
alembic = "^1.13.1"
asyncpg = "^0.29.0"
redis = "^5.0.1"
celery = "^5.3.6"
kubernetes = "^29.0.0"
httpx = "^0.26.0"
pydantic = "^2.5.3"
pydantic-settings = "^2.1.0"
structlog = "^24.1.0"
prometheus-client = "^0.19.0"

[tool.poetry.group.dev.dependencies]
pytest = "^7.4.4"
pytest-asyncio = "^0.23.3"
black = "^24.1.1"
ruff = "^0.1.14"
```

**docker-compose.yml**：
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: fde_workstation
      POSTGRES_USER: fde
      POSTGRES_PASSWORD: fde_dev_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fde"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    build: .
    command: uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --reload
    environment:
      - DATABASE_URL=postgresql+asyncpg://fde:fde_dev_password@postgres:5432/fde_workstation
      - REDIS_URL=redis://redis:6379/0
    volumes:
      - ./backend:/app/backend
      - ./config:/app/config
    ports:
      - "8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  celery_worker:
    build: .
    command: celery -A backend.workers.celery_app worker --loglevel=info
    environment:
      - DATABASE_URL=postgresql+asyncpg://fde:fde_dev_password@postgres:5432/fde_workstation
      - REDIS_URL=redis://redis:6379/0
    volumes:
      - ./backend:/app/backend
      - ./config:/app/config
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
```

**Dockerfile**：
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# 安装Python依赖
COPY pyproject.toml poetry.lock ./
RUN pip install poetry && \
    poetry config virtualenvs.create false && \
    poetry install --no-interaction --no-ansi

COPY . .

CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**验收**：`docker-compose up -d` 启动成功，PostgreSQL、Redis、API、Celery Worker容器运行正常。Celery Worker在Week 1可空转，Week 2承接LLM诊断异步任务。

**说明**：Redis在M1不承载关键事件可靠性。关键事件以PostgreSQL events表为准；Redis仅作为Celery broker、缓存或Pub/Sub唤醒机制使用。

---

### W1-T2: 数据库Schema

**创建Alembic配置**：
```bash
cd backend
alembic init db/migrations
```

**编辑 alembic.ini**：
```ini
sqlalchemy.url = postgresql+asyncpg://fde:fde_dev_password@localhost:5432/fde_workstation
```

**编辑 Alembic 异步 env.py**：
```python
# backend/db/migrations/env.py 关键结构
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from backend.db.base import Base

config = context.config
fileConfig(config.config_file_name)
target_metadata = Base.metadata

def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations():
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()

def run_migrations_online():
    asyncio.run(run_async_migrations())
```

**说明**：因为数据库驱动使用 `asyncpg`，Alembic 的 `env.py` 必须使用 `async_engine_from_config` 和 `connection.run_sync(...)`，不能直接使用同步 engine 模板。

**初始迁移脚本（backend/db/migrations/versions/001_initial.py）**：
```python
"""Initial schema

Revision ID: 001
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

def upgrade():
    # 部署记录表
    op.create_table(
        'deployments',
        sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('app_name', sa.String(100), nullable=False),
        sa.Column('environment', sa.String(50), nullable=False),
        sa.Column('image', sa.String(255), nullable=False),
        sa.Column('tag', sa.String(50), nullable=False),
        sa.Column('commit_sha', sa.String(40)),
        sa.Column('author', sa.String(100)),
        sa.Column('status', sa.String(20), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending','planning','committing','syncing','rolling_out','healthy','degraded','diagnosing','notified','failed','cancelled')",
            name='ck_deployments_status'
        ),
        sa.Column('started_at', sa.DateTime, nullable=False, server_default=sa.text('NOW()')),
        sa.Column('completed_at', sa.DateTime),
        sa.Column('created_at', sa.DateTime, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime, server_default=sa.text('NOW()'))
    )
    
    op.create_index('idx_deploy_status', 'deployments', ['status'])
    op.create_index('idx_deploy_time', 'deployments', ['started_at'], postgresql_ops={'started_at': 'DESC'})
    op.create_index('idx_deploy_app', 'deployments', ['app_name', 'environment'])
    
    # 诊断记录表
    op.create_table(
        'diagnosis_records',
        sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('deploy_id', UUID, sa.ForeignKey('deployments.id', ondelete='CASCADE'), nullable=False),
        sa.Column('root_cause', sa.Text, nullable=False),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('solution', sa.Text, nullable=False),
        sa.Column('confidence', sa.Float, nullable=False),
        sa.Column('method', sa.String(20), nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.text('NOW()'))
    )
    
    op.create_index('idx_diagnosis_deploy', 'diagnosis_records', ['deploy_id'])
    op.create_index('idx_diagnosis_category', 'diagnosis_records', ['category'])
    
    # 事件表
    op.create_table(
        'events',
        sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('event_type', sa.String(50), nullable=False),
        sa.Column('payload', JSONB, nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending','processing','completed','failed','dead_letter')",
            name='ck_events_status'
        ),
        sa.Column('retry_count', sa.Integer, server_default='0'),
        sa.Column('error_message', sa.Text),
        sa.Column('created_at', sa.DateTime, server_default=sa.text('NOW()')),
        sa.Column('processed_at', sa.DateTime)
    )
    
    op.create_index('idx_event_status', 'events', ['status', 'created_at'])
    op.create_index('idx_event_type', 'events', ['event_type'])
    
    # 通知记录表
    op.create_table(
        'notifications',
        sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('deploy_id', UUID, sa.ForeignKey('deployments.id', ondelete='CASCADE'), nullable=False),
        sa.Column('recipient', sa.String(100), nullable=False),
        sa.Column('message_type', sa.String(20), nullable=False),
        sa.Column('card_content', JSONB),
        sa.Column('sent_at', sa.DateTime, server_default=sa.text('NOW()')),
        sa.Column('read_at', sa.DateTime),
        sa.Column('action_taken', sa.String(50))
    )
    
    op.create_index('idx_notif_deploy', 'notifications', ['deploy_id'])

    # 配置变更请求表
    op.create_table(
        'change_requests',
        sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('deploy_id', UUID, sa.ForeignKey('deployments.id', ondelete='CASCADE'), nullable=False),
        sa.Column('app_name', sa.String(100), nullable=False),
        sa.Column('environment', sa.String(50), nullable=False),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('request_payload', JSONB, nullable=False),
        sa.Column('diff_summary', JSONB),
        sa.Column('git_commit_sha', sa.String(40)),
        sa.Column('created_at', sa.DateTime, server_default=sa.text('NOW()')),
        sa.Column('completed_at', sa.DateTime)
    )

    op.create_index('idx_change_deploy', 'change_requests', ['deploy_id'])
    op.create_index('idx_change_app_env', 'change_requests', ['app_name', 'environment'])

    # 审计日志表
    op.create_table(
        'audit_logs',
        sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('actor', sa.String(100), nullable=False),
        sa.Column('source', sa.String(50), nullable=False),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('resource_type', sa.String(50), nullable=False),
        sa.Column('resource_id', sa.String(100), nullable=False),
        sa.Column('metadata', JSONB),
        sa.Column('created_at', sa.DateTime, server_default=sa.text('NOW()'))
    )

    op.create_index('idx_audit_resource', 'audit_logs', ['resource_type', 'resource_id'])

def downgrade():
    op.drop_table('audit_logs')
    op.drop_table('change_requests')
    op.drop_table('notifications')
    op.drop_table('events')
    op.drop_table('diagnosis_records')
    op.drop_table('deployments')
```

**运行迁移**：
```bash
alembic upgrade head
```

**验收**：所有表和索引创建成功，用`\dt`和`\di`验证

---

## Day 2: PostgreSQL Outbox事件机制

### W1-T3: PostgreSQL Outbox事件机制

**实现事件仓储（backend/shared/event_bus.py）**：
```python
from datetime import datetime
from typing import Any
import structlog

logger = structlog.get_logger()

class EventBus:
    """PostgreSQL Outbox事件机制，Redis Pub/Sub只作为可选唤醒"""

    def __init__(self, db, redis_client=None):
        self.db = db
        self.redis = redis_client

    async def publish(self, event_type: str, payload: dict[str, Any], idempotency_key: str) -> str:
        """写入PostgreSQL events表，作为唯一可靠事件源"""
        event = await self.db.create_event(
            event_type=event_type,
            payload=payload,
            status="pending",
            idempotency_key=idempotency_key,
            created_at=datetime.utcnow(),
        )

        if self.redis:
            await self.redis.publish("fde.events", event_type)

        logger.info("event_created", event_type=event_type, event_id=str(event.id))
        return str(event.id)

    async def claim_pending(self, limit: int = 10):
        """领取待处理事件，实际SQL使用FOR UPDATE SKIP LOCKED"""
        return await self.db.claim_pending_events(limit=limit)

    async def mark_completed(self, event_id: str):
        await self.db.update_event_status(event_id, status="completed")

    async def mark_failed(self, event_id: str, error_message: str):
        await self.db.increment_event_retry(event_id, error_message=error_message)
```

**事件领取SQL语义**：
```sql
SELECT *
FROM events
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

**Worker补偿扫描**：
```python
async def scan_pending_events():
    while True:
        events = await event_bus.claim_pending(limit=10)
        for event in events:
            await handle_event(event)
        await asyncio.sleep(3)
```

**验收**：关键事件写入PostgreSQL events表；worker能扫描pending事件；重复idempotency_key不会重复创建部署；Redis Pub/Sub丢失时定时扫描仍能处理事件。

---

## Day 3: Pipeline Orchestrator

### W1-T4: Pipeline Orchestrator

**实现Pipeline Orchestrator（backend/orchestrators/pipeline.py）**：
```python
import structlog
from backend.shared.event_bus import EventBus
from backend.models.deployment import Deployment
from backend.integrations.tekton import TektonClient
from backend.db.session import get_db

logger = structlog.get_logger()

class PipelineOrchestrator:
    """管道编排器：监听Tekton → 记录部署 → 发布事件"""
    
    def __init__(self, event_bus: EventBus, tekton_client: TektonClient):
        self.event_bus = event_bus
        self.tekton = tekton_client
    
    async def start(self):
        """启动监听Tekton事件"""
        logger.info("pipeline_orchestrator_started")
        
        async for message_id, payload in self.event_bus.consume(
            "tekton.pipelinerun.completed", 
            "pipeline-orchestrator"
        ):
            try:
                await self.handle_build_complete(payload)
                await self.event_bus.ack("tekton.pipelinerun.completed", message_id)
            except Exception as e:
                logger.error("handle_build_error", error=str(e), payload=payload)
    
    async def handle_build_complete(self, payload: dict):
        """处理构建完成事件"""
        app_name = payload["app_name"]
        image = payload["image"]
        tag = payload["tag"]
        commit_sha = payload.get("commit_sha")
        author = payload.get("author")
        environment = payload.get("environment", "dev")
        
        # 创建部署记录
        async with get_db() as db:
            deployment = Deployment(
                app_name=app_name,
                environment=environment,
                image=image,
                tag=tag,
                commit_sha=commit_sha,
                author=author,
                status="pending"
            )
            db.add(deployment)
            await db.commit()
            
            logger.info(
                "deployment_created",
                deploy_id=str(deployment.id),
                app_name=app_name,
                image=f"{image}:{tag}"
            )
            
            # 发布deploy.started事件
            await self.event_bus.publish("deploy.started", {
                "deploy_id": str(deployment.id),
                "app_name": app_name,
                "environment": environment,
                "image": image,
                "tag": tag,
                "commit_sha": commit_sha,
                "author": author
            })
```

**Tekton Webhook解析（backend/integrations/tekton.py）**：
```python
import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()

class TektonBuildEvent(BaseModel):
    """Tekton成功构建事件"""
    application: str
    environment: str = "dev"
    image_ref: str
    commit_sha: str
    pipeline_run_id: str
    author: str | None = None
    status: str = Field(pattern="^Succeeded$")

class TektonWebhookParser:
    """Tekton Webhook事件解析器"""

    def parse(self, payload: dict) -> TektonBuildEvent:
        """解析Tekton回调payload"""
        event = TektonBuildEvent(**payload)
        logger.info(
            "tekton_event_parsed",
            application=event.application,
            environment=event.environment,
            pipeline_run_id=event.pipeline_run_id
        )
        return event

    def to_deploy_payload(self, event: TektonBuildEvent) -> dict:
        """转换为部署事件payload"""
        image, tag = event.image_ref.rsplit(":", 1)
        return {
            "app_name": event.application,
            "image": image,
            "tag": tag,
            "image_ref": event.image_ref,
            "commit_sha": event.commit_sha,
            "author": event.author,
            "environment": event.environment,
            "pipeline_run_id": event.pipeline_run_id
        }
```

**备选说明**：如后续必须Watch PipelineRun，`status.pipelineResults` 和 `spec.params` 都应按数组解析，不可按字典 `.get()` 读取。

**验收**：能接收Tekton构建成功Webhook，校验`Succeeded`状态，部署记录入库

---

## Day 4-5: YAML变更引擎 + Git提交 + ArgoCD同步

### W1-T5: YAML变更引擎 + Git提交 + ArgoCD同步

**YAML变更引擎（backend/engines/yaml_change_engine.py）**：
```python
from dataclasses import dataclass
from pathlib import Path
import yaml

@dataclass
class ImageUpdateRequest:
    app_name: str
    environment: str
    config_file: Path
    resource_kind: str
    resource_name: str
    container_name: str
    image_ref: str

class RawKubernetesAdapter:
    """M1 Raw Kubernetes YAML适配器"""

    def update_image(self, request: ImageUpdateRequest) -> dict:
        """结构化更新Deployment容器镜像"""
        docs = list(yaml.safe_load_all(request.config_file.read_text(encoding="utf-8")))

        changed = False
        for doc in docs:
            if not doc:
                continue
            if doc.get("kind") != request.resource_kind:
                continue
            if doc.get("metadata", {}).get("name") != request.resource_name:
                continue

            containers = (
                doc["spec"]["template"]["spec"]
                .get("containers", [])
            )
            for container in containers:
                if container.get("name") == request.container_name:
                    old_image = container.get("image")
                    container["image"] = request.image_ref
                    changed = True
                    break

        if not changed:
            raise ValueError("未找到目标Deployment或容器")

        request.config_file.write_text(
            yaml.safe_dump_all(docs, sort_keys=False, allow_unicode=True),
            encoding="utf-8"
        )

        return {
            "action": "update_image",
            "resource": f"{request.resource_kind}/{request.resource_name}",
            "container": request.container_name,
            "image": request.image_ref
        }
```

**Git配置仓库集成（backend/integrations/git.py）**：
```python
from pathlib import Path

class GitConfigClient:
    """Git配置仓库客户端"""

    async def checkout_worktree(self, repo_url: str, branch: str, deploy_id: str) -> Path:
        """为每个部署任务创建独立工作目录"""
        # 示例：实际实现需封装git clone/fetch/checkout并处理清理
        ...

    async def commit_and_push(self, worktree: Path, message: str) -> str:
        """提交并推送配置变更"""
        # 示例：提交前必须拉取最新分支，并处理冲突
        ...
```

**ArgoCD集成（backend/integrations/argocd.py）**：
```python
import httpx
import structlog

logger = structlog.get_logger()

class ArgoCDClient:
    """ArgoCD API客户端：只读状态 + dev环境sync"""
    
    def __init__(self, server_url: str, token: str):
        self.server_url = server_url
        self.headers = {"Authorization": f"Bearer {token}"}
        self.client = httpx.AsyncClient()
    
    async def trigger_sync(self, application_name: str, environment: str):
        """触发同步（仅dev环境）"""
        if environment != "dev":
            raise PermissionError("M1只允许dev环境主动触发ArgoCD sync")

        sync_response = await self.client.post(
            f"{self.server_url}/api/v1/applications/{application_name}/sync",
            headers=self.headers,
            json={"prune": False, "dryRun": False}
        )
        sync_response.raise_for_status()
        
        logger.info(
            "argocd_sync_triggered",
            app_name=application_name,
            environment=environment
        )
    
    async def get_application_status(self, app_name: str, environment: str) -> dict:
        """获取Application状态"""
        application_name = f"{app_name}-{environment}"
        
        response = await self.client.get(
            f"{self.server_url}/api/v1/applications/{application_name}",
            headers=self.headers
        )
        response.raise_for_status()
        
        app = response.json()
        return {
            "sync_status": app['status']['sync']['status'],
            "health_status": app['status']['health']['status']
        }
```

**在Pipeline Orchestrator中集成**：
```python
# 在handle_build_complete中添加
from backend.integrations.argocd import ArgoCDClient
from backend.engines.yaml_change_engine import RawKubernetesAdapter, ImageUpdateRequest

argocd = ArgoCDClient(
    server_url=config.ARGOCD_SERVER,
    token=config.ARGOCD_TOKEN
)

adapter = RawKubernetesAdapter()
change = adapter.update_image(ImageUpdateRequest(
    app_name=app_name,
    environment=environment,
    config_file=config_file,
    resource_kind="Deployment",
    resource_name=app_name,
    container_name=app_name,
    image_ref=f"{image}:{tag}"
))

git_commit_sha = await git_client.commit_and_push(
    worktree=worktree,
    message=f"feat: 更新{app_name}镜像到{tag}"
)

if environment == "dev":
    await argocd.trigger_sync(application_name=argocd_app, environment=environment)
```

**验收**：Raw Kubernetes YAML结构化更新成功，Git提交成功，dev环境ArgoCD开始同步

---

## Week 1 总验收

**端到端测试脚本（scripts/test_week1.sh）**：
```bash
#!/bin/bash

echo "=== Week 1 端到端测试 ==="

# 1. 模拟Tekton构建完成事件
echo "1. 调用Tekton Webhook模拟构建完成事件..."
curl -X POST http://localhost:8000/api/v1/webhooks/tekton \
  -H "Content-Type: application/json" \
  -d '{"application":"test-app","environment":"dev","image_ref":"registry.com/test-app:v1.0.0","commit_sha":"abc123","pipeline_run_id":"test-run-001","author":"developer","status":"Succeeded"}'

# 2. 等待5秒
echo "2. 等待Pipeline Orchestrator处理..."
sleep 5

# 3. 检查部署记录
echo "3. 检查部署记录..."
psql -U fde -d fde_workstation -c "SELECT id, app_name, image, tag, status FROM deployments ORDER BY created_at DESC LIMIT 1;"

# 4. 检查events表
echo "4. 检查events表..."
psql -U fde -d fde_workstation -c "SELECT id, event_type, status, retry_count FROM events ORDER BY created_at DESC LIMIT 5;"

echo "=== 测试完成 ==="
```

**验收标准**：
- [ ] Tekton事件能被捕获
- [ ] 部署记录成功入库
- [ ] deploy.started事件写入PostgreSQL events表
- [ ] YAML变更引擎生成结构化变更
- [ ] Git配置仓库提交成功
- [ ] dev环境ArgoCD同步被触发

---

## 配置文件

**config/development.yaml**：
```yaml
database:
  url: postgresql+asyncpg://fde:fde_dev_password@postgres:5432/fde_workstation

redis:
  url: redis://redis:6379/0

argocd:
  server: https://argocd.example.com
  token: ${ARGOCD_TOKEN}

tekton:
  namespace: tekton-pipelines

logging:
  level: INFO
  format: json
```

---

**Week 1完成标志**：
✅ docker-compose启动成功  
✅ 数据库表和索引全部创建  
✅ PostgreSQL Outbox事件机制工作正常  
✅ Pipeline Orchestrator能接收Tekton Webhook  
✅ YAML变更引擎更新Raw Kubernetes配置  
✅ Git提交成功，dev环境ArgoCD同步成功  
✅ 端到端测试通过
