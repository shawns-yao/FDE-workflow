# M2 Memory 与 Skill 候选能力设计

**版本**：v1.0  
**日期**：2026-06-16  
**状态**：M2候选，不进入M1实施  

---

## 一、定位

M1 只保存诊断记录、证据摘要、错误指纹和审计记录，不做完整知识库自动沉淀，也不自动生成或启用 skill。

M2 才评估 memory、knowledge case、rule 和 skill 的沉淀机制。

---

## 二、概念边界

| 类型 | 含义 | M1是否实现 | M2候选 |
|------|------|------------|--------|
| diagnosis_record | 单次诊断结果 | 是 | 继续增强 |
| memory / knowledge_case | 可复用问题经验 | 否 | 是 |
| rule | 可程序化匹配规则 | Top 10内置规则 | 可从案例候选生成 |
| skill / runbook | 稳定可执行处理流程 | 否 | 是，必须人工确认 |

---

## 三、沉淀流程

```text
部署失败
  -> 读取K8s日志和Events
  -> 脱敏
  -> 规则诊断 + LLM增强
  -> 生成diagnosis_record
  -> 人工确认诊断是否准确
  -> 生成memory候选
  -> 多次命中或人工审核
  -> 提升为knowledge_case
  -> 稳定流程再候选生成skill/runbook
```

---

## 四、Memory 候选结构

```text
case_id
app_name
environment_type
error_fingerprint
category
symptoms
root_cause
solution
evidence_summary
redacted_log_excerpt
k8s_event_summary
image_ref
commit_sha
first_seen_at
last_seen_at
hit_count
confirmed_by
confidence
status
```

---

## 五、Skill 候选结构

```text
skill_name: diagnose-image-pull-failure
trigger:
  - Pod status = ImagePullBackOff
  - Event reason includes FailedToPullImage
steps:
  - 检查image_ref是否存在
  - 检查namespace下imagePullSecrets引用
  - 检查ServiceAccount是否引用imagePullSecrets
  - 检查registry token是否过期
guardrails:
  - 不读取Secret明文
  - 不自动修改prod
  - 不直接重启工作负载
outputs:
  - root_cause
  - evidence
  - suggested_fix
```

---

## 六、启用规则

M2 即使生成 skill 候选，也不能自动启用。启用必须满足：

- 至少一次人工确认。
- 适用范围明确。
- 输入、输出、禁止动作明确。
- 不读取未授权敏感信息。
- 不自动执行生产变更。

---

## 七、M1 禁止事项

- 不把完整日志沉淀为 memory。
- 不把一次 LLM 诊断直接沉淀为 skill。
- 不自动启用 skill。
- 不把知识库自动沉淀作为 M1 验收标准。

