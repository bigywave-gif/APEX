# APEX 严格 1:1 复刻运行规范

## 目标

严格模式将效果图、Stitch 画布与运行时代码视为同一份参数化视觉合同的三个物化结果。任何一段未同时满足零像素差异、中文内容一致和语义结构一致，均不得进入下一阶段。

## 权威链路

1. Gate 1 Visual 同次产出效果图和 gate1-visual-output.json。
2. visual-reference-compiler.mjs emit 固化效果图 SHA-256、中文内容锁、布局节点、图表、组件和 token 合同。
3. Stitch 使用效果图与同一 Prompt 生成候选；用户确认候选后，stitch-sync.mjs freeze 只写入暂存 HTML、完整截图及内容哈希。
4. strict-replica.mjs stitch 自动导出 Stitch 结构合同，执行效果图到 Stitch 的严格 Gate；通过后自动 seal。
5. browser-capture.mjs 采集运行时截图和真实 DOM HTML。
6. strict-replica.mjs runtime 自动导出运行时合同，执行 Stitch 到代码的严格 Gate。
7. Gate 2 与 Gate 3 会重新校验结构合同文件、SHA-256、来源、截图哈希与零差异证据。

## Gate 1 语义合同

gate1-visual-output.json 必须包含：

- 中文内容和表头锁。
- 严格布局节点：id、marker、kind、order。
- 每个图表的 marker、类型、指标、维度和编码。
- 每个组件的 id、marker、kind。
- 稳定 designTokens。

模板位于 core/templates/gate1-visual-output.example.json。

## 可解析 HTML 标记

Stitch 导出 HTML 与实现代码运行时 DOM 必须保留：

- data-apex-node：布局节点 marker。
- data-apex-chart、data-apex-chart-type、data-apex-metric、data-apex-dimension、data-apex-encoding。
- data-apex-component、data-apex-component-kind。
- data-apex-token-hash：Gate 1 designTokens 的稳定 SHA-256。

缺少、错序或不匹配的标记会使自动结构合同失败。

## 受控自动链路

先由 Router 对每一步发出授权，再经 Action Gateway 调用已登记脚本：

```text
compile_visual_bundle -> visual-reference-compiler.mjs emit <run-dir> <gate1-visual-output.json>
sync_stitch           -> stitch-sync.mjs freeze <run-dir> <canvas-selection.json>
sync_stitch           -> strict-replica.mjs stitch <run-dir> <screen-id>
verify                -> browser-capture.mjs capture <run-dir> <base-url> <browser-spec.json>
verify                -> strict-replica.mjs runtime <run-dir> <capture-id> <frozen-stitch-screen-id>
```

统一命令形态为：

```text
node scripts/apex-router.mjs authorize <project-root> <run-id> <session-id> <action>
node scripts/apex-action.mjs run <project-root> <run-id> <session-id> <authorization-ref> <action> <script> <arguments...>
```

strict-replica 会自动生成结构合同、parity 输入和证据；禁止以手工 JSON 替代。

## Freeze 与 Seal

Freeze 是暂存同步，不授予实现权威。只有 strict-replica stitch 通过后，seal 才会把 Stitch 标记为 current。Seal 会重读结构合同并验证合同 SHA-256、来源、截图哈希和通过状态。

## 失败处理

- 图文生成不可用：报告能力缺口，不得退化为纯文字。
- Stitch 未提供明确 HTML 或完整 screenshot：暂存 Freeze 失败。
- 像素、中文、表格、布局、图表、组件或 token 不一致：保持未 seal，回到 Stitch 修正。
- 运行时对比失败：保持 Gate 3 未通过，修正代码后重新采集。
