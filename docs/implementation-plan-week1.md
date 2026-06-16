# Week 1 实施计划：基础设施 + Pipeline Orchestrator

**时间**：Week 1（5个工作日）  
**目标**：Pipeline Agent跑通端到端流程  
**验收**：Tekton构建完成 → YAML更新 → 部署记录入库

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

**验收**：`docker-compose up -d` 启动成功，三个容器运行正常

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

def downgrade():
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

## Day 2: Redis Streams事件总线

### W1-T3: Redis Streams事件总线

**实现事件总线（backend/shared/event_bus.py）**：
```python
import redis.asyncio as redis
import json
from typing import Dict, Any, Optional
from datetime import datetime
import structlog

logger = structlog.get_logger()

class EventBus:
    """基于Redis Streams的可靠事件总线"""
    
    def __init__(self, redis_url: str):
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.consumer_group = "fde-workstation"
        
    async def initialize(self):
        """初始化消费者组"""
        streams = ["deploy.started", "diagnosis.completed"]
        for stream in streams:
            try:
                await self.redis.xgroup_create(
                    stream, self.consumer_group, id='0', mkstream=True
                )
            except redis.ResponseError as e:
                if "BUSYGROUP" not in str(e):
                    raise
    
    async def publish(self, event_type: str, payload: Dict[str, Any]) -> str:
        """发布事件到Redis Streams"""
        event_id = await self.redis.xadd(
            event_type,
            {
                "payload": json.dumps(payload),
                "timestamp": datetime.utcnow().isoformat()
            }
        )
        logger.info("event_published", event_type=event_type, event_id=event_id)
        return event_id
    
    async def consume(
        self, 
        event_type: str, 
        consumer_name: str,
        block: int = 5000,
        count: int = 10
    ):
        """消费事件（使用消费者组，支持ACK）"""
        while True:
            try:
                events = await self.redis.xreadgroup(
                    self.consumer_group,
                    consumer_name,
                    {event_type: '>'},
                    count=count,
                    block=block
                )
                
                for stream, messages in events:
                    for message_id, data in messages:
                        payload = json.loads(data['payload'])
                        yield message_id, payload
                        
            except Exception as e:
                logger.error("consume_error", error=str(e))
                await asyncio.sleep(1)
    
    async def ack(self, event_type: str, message_id: str):
        """确认消息已处理"""
        await self.redis.xack(event_type, self.consumer_group, message_id)
        logger.debug("event_acked", event_type=event_type, message_id=message_id)
```

**测试事件总线（tests/unit/test_event_bus.py）**：
```python
import pytest
from backend.shared.event_bus import EventBus

@pytest.mark.asyncio
async def test_publish_and_consume():
    bus = EventBus("redis://localhost:6379/1")
    await bus.initialize()
    
    # 发布事件
    event_id = await bus.publish("test.event", {"data": "test"})
    assert event_id is not None
    
    # 消费事件
    consumer = bus.consume("test.event", "test-consumer")
    message_id, payload = await consumer.__anext__()
    
    assert payload["data"] == "test"
    await bus.ack("test.event", message_id)
```

**验收**：事件可靠传递，消费者组正常工作，支持ACK

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

**Tekton集成（backend/integrations/tekton.py）**：
```python
from kubernetes import client, config, watch
import structlog

logger = structlog.get_logger()

class TektonClient:
    """Tekton API客户端"""
    
    def __init__(self):
        config.load_incluster_config()
        self.custom_api = client.CustomObjectsApi()
    
    async def watch_pipelinerun_events(self):
        """监听PipelineRun事件"""
        w = watch.Watch()
        for event in w.stream(
            self.custom_api.list_namespaced_custom_object,
            group="tekton.dev",
            version="v1",
            namespace="tekton-pipelines",
            plural="pipelineruns"
        ):
            event_type = event['type']
            obj = event['object']
            
            if event_type == "MODIFIED" and obj['status'].get('conditions'):
                condition = obj['status']['conditions'][0]
                if condition['type'] == 'Succeeded' and condition['status'] == 'True':
                    yield self.extract_build_info(obj)
    
    def extract_build_info(self, pipelinerun: dict) -> dict:
        """从PipelineRun提取构建信息"""
        metadata = pipelinerun['metadata']
        spec = pipelinerun['spec']
        status = pipelinerun['status']
        
        return {
            "app_name": metadata['labels'].get('app'),
            "image": status['pipelineResults'].get('image'),
            "tag": status['pipelineResults'].get('tag'),
            "commit_sha": spec['params'].get('git-revision'),
            "author": spec['params'].get('git-author'),
            "environment": metadata['labels'].get('environment', 'dev')
        }
```

