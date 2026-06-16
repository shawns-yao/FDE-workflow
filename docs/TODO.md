# FDE Workstation 里程碑一 - 开发进度跟踪（v1.1）

**更新时间**：2026-06-15  
**项目周期**：3周（MVP验证期）  
**当前状态**：🟢 设计评审通过，准备启动

---

## 📊 总体进度（v1.1调整）

- [ ] Week 0: 前置准备（权限与凭证）(0/7) ⚠️ **必须先完成**
- [ ] Week 1: 基础设施 + Pipeline Orchestrator (0/5)
- [ ] Week 2: 诊断引擎 + 飞书通知 (0/7)
- [ ] Week 3: API + 失败场景测试 + 交付 (0/5)

**完成率**：0% (0/24)

**⚠️ 重要提醒**：Week 0的权限准备是Week 1的阻塞任务，必须先完成！

---

## 🎯 M1核心目标（v1.1收敛）

### 唯一目标
跑通"Tekton构建 → ArgoCD部署 → 自动诊断 → 飞书通知"的最短闭环

### 业务指标（可验证）
- [ ] 镜像更新人工耗时：5-10分钟 → <30秒
- [ ] 诊断报告生成时间：2小时 → <5分钟（限定Top 10错误）
- [ ] 人工交互次数：5-10轮 → 0-2轮（仅确定性故障）
- [ ] 通知送达延迟：不定时 → <1分钟

### 技术指标
- [ ] 规则引擎响应时间 < 3秒
- [ ] LLM诊断准确率 > 85%
- [ ] API响应时间 < 500ms
- [ ] 失败场景降级策略生效

---

## Week 0: 前置准备（权限与凭证）⚠️

**必须在Week 1 Day 1前完成**

### 必须准备的凭证

- [ ] **Git机器人账号**
  - [ ] 创建机器人账号（如fde-bot@company.com）
  - [ ] 生成SSH Key或Personal Access Token
  - [ ] 授予dev环境配置仓库写权限
  - [ ] 授予staging/prod配置仓库创建MR权限

- [ ] **ArgoCD低权限Token**
  - [ ] 创建ArgoCD本地账号（fde-pipeline）
  - [ ] 配置RBAC（只读Application + dev环境同步）
  - [ ] 生成Token（90天过期）
  - [ ] 验证权限正确（不能操作staging/prod）

- [ ] **K8s ServiceAccount**
  - [ ] 创建ServiceAccount（fde-diagnosis）
  - [ ] 创建Role（只读Pod/日志/Events/Deployment）
  - [ ] 绑定RoleBinding（每个环境独立）
  - [ ] 验证权限最小化

- [ ] **Tekton Webhook配置**
  - [ ] 配置Tekton EventListener
  - [ ] 生成Webhook Secret
  - [ ] 测试回调URL可达

- [ ] **飞书应用**
  - [ ] 创建飞书应用
  - [ ] 获取App ID和App Secret
  - [ ] 配置Webhook回调地址
  - [ ] 配置签名验证Token

- [ ] **LLM API Key**
  - [ ] 获取Claude Opus 4.7 API Key
  - [ ] 配置成本限制
  - [ ] 测试API可用性

- [ ] **配置映射文件**
  - [ ] 编写app-mappings.yaml（应用到Git/ArgoCD/K8s/飞书的映射）
  - [ ] 编写环境策略配置
  - [ ] 验证所有应用都有完整映射

**验收**：所有凭证已存储到K8s Secret，权限已验证最小化

---

## Week 1: 基础设施 + Pipeline Orchestrator（5任务）

**目标**：Pipeline Agent跑通端到端流程

### 任务清单

