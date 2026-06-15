
FDE Workstation 里程碑一开发计划

里程碑周期: 3周（MVP验证期） 

目标: 以公司内部运维CI/CD提效需求为实践抓手，交付FDE Workstation MVP + 运维提效Agent，验证"平台+FDE"模式的可行性

## 一、里程碑目标（Milestone Goals）

### 1.1 业务目标

### 1.2 产品目标

## 二、运维场景深度分析

### 2.1 现状流程图（As-Is）

开发者推送代码 → GitLab → Tekton自动构建镜像 → [人工卡点1] → 

运维同学手动复制镜像名 → 打开CI/CD配置仓库 → 修改YAML中的镜像标签 → 

提交PR/MR → ArgoCD检测到配置变更 → 自动同步部署 → 

[人工卡点2] 部署失败/异常 → 开发在群里@运维 → 运维查看ArgoCD日志 → 

看不懂/需要开发协助 → 开发查看代码 → 本地修复验证提交代码 → 重新推送 → 

回到起点，循环3-5轮 → 最终上线

总耗时: 简单更新30分钟-2小时，复杂问题半天到3天

人工交互: 5-10轮（开发↔运维）

出错点: 镜像名复制错误、YAML格式错误、资源竞态错误、服务依赖错误、分支配置错误、漏更新关联服务

### 2.2 痛点优先级矩阵

### 2.3 用户角色（内部客户）

## 三、解决方案设计：运维提效Agent Trio

### 3.1 三Agent架构

┌─────────────────────────────────────────────────────────────┐

│                  运维提效Agent Trio                          │

├─────────────────────────────────────────────────────────────┤

│                                                             │

│  ┌──────────────────┐    ┌──────────────────┐              │

│  │  Pipeline Agent  │───→│  Diagnosis Agent │              │

│  │  (管道代理)       │    │  (诊断代理)       │              │

│  │                  │    │                  │              │

│  │ • 监听Tekton事件  │    │ • 监听ArgoCD状态  │              │

│  │ • 自动更新YAML   │    │ • 收集K8s事件     │              │

│  │ • 触发ArgoCD同步 │    │ • 日志聚合分析    │              │

│  │ • 通知相关人员   │    │ • 根因定位        │              │

│  └──────────────────┘    │ • 修复建议生成    │              │

│           │              └──────────────────┘              │

│           │                      │                         │

│           └──────────────────────┘                         │

│                      │                                      │

│                      ↓                                      │

│           ┌──────────────────┐                            │

│           │  Collaboration   │                            │

│           │  Agent (协作代理) │                            │

│           │                  │                            │

│           │ • 汇总问题状态   │                            │

│           │ • 自动分配责任人 │                            │

│           │ • 推送通知到IM   │                            │

│           │ • 追踪修复进度   │                            │

│           │ • 生成日报/周报  │                            │

│           └──────────────────┘                            │

│                                                             │

└─────────────────────────────────────────────────────────────┘

### 3.2 Agent 1: Pipeline Agent（管道代理）

职责：打通Tekton → GitLab配置仓库 → ArgoCD的自动化链路

工作流：

1. 监听Tekton PipelineRun完成事件（通过Tekton EventListener或轮询）

2. 提取新构建的镜像名称和Tag（如: registry.company.com/app:v1.2.3-abc123）

3. 自动克隆/更新CI/CD专属GitLab配置仓库

4. 根据规则定位需要更新的YAML文件（支持Kustomize/Helm/纯YAML）

5. 自动修改镜像标签，生成Git Commit（含构建信息、提交者、变更摘要）

6. 自动Push到配置仓库（直接提交或创建MR，根据策略）

7. 可选：自动触发ArgoCD Application同步（通过ArgoCD API）

8. 通知：向飞书推送"构建→部署"链路完成通知

关键能力：

多镜像识别：一次构建产出多个镜像（前端+后端+Sidecar），自动识别并更新对应YAML

配置策略灵活：支持直接提交（dev环境）或创建MR（prod环境）

安全校验：更新前校验镜像是否存在于仓库、YAML语法是否正确

回滚能力：保留历史版本，支持一键回滚到上一个稳定镜像

### 3.3 Agent 2: Diagnosis Agent（诊断代理）

职责：ArgoCD部署后自动监控、自动诊断、自动报告

工作流：

1. 监听ArgoCD Application状态变化（同步中→同步失败/健康/降级）

2. 当状态为非"Healthy"时，自动进入诊断模式：

   a. 收集ArgoCD同步日志和错误信息

   b. 查询K8s Events（kubectl get events --sort-by='.lastTimestamp'）

   c. 获取Pod状态和日志（最近失败的Pod）

   d. 检查资源限制（CPU/Memory/磁盘/网络）

   e. 检查ConfigMap/Secret是否正确挂载

3. 根因分析（基于规则引擎+LLM）：

   - 规则引擎：匹配常见错误模式（ImagePullBackOff → 镜像不存在；CrashLoopBackOff → 启动失败）

   - LLM增强：对复杂日志进行语义分析，生成人类可读的错误描述

4. 生成诊断报告：

   - 问题摘要（一句话）

   - 根因分析（技术细节）

   - 修复建议（步骤化）

   - 责任人推荐（根据代码提交记录和模块归属）

5. 推送：通过IM推送给相关开发和运维同学

关键能力：

分级诊断：区分"配置问题"（改YAML即可）vs "代码问题"（需开发修复）vs "环境问题"（需运维处理）

