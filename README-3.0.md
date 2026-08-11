# APEX 3.0：用户意图驱动的全栈交付系统

APEX 3.0 将 APEX 2.0 的双轨状态机、Stitch Freeze、Site Contract 和验证 Gate 扩展为可执行的全栈交付链路。

```text
用户短需求
→ Intent Brief / Delivery Contract
→ Gate 1：方案确认
→ 效果图 + Stitch + DESIGN.md
→ Gate 2：视觉冻结
→ 前端 + 后端 + 数据实施
→ Gate 3：运行证据验收
```

## 必备运行产物

- `intent-brief.json`：用户意图、事实、假设、质量标准与待确认项。
- `delivery-contract.json`：本次任务必须实现的能力和验证门槛。
- `existing-baseline.json`：Existing 任务的真实系统事实与保护边界。
- `project-inventory.json`：Existing 项目的只读技术栈、入口、路由候选与可执行验证脚本清单。
- `domain-model.json` / `api-contract.json`：需要后端或接口时的领域与边界契约。
- `DESIGN.md` / Site Contract / Stitch Freeze / Visual Bundle：设计事实与实现约束。
- `implementation-map.json`：Stitch 节点到 token、组件、API 和测试选择器的映射。
- `verification-bundle.json`：功能、视觉、无障碍、性能、契约与回归证据。

## 质量层级

1. 正式标准：ISO 9241-11、WCAG 2.2 AA、Core Web Vitals 和真实测试证据。
2. 平台/行业规范：由项目平台、领域、Existing 系统和权限要求确定。
3. 用户确认的视觉基线：效果图、Stitch、DESIGN.md 和禁止模式。

审美表达如“高级”“炫酷”“华丽”不是固定模板；设计导演必须结合产品上下文提出可比较的解释方案，用户确认后才冻结为设计事实。

## 核心调用方式

```text
node scripts/apex-router.mjs intake <project-root> <run-id> <greenfield|existing> [scope] [authorization] <session-id>
node scripts/apex-router.mjs reinvoke <project-root> <session-id> <continue|new-task> [new-run-id greenfield|existing lite|standard|full interactive|autonomous reason]
node scripts/apex-router.mjs authorize <project-root> <run-id> <session-id> <allowed-action> [lease-id]
node scripts/apex-action.mjs run <project-root> <run-id> <session-id> <authorization-ref> <allowed-action> <registered-script> [script-args...]
node scripts/release-audit.mjs
node scripts/apex-validate.mjs pre-gate1 <run-dir>
node scripts/apex-router.mjs approve <project-root> <run-id> <session-id> gate1 <approval-id> <run-relative-artifact> [...]
node scripts/apex-validate.mjs pre-gate2 <run-dir>
node scripts/apex-router.mjs authorize <project-root> <run-id> <session-id> open_gate2
node scripts/apex-router.mjs transition <project-root> <run-id> <session-id> <authorization-ref> open-gate2
node scripts/apex-validate.mjs gate3 <run-dir>
node scripts/apex-router.mjs authorize <project-root> <run-id> <session-id> open_gate3
node scripts/apex-router.mjs transition <project-root> <run-id> <session-id> <authorization-ref> open-gate3
```

`allowed-action` 必须来自 Router 当前返回的 `allowedActions`。例如 Existing 勘测使用
`collect_existing_baseline + project-intake.mjs`，上下文记录使用
`record_context + contract-recorder.mjs`，Stitch 使用 `sync_stitch`，视觉 Bundle 使用
`compile_visual_bundle`，浏览器、契约、质量与回归使用 `verify`。这些运行脚本不得直连。

详细的运行产物和兼容策略见 `core/runtime/run-directory.md` 与 `core/runtime/migration-3.0.md`。