- [ ] **W1-T1**: 项目初始化
  - [ ] 创建项目目录结构
  - [ ] 配置Poetry/pip依赖（FastAPI、SQLAlchemy、Redis、K8s客户端）
  - [ ] 编写docker-compose.yml（PostgreSQL、Redis）
  - [ ] 验证：\`docker-compose up -d\`启动成功

- [ ] **W1-T2**: 数据库Schema
  - [ ] 编写SQL脚本（deployments、diagnosis_records、events表）
  - [ ] 配置Alembic迁移
  - [ ] 创建所有索引
  - [ ] 验证：所有表和索引创建成功

- [ ] **W1-T3**: Redis Streams事件总线
  - [ ] 实现\`shared/event_bus.py\`（Pub/Sub封装）
  - [ ] 消费者组配置
  - [ ] 事件重试逻辑
  - [ ] 验证：事件可靠传递，幂等性保证

- [ ] **W1-T4**: Pipeline Orchestrator
  - [ ] 实现\`orchestrators/pipeline.py\`
  - [ ] 监听Tekton PipelineRun完成事件
  - [ ] 提取镜像信息（registry/image:tag）
  - [ ] 创建部署记录到PostgreSQL
  - [ ] 发布"deploy.started"事件
  - [ ] 验证：捕获构建完成事件，记录入库

- [ ] **W1-T5**: 集成ArgoCD Image Updater
  - [ ] 实现\`integrations/argocd.py\`
  - [ ] 调用ArgoCD API触发Image Updater
  - [ ] 或通过Annotation自动触发
  - [ ] 验证：YAML自动更新成功

**Week 1验收**：
- [ ] Tekton构建完成 → YAML更新 → 部署记录入库

---

## Week 2: 诊断引擎 + 飞书通知（7任务）

**目标**：Diagnosis Agent能自动诊断并通知

### 任务清单

- [ ] **W2-T1**: Diagnosis Orchestrator
  - [ ] 实现\`orchestrators/diagnosis.py\`
  - [ ] 订阅"deploy.started"事件
  - [ ] 监听ArgoCD Application状态
  - [ ] 识别Degraded/Failed状态
  - [ ] 验证：捕获部署失败状态

- [ ] **W2-T2**: K8s数据采集
  - [ ] 实现\`integrations/kubernetes.py\`
  - [ ] 从K8s API读取Pod日志（最近500行）
  - [ ] 获取K8s Events
  - [ ] 获取Git commit信息
  - [ ] 验证：完整数据采集成功

- [ ] **W2-T3**: 规则引擎
  - [ ] 实现\`engines/rule_engine.py\`
  - [ ] 定义Top 10常见错误规则
  - [ ] 错误模式匹配逻辑（正则表达式）
  - [ ] 置信度计算
  - [ ] 验证：准确率>90%，响应<3秒

- [ ] **W2-T4**: LLM诊断引擎
  - [ ] 实现\`engines/llm_client.py\`
  - [ ] Claude Opus 4.7 API集成
  - [ ] Prompt工程（输入输出格式）
  - [ ] 结构化输出解析（JSON）
  - [ ] 验证：输出包含root_cause/solution/confidence

- [ ] **W2-T5**: 诊断编排逻辑
  - [ ] 实现\`engines/diagnosis_engine.py\`
  - [ ] 规则引擎优先（置信度>=0.8直接返回）
  - [ ] LLM增强（规则未匹配时调用）
  - [ ] 降级策略（LLM超时返回规则诊断）
  - [ ] 验证：完整诊断流程跑通

- [ ] **W2-T6**: 飞书Webhook + 卡片
  - [ ] 实现\`integrations/feishu.py\`
  - [ ] 飞书Webhook签名验证
  - [ ] 失败诊断卡片模板
  - [ ] 成功部署通知模板
  - [ ] 验证：通知送达，展示诊断摘要

- [ ] **W2-T7**: Collaboration Orchestrator + 回滚申请
  - [ ] 实现\`orchestrators/collaboration.py\`
  - [ ] 智能路由逻辑（根据category决定@谁）
  - [ ] 飞书回调处理（/feishu/callback）
  - [ ] "申请回滚"按钮 → 创建GitLab MR
  - [ ] "查看日志"按钮 → 返回日志URL
  - [ ] 验证：回滚MR创建成功

**Week 2验收**：
- [ ] 注入故障 → 规则/LLM诊断 → 飞书通知 → 回滚申请

---

## Week 3: API + 失败场景测试 + 交付（5任务）

**目标**：完整闭环演示 + 失败场景验证

### 任务清单

- [ ] **W3-T1**: 最小API
  - [ ] 实现\`api/routers/deployments.py\`
  - [ ] GET /api/v1/deployments（部署列表）
  - [ ] GET /api/v1/deployments/{id}（部署详情+诊断）
  - [ ] GET /api/v1/logs/{deploy_id}（从K8s读日志）
  - [ ] GET /health（健康检查）
  - [ ] 验证：响应时间<500ms

- [ ] **W3-T2**: 失败场景测试
  - [ ] 事件重复投递测试（幂等性）
  - [ ] ArgoCD API不可用测试（降级）
  - [ ] K8s权限不足测试（错误提示）
  - [ ] LLM超时测试（规则引擎兜底）
  - [ ] 飞书发送失败测试（状态记录）
  - [ ] 验证：所有失败场景不崩溃

- [ ] **W3-T3**: 安全增强
  - [ ] K8s权限最小化（只读Pod/Events）
  - [ ] 日志脱敏（密钥、Token正则替换）
  - [ ] 飞书签名验证
  - [ ] GitLab API Token管理（K8s Secret）
  - [ ] 验证：权限审计通过

- [ ] **W3-T4**: 性能测试
  - [ ] 规则引擎响应时间测试（<3秒）
  - [ ] LLM诊断响应时间测试（<10秒）
  - [ ] API压测（Apache Bench）
  - [ ] LLM成本统计
  - [ ] 验证：性能指标达标

- [ ] **W3-T5**: 集成测试 + 部署文档
  - [ ] 端到端集成测试
  - [ ] 编写README.md
  - [ ] 编写部署指南（docker-compose + K8s）
  - [ ] API文档（Swagger/OpenAPI）
  - [ ] 验证：能按文档部署成功

**Week 3验收**：
- [ ] 完整闭环演示（3次成功）
- [ ] 5个失败场景测试通过
- [ ] 部署文档可用

---

## 🐛 已知问题

_暂无_

---

## 📝 技术债务

_暂无_

---

## 💡 优化建议

_待Week 1-2实施后补充_

---

## 🚫 M1明确不做（推迟到M2）

- 自研日志系统（Loki-inspired）
- 完整前端（React + ECharts）
- 评估驱动引擎
- 知识库自动沉淀
- 多环境复杂策略
- 工单系统深度集成

---

## 📚 参考资料

- [设计文档v1.1](superpowers/specs/2026-06-15-fde-workstation-m1-design.md)
- [里程碑计划](requirements/milestone-1-plan.md)
- [产品设计](requirements/product-design.md)

---

**更新规则**：
- 每完成一个任务，在对应任务前打勾 ✅
- 每天更新一次总体进度
- 遇到问题记录在"已知问题"
- 技术债务及时记录，避免遗忘
