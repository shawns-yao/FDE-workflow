# 文档一致性检查归档

**日期**：2026-06-16  
**检查范围**：所有M1设计文档  
**状态**：已处理归档  

---

## 一、处理结论

上一轮审查发现的主要冲突已按当前权威口径处理：

- ArgoCD 使用方式已统一为 GitOps 优先：YAML 变更引擎修改 Git 配置仓库，ArgoCD 只负责同步和状态观测。
- M1 不再使用 ArgoCD Image Updater 作为主链路。
- M1 不做自研日志系统，候选设计已拆分到 [`docs/m2-log-system-design.md`](m2-log-system-design.md)。
- Memory、知识库和 skill 候选能力已拆分到 [`docs/m2-memory-skill-design.md`](m2-memory-skill-design.md)。
- 主设计文档已删除“简历亮点”章节。
- M1 已明确不以高并发为目标。
- 事件机制已统一为 PostgreSQL Outbox 为主，Redis Pub/Sub 只作为可选 worker 唤醒，Redis Streams 作为后续升级选项。

---

## 二、当前权威口径

以 [`docs/m1-architecture-decisions.md`](m1-architecture-decisions.md) 为最高优先级：

```text
Tekton Webhook
  -> PostgreSQL deployments/events
  -> Worker扫描pending events
  -> YAML变更引擎修改Git
  -> dev环境可触发ArgoCD sync
  -> ArgoCD/K8s状态观测
  -> 失败诊断
  -> 飞书通知或回滚MR
```

---

## 三、已关闭问题

| 问题 | 处理结果 |
|------|----------|
| ArgoCD职责冲突 | 已统一为GitOps优先，不修改Application配置 |
| Redis Streams是否强制 | 已降级为后续升级选项，M1使用PostgreSQL Outbox |
| 自研日志系统是否进入M1 | 已移出主设计，拆分为M2候选文档 |
| 知识库自动沉淀是否进入M1 | 已移出主设计，拆分为M2 memory/skill候选文档 |
| 主设计简历亮点 | 已删除 |
| 高并发表述 | 已改为低并发可靠状态流转 |
| Week 1 YAML引擎缺失 | 已纳入Day 4-5 |
| Alembic asyncpg配置 | 已补充异步env.py说明 |
| 主设计Schema缺表 | 已补充change_requests和audit_logs |
| 回滚API歧义 | 已改为创建回滚MR |

---

## 四、仍需人工确认

这些不是文档冲突，而是实施前需要确认的外部事实：

- 当前测试项目配置类型：Raw Kubernetes YAML、Helm 还是 Kustomize。
- 配置仓库结构：代码仓库和配置仓库是否分离。
- ArgoCD dev 应用是否开启 autoSync。
- Tekton Webhook payload 的实际字段。
- Git 机器人账号是否能写 dev 配置仓库。
- K8s ServiceAccount 是否能读取目标 namespace 的 Pod 日志和 Events。

---

## 五、后续规则

如果后续再次发现文档冲突，按以下优先级处理：

```text
1. docs/m1-architecture-decisions.md
2. docs/document-index.md
3. docs/permissions-and-credentials.md
4. docs/implementation-plan-week1.md
5. docs/superpowers/specs/2026-06-15-fde-workstation-m1-design.md
6. docs/TODO.md
```