**验收**：能捕获Tekton构建完成事件，部署记录入库

---

## Day 4-5: ArgoCD Image Updater集成

### W1-T5: 集成ArgoCD Image Updater

**ArgoCD集成（backend/integrations/argocd.py）**：
```python
import httpx
import structlog

logger = structlog.get_logger()

class ArgoCDClient:
    """ArgoCD API客户端"""
    
    def __init__(self, server_url: str, token: str):
        self.server_url = server_url
        self.headers = {"Authorization": f"Bearer {token}"}
        self.client = httpx.AsyncClient()
    
    async def trigger_image_update(
        self, 
        app_name: str, 
        environment: str, 
        image: str, 
        tag: str
    ):
        """触发ArgoCD Image Updater检查更新"""
        # 方法1：通过Annotation触发（推荐）
        application_name = f"{app_name}-{environment}"
        
        # 获取Application
        response = await self.client.get(
            f"{self.server_url}/api/v1/applications/{application_name}",
            headers=self.headers
        )
        response.raise_for_status()
        
        app = response.json()
        
        # 更新Annotation触发Image Updater
        app['metadata']['annotations']['argocd-image-updater.argoproj.io/image-list'] = \
            f"app={image}"
        
        # 或者方法2：直接触发同步
        sync_response = await self.client.post(
            f"{self.server_url}/api/v1/applications/{application_name}/sync",
            headers=self.headers,
            json={"prune": False, "dryRun": False}
        )
        sync_response.raise_for_status()
        
        logger.info(
            "argocd_sync_triggered",
            app_name=application_name,
            image=f"{image}:{tag}"
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

argocd = ArgoCDClient(
    server_url=config.ARGOCD_SERVER,
    token=config.ARGOCD_TOKEN
)

await argocd.trigger_image_update(
    app_name=app_name,
    environment=environment,
    image=image,
    tag=tag
)
```

**验收**：YAML自动更新成功，ArgoCD开始同步

---

## Week 1 总验收

**端到端测试脚本（scripts/test_week1.sh）**：
```bash
#!/bin/bash

echo "=== Week 1 端到端测试 ==="

# 1. 模拟Tekton构建完成事件
echo "1. 发布模拟构建完成事件..."
redis-cli XADD tekton.pipelinerun.completed \* \
  payload '{"app_name":"test-app","image":"registry.com/test-app","tag":"v1.0.0","commit_sha":"abc123","author":"developer","environment":"dev"}'

# 2. 等待5秒
echo "2. 等待Pipeline Orchestrator处理..."
sleep 5

# 3. 检查部署记录
echo "3. 检查部署记录..."
psql -U fde -d fde_workstation -c "SELECT id, app_name, image, tag, status FROM deployments ORDER BY created_at DESC LIMIT 1;"

# 4. 检查deploy.started事件
echo "4. 检查deploy.started事件..."
redis-cli XREAD COUNT 1 STREAMS deploy.started 0

echo "=== 测试完成 ==="
```

**验收标准**：
- [ ] Tekton事件能被捕获
- [ ] 部署记录成功入库
- [ ] deploy.started事件发布成功
- [ ] ArgoCD同步被触发

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
✅ Redis Streams事件总线工作正常  
✅ Pipeline Orchestrator能捕获Tekton事件  
✅ ArgoCD Image Updater集成成功  
✅ 端到端测试通过
