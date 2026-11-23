# APEX 严格 1:1 复刻运行规范

## 目标

新 Run 以用户确认的可交互 Demo 为视觉和交互基线。所选路线必须保留内容、结构、组件和设计 token，并以实际浏览器截图、DOM 与操作证据验证正式实现；仅有静态图片不能证明交互可用。选择 Stitch 时，还要验证候选与已确认 Demo 的一致性。旧 Run 保持原确认模型。

## 权威链路

1. 用户确认视觉方案后，生成、运行并验证可交互 Demo；用户确认 Demo。
2. `visual-reference-compiler.mjs` 固化 Demo 截图、内容、布局、图表、组件和 token 合同。
3. 用户选择直接代码，或选择 Stitch 并校验候选与 Demo；差异须按用户选择处理。
4. 机器冻结来源、Implementation Map 和依赖，通过 Gate 2 后实施。
5. `browser-capture.mjs` 采集正式运行时截图、DOM 与实际任务交互；严格复刻校验对应已确认基线。
6. Gate 3 校验证据、来源、截图及结构合同；缺失或失效证据不能证明交付完成。

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
sync_stitch           -> stitch-sync.mjs freeze <run-dir> <canvas-selection.json>  # 仅 Stitch 路线
sync_stitch           -> strict-replica.mjs stitch <run-dir> <screen-id>
verify                -> browser-capture.mjs capture <run-dir> <base-url> <browser-spec.json>
verify                -> strict-replica.mjs runtime <run-dir> <capture-id> [<frozen-stitch-screen-id>]
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
