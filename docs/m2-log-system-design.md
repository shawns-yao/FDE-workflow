# M2 日志系统候选设计

**版本**：v1.0  
**日期**：2026-06-16  
**状态**：M2候选，不进入M1实施  

---

## 一、定位

M1 不做自研日志系统。M1 诊断时通过 Kubernetes API 实时读取最近日志，只保存诊断摘要、证据摘要、错误指纹和脱敏关键片段。

本文记录 M2 可能建设的日志系统候选方案，用于后续日志量、查询能力和私有化部署诉求明确后再评估。

---

## 二、是否需要自研

M2 开始前先判断是否已有可复用日志系统：

- 如果客户或内部环境已有 Loki、ELK、OpenSearch 或云日志服务，优先接入现有系统。
- 如果只需要部署失败时读取最近日志，继续使用 Kubernetes API 即可。
- 只有在需要跨应用长期检索、压缩存储、统一查询和私有化独立交付时，才考虑自研日志系统。

---

## 三、候选架构

候选方案借鉴 Loki 的 Stream + Chunk 思路，但不直接依赖 Loki 源码。

```text
K8s Pod Logs
  -> Collector
  -> Stream Labeling
  -> Chunk Split
  -> Compression
  -> Metadata Index
  -> Query API
```

---

## 四、Stream 与 Chunk

**Stream（日志流）**：

```python
stream_labels = {
    "namespace": "production",
    "app": "my-app",
    "pod": "my-app-7d8f9c-abc",
    "container": "main",
    "deploy_id": "uuid"
}
stream_id = hash(sorted(labels))
```

**Chunk（压缩块）**：

```python
chunk = {
    "stream_id": "3a7f2b1c",
    "start_time": "2026-06-15T20:00:00Z",
    "end_time": "2026-06-15T20:05:00Z",
    "lines_count": 12543,
    "compressed_data": b"...",
    "compressed_size": 2100000
}
```

---

## 五、候选 Schema

```sql
CREATE TABLE log_streams (
    stream_id VARCHAR(64) PRIMARY KEY,
    labels JSONB NOT NULL,
    deploy_id UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_stream_labels ON log_streams USING gin(labels);
CREATE INDEX idx_stream_deploy ON log_streams(deploy_id);

CREATE TABLE log_chunks (
    chunk_id UUID PRIMARY KEY,
    stream_id VARCHAR(64) REFERENCES log_streams(stream_id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    lines_count INT,
    compressed_size INT,
    storage_path TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_chunk_time ON log_chunks(stream_id, start_time, end_time);

CREATE TABLE log_chunks_data (
    chunk_id UUID PRIMARY KEY REFERENCES log_chunks(chunk_id),
    compressed_data BYTEA
);
```

---

## 六、候选模块

```text
log_system/
  collector.py   # 从K8s或日志源采集日志
  ingester.py    # 切分、压缩、写入索引
  querier.py     # 按deploy_id、label、keyword查询
  storage.py     # 文件、对象存储或PostgreSQL BYTEA
```

---

## 七、进入 M2 的前置条件

满足以下任意条件，再考虑实现：

- Kubernetes API 实时读取无法满足日志查询响应时间。
- 需要跨部署、跨应用检索历史日志。
- 需要将日志作为独立产品能力交付。
- 客户环境没有可复用日志平台，且日志保留是明确需求。

---

## 八、M1 禁止事项

- 不建立 `log_streams`、`log_chunks`、`log_chunks_data` 表。
- 不保存完整 Pod 原始日志。
- 不把完整日志直接发送给 LLM。
- 不把日志平台能力写入 M1 验收标准。