关联分析：识别是否是某次代码提交引入的问题（通过Git Blame关联）

知识库积累：每次诊断结果沉淀到内部知识库，越用越准

### 3.4 Agent 3: Collaboration Agent（协作代理）

职责：替代"群里@人"的低效协作模式，成为开发和运维之间的智能调度中枢

工作流：

1. 接收Pipeline Agent和Diagnosis Agent的事件

2. 智能路由：

   - "构建成功+自动部署成功" → 通知开发同学"已上线，无需操作"

   - "部署失败+根因=代码问题" → 创建工单/通知分配给对应开发

   - "部署失败+根因=配置问题" → 通知运维同学，附带修复命令

   - "部署失败+根因=未知" → 同时通知开发和运维，附带诊断日志链接

3. 进度追踪：

   - 自动追踪问题修复状态（监听GitLab新提交、Tekton新构建、ArgoCD新同步）

   - 如果30分钟无响应，自动升级通知（@主管）

4. 日报生成：

   - 每日自动汇总：构建次数、部署次数、失败次数、平均修复时间

   - 识别高频问题，推荐优化项

关键能力：

IM集成：深度集成飞书，支持卡片消息、按钮交互（"确认已修复"、"需要协助"）

工单自动创建：对接Jira/Tapd/飞书项目，自动创建、分配、关闭工单

上下文保持：同一个部署问题，所有相关信息（日志、诊断、讨论）在一个线程中聚合

## 四、FDE Workstation MVP模块清单

### 4.1 模块选择逻辑

第一个里程碑不追求"五层十二域全齐"，而是以交付"运维提效Agent Trio"为目标，反推需要哪些Workstation模块支撑FDE完成交付。

### 4.2 MVP模块清单（6个模块）

### 4.3 最终MVP范围（6个模块）

P0（必须开发，阻塞交付）：

Layer 1 - 现场作战背包（日志速析器 + API契约生成器）

Layer 3 - 需求翻译器

Layer 4 - 行业模板市场（CI/CD运维模板）

Layer 5 - 评估驱动引擎

P1（重要，可在里程碑内完成）：

Layer 1 - 合规检测雷达（简化版）

Layer 2 - 异步访谈Agent（简化版）

P2（延后到里程碑二）：

利益相关者图谱、场景挖掘Agent、数据治理工坊、私有化部署盒、客户共创看板

## 五、开发计划（3周排期）

### 5.1 项目结构

FDE-Workstation-M1/

├── workstation/                    # FDE Workstation平台MVP

│   ├── layer1_field_toolkit/       # 现场工具层

│   │   ├── field_pack/             # 现场作战背包

│   │   │   ├── log_analyzer/       # 日志速析器

│   │   │   └── api_generator/      # API契约生成器

│   │   └── compliance_radar/       # 合规检测雷达（简化）

│   ├── layer2_customer_intel/      # 客户洞察层

│   │   └── async_interview/        # 异步访谈Agent（简化）

│   ├── layer3_req_translation/     # 需求转化层

│   │   └── req_translator/         # 需求翻译器

│   ├── layer4_prototype_factory/   # 原型工厂层

│   │   └── template_hub/           # 行业模板市场

│   │       └── templates/

│   │           └── cicd_ops/       # CI/CD运维模板

│   └── layer5_delivery_validation/ # 交付验证层

│       └── edd_engine/             # 评估驱动引擎

├── agents/                         # 运维提效Agent Trio

│   ├── pipeline_agent/             # 管道代理

│   ├── diagnosis_agent/            # 诊断代理

│   └── collaboration_agent/        # 协作代理

├── shared/                         # 共享基础设施

│   ├── event_bus/                  # 事件总线（Agent间通信）

│   ├── knowledge_base/             # 知识库（诊断经验沉淀）

│   └── im_connector/               # IM连接器（飞书）

└── docs/                           # 交付文档

### 5.2 详细排期（WBS）

Week 1 : 需求确认 + 基础设施搭建

Week 1 里程碑：需求确认完成，基础设施Ready，开发环境打通，Pipeline Agent跑通端到端（Tekton构建完成 → YAML更新 → ArgoCD同步）。

Week 2: Diagnosis Agent + 模板市场

Week 2 里程碑：Diagnosis Agent能自动诊断常见部署问题并生成报告，Agent Trio完整集成，能完成"构建→部署→诊断→通知→追踪"全链路。

Week 3: 评估驱动引擎 + 内部试用 + 效果验证 + 交付文档 + 复盘

Week 3 里程碑：Agent进入内部灰度试用，评估引擎开始采集数据。M1正式交付，效果数据验证通过，M2规划完成。

## 六、技术方案要点

### 6.1 Agent Trio技术栈

### 6.2 与现有系统集成点

## 七、验收标准（Definition of Done）

### 7.1 Agent Trio验收

### 7.2 FDE Workstation MVP验收

## 八、风险与应对

## 九、资源需求

## 十、M1 → M2 衔接规划

M1验证成功后，M2重点：

扩展Workstation模块：开发利益相关者图谱、场景挖掘Agent、数据治理工坊、客户共创看板

扩展Agent能力：支持Helm/Kustomize、支持多集群、支持金丝雀发布

扩展行业模板：从"CI/CD运维"扩展到"监控告警运维"、"成本优化运维"

对外交付准备：将内部验证的Agent和Workstation模块，封装为可对外部客户交付的产品
