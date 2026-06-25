# 07-YAML治理智能体

## 1. 目标

在 GitOps 变更计划执行后、提交配置仓库前，使用 FDE Agent Runtime 的 `code_runtime` 对 Kubernetes YAML 和 `yaml.diff` 做语义级治理。当前实现只做只读审查和阻断判断，不自动写入修复；低风险修复 diff 属于后续能力。

## 2. 不做什么

```text
不替代确定性 YAML 更新逻辑
不直接修改业务源码、Dockerfile、构建脚本或测试代码
不在 prod 自动提交修改
不执行 kubectl 或 argocd 写操作
不把治理结果直接当作部署成功依据
```

## 3. 上游输入

```text
gitops.yaml.updated
配置仓库 checkout
更新后的 YAML 文件
GitOps 变更计划（可选）
MR Review 风险摘要（可选）
```

## 4. 输出结果

```text
yaml.governance.completed
yaml-audit-report.md
yaml-governance-result.json
yaml.diff 审查结果
阻断状态（高风险时）
```

## 5. 接口契约

### 5.1 输入

```json
{
  "config_repo_path": "/workspace/gitops",
  "yaml_file_path": "apps/api-gateway/deployment.yaml",
  "application": "api-gateway",
  "environment": "dev",
  "image_name": "registry.example.com/api-gateway",
  "image_tag": "v1.2.3",
  "change_plan_ref": "artifacts/runs/run-001/gitops-change-plan.json",
  "diff_artifact_uri": "artifacts/runs/run-001/yaml.diff"
}
```

### 5.2 输出

```json
{
  "approved": true,
  "risk_level": "medium",
  "summary": "本次变更只包含 api-gateway dev 环境的 GitOps 配置更新",
  "changed_files_reviewed": ["apps/api-gateway/deployment.yaml"],
  "findings": [
    {
      "type": "missing_resources",
      "file": "apps/api-gateway/deployment.yaml",
      "summary": "缺少 resources requests/limits"
    }
  ],
  "required_fixes": ["补充 resources requests/limits"],
  "auto_fixed": []
}
```

## 6. 处理流程

```text
1. Pipeline Agent 执行 GitOps 变更计划
2. 触发 YAML Governance Agent
3. Agent Runtime 使用 `code_runtime`
4. 读取变更计划、yaml.diff 和相关 YAML 文件
5. 检查变更是否只包含允许的 GitOps operation
6. 检查 resources、probe、安全上下文、API 版本、标签规范
7. delete / remove_resource 等删除类操作默认标记 high risk，除非策略明确放行
8. high / critical 风险阻断流水线
9. 输出治理报告
```

## 7. 文件结构

```text
agents/
  pipeline/
    yaml-governance/
      yaml-governance.md
ci/
  tekton/
    yaml-governance-task.yaml
prompts/
  pipeline/
    yaml-governance.md
schemas/
  agents/
    yaml-governance-result.schema.json
```

## 8. 与下一步衔接

治理通过后，Pipeline Agent 提交配置仓库并触发 ArgoCD。治理失败时输出事件给 Diagnosis 或 Collaboration，通知人工处理。

## 9. 验证方式

```text
定向验证：缺少 resources 的 YAML 应生成 fixed_issues。
定向验证：特权容器 YAML 应生成 blocked_issues 并阻断。
```

## 10. 风险与降级

| 风险 | 降级 |
| --- | --- |
| AI 修复不符合团队规范 | 只提交 diff，不自动合并 |
| prod 环境变更风险高 | prod 一律只输出建议 |
| YAML 太复杂 | 输出人工处理建议，不强行改写 |
