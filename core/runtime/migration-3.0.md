# APEX 2.0 → 3.0 迁移

APEX 3.0 保留 2.0 的 Greenfield/Existing、Gate、Stitch Freeze、Visual Bundle 和 Dependency Lock。它新增的是可执行的意图、基线、全栈契约和质量验证。

## 新增必备产物

| 条件 | 必备产物 |
|---|---|
| 所有新运行 | `intent-brief.json`、`delivery-contract.json` |
| Existing | `project-inventory.json` + `existing-baseline.json` |
| backend 或 api-contract capability | `domain-model.json`、`api-contract.json` |
| chart capability | 非空且完整的 `visual-bundle.charts` |
| motion capability | 非空且完整的 `visual-bundle.motion` |

## 升级步骤

1. 将运行状态、schema 和模板升级至 `schemaVersion: 3.0`。
2. 编译并确认 Intent Brief 与 Delivery Contract。
3. Existing 任务先补齐真实基线和 Functional Freeze。
4. 将 Stitch 节点、设计 token、组件/API/测试选择器写入 Implementation Map。
5. 用 `pre-gate1`、`pre-gate2`、`gate3` 校验替代仅人工声明的 Gate。

模板仅用于建立目录结构。Gate 1 会拒绝仍含 `replace` 或 `<...>` 占位符的 Intent Brief、Delivery Contract、Existing Baseline、Functional Freeze、Domain Model 与 API Contract。

旧 2.0 运行目录应保留为历史证据；新功能和新任务使用 3.0 运行目录。
