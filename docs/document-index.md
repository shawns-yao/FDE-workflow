# 文档索引与分类

**版本**：v1.0  
**日期**：2026-06-16  
**状态**：文档体系入口  

---

## 一、阅读顺序

新成员或实施人员按以下顺序阅读：

1. `docs/document-index.md`：确认文档分类和权威来源。
2. `docs/m1-architecture-decisions.md`：确认 M1 不可违反的架构决策。
3. `docs/permissions-and-credentials.md`：准备 Week 0 权限和凭证。
4. `docs/yaml-change-engine-design.md`：理解 YAML 变更引擎边界。
5. `docs/m1-vs-m2-architecture-strategy.md`：查看 M1 快速验证与 M2 扩展之间的衔接策略。
6. `docs/implementation-plan-week1.md`：执行 Week 1 任务。
7. `docs/risks-and-missing-items.md`：查看必须防住的风险。
8. `docs/DEVELOPMENT-FEASIBILITY.md`：查看进入实现前的阻塞项和可行性判断。
9. `docs/TODO.md`：查看任务状态、缺口和后续延伸内容。

---

## 二、文档分类

| 类别 | 文档 | 用途 | 是否作为实施依据 |
|------|------|------|------------------|
| 产品愿景 | `docs/requirements/product-design.md` | 描述完整 FDE Workstation 五层十二域愿景 | 否，M1只引用愿景方向 |
| 里程碑范围 | `docs/requirements/milestone-1-plan.md` | 描述 M1 从愿景中切出的业务范围 | 是，但以 M1 架构基线为准 |
| M1权威架构 | `docs/m1-architecture-decisions.md` | 统一 ArgoCD、YAML、事件机制、日志、状态机等决策 | 是，最高优先级 |
| 主设计文档 | `docs/superpowers/specs/2026-06-15-fde-workstation-m1-design.md` | M1 总体架构、模块和验收说明 | 是，若冲突以架构基线为准 |
| M1/M2衔接 | `docs/m1-vs-m2-architecture-strategy.md` | 说明 M1 最小实现如何保留 M2 扩展空间 | 否，策略参考，不覆盖 M1 架构基线 |
| 权限凭证 | `docs/permissions-and-credentials.md` | Week 0 权限、Token、RBAC、Secret 准备 | 是 |
| YAML变更引擎 | `docs/yaml-change-engine-design.md` | 配置变更引擎、Adapter、Schema、前端边界 | 是，M1只实现 Raw Kubernetes 子集 |
| Week 1实施 | `docs/implementation-plan-week1.md` | Week 1 拆解、示例代码和验收 | 是，代码块是示例，不是最终可复制代码 |
| 风险缺口 | `docs/risks-and-missing-items.md` | 并发、幂等、回滚、漂移、Secret、审批等风险 | 是，作为设计约束 |
| 开发可行性 | `docs/DEVELOPMENT-FEASIBILITY.md` | 实施前阻塞项、最小验收链路和开发复杂度评估 | 是，作为计划校准依据 |
| 任务跟踪 | `docs/TODO.md` | 任务、缺口、技术债、优化建议 | 是，用于跟踪，不替代设计 |
| M2日志候选 | `docs/m2-log-system-design.md` | 自研日志系统候选方案 | 否，不进入M1 |
| M2知识沉淀候选 | `docs/m2-memory-skill-design.md` | memory、knowledge case、skill候选设计 | 否，不进入M1 |
| 原始Word文档 | `docs/*.docx` | 历史输入和原始需求记录 | 否，作为来源追溯 |

---

## 三、优先级规则

文档之间出现冲突时，按以下优先级处理：

```text
1. docs/m1-architecture-decisions.md
2. docs/permissions-and-credentials.md
3. docs/yaml-change-engine-design.md
4. docs/superpowers/specs/2026-06-15-fde-workstation-m1-design.md
5. docs/m1-vs-m2-architecture-strategy.md
6. docs/implementation-plan-week1.md
7. docs/risks-and-missing-items.md
8. docs/DEVELOPMENT-FEASIBILITY.md
9. docs/TODO.md
10. docs/requirements/*.md
11. docs/*.docx
```

如果低优先级文档与高优先级文档冲突，低优先级文档必须更新或标注为历史内容。

---

## 四、M1实施边界

M1 只验证内部 CI/CD 运维提效闭环，不证明完整 FDE Workstation 产品市场假设。

M1 必做：

- Tekton 构建成功事件接入。
- YAML 变更引擎修改 Git 配置仓库。
- ArgoCD 同步和状态观测。
- Kubernetes 日志和 Events 读取。
- 规则诊断 + LLM 增强。
- 飞书通知和回滚申请。
- 事件幂等、同应用同环境串行、审计记录。

M1 不做：

- ArgoCD Image Updater 主链路。
- 自研 Loki-inspired 日志系统。
- 完整前端配置平台。
- EDD Engine。
- 完整知识库自动沉淀。
- prod 自动同步或自动回滚。
- 任意 YAML path 修改。

---

## 五、历史方案处理规则

历史方案不直接删除，按以下方式处理：

- 能作为后续参考的内容，移动或标注为 M2 / M3 附录。
- 与 M1 权威基线冲突的内容，必须明确标注“不进入 M1”。
- 示例代码如果存在已知错误，必须标注“设计示例，不是最终实现”并修正明显错误。
- 任务计划不能引用已经被降级为 M2 的模块。

---

## 六、当前已统一的关键口径

| 主题 | 统一结论 |
|------|----------|
| 谁改 YAML | YAML 变更引擎 |
| ArgoCD 做什么 | 同步 Git 目标状态、查询 Application 状态、dev 可主动 sync |
| 是否用 Image Updater | M1 不作为主链路 |
| Tekton 如何接入 | Webhook 优先，Watch 备选 |
| 事件机制 | PostgreSQL Outbox 事件表为主，Redis Pub/Sub可选唤醒，Redis Streams作为后续升级 |
| 日志系统 | M1 从 K8s API 实时读取，不存完整日志 |
| 回滚 | 创建 GitLab MR 或 Git 变更申请，不直接回滚集群 |
| 配置变更通用性 | 前端提交业务动作，后端 Adapter 处理 Raw/Helm/Kustomize |
| M1 Adapter | 只实现 Raw Kubernetes 子集 |
