# Google Stitch 可编辑画布 Connector

## 定位

Stitch 是 APEX Visual 阶段的可编辑高保真协作画布。用户可以打开链接直接编辑；Stitch 不拥有产品事实、功能事实、Gate 裁决权或生产代码真相权。

## 启用边界

- Gate 1 通过后才可生成正式候选。
- 输入必须包含项目事实包、Site Contract、页面族、真实功能、数据与允许 / 禁止变化。
- 私有代码、页面、设计系统和数据上传属于外部传输，必须获得授权并最小化；禁止上传真实用户、认证和日志数据。

## Prompt 与设计契约

- Stitch Prompt 是每次生成的必需入口：说明本轮 Screen、信息层级、布局、状态、视觉方向和禁止项。
- `DESIGN.md` 是可选的跨页设计契约，适合多 Screen、一致性复用或多轮迭代；它不替代 Prompt，也不是创建 Stitch 前必须上传的文件。
- 有 `DESIGN.md` 或 Site Contract 时，编排器提取与本轮相关的 token、组件规则和禁区，编译进 Prompt 或结构化输入；默认不上传原始本地文件。
- 单 Screen 探索可只使用项目事实包、Site Contract 和 Prompt。无论输入形式如何，用户确认后都必须冻结真实 Stitch 画布，Prompt 与本地参考图不能代替 Freeze。

## 效果图 + Prompt 调用

- APEX 在 Gate 1 通过后的 Visual 阶段产出的效果图，是默认的“参考图 + Prompt”输入：效果图约束构图、层级、密度、色彩和组件语言；Prompt 说明页面语义、真实数据、状态、交互和禁止改动。用户无需重复上传 APEX 已产出的效果图。
- 先在宿主发现图片输入能力（图片上传、reference image 参数或 Image-to-UI 项目导入）。发现后必须把图片与 Prompt 一同发送，而非先生成一张本地图再以纯文本重述。
- 若当前 MCP 只暴露文本生成，必须使用 Stitch UI 的图片导入流程或报告 `image-reference-input-unavailable`；不得静默退化为纯文本生成。
- 每次图文生成必须在 `canvas-selection.json` 的 `generationInput` 中记录 Prompt 哈希、每张参考图的稳定 ID / SHA-256、角色、预期保真度和传输方式。参考图只传递最小必要范围，仍遵守外部传输授权。

## 严格可解析标记

严格 1:1 模式的 Stitch Prompt 必须要求导出 HTML 保留以下机器标记；没有标记的候选直接判为 fidelity-failed，不能冻结：

- 每个受保护布局节点：data-apex-node="<layoutLock.nodes[].marker>"，按 nodes[].order 出现在 DOM 中。
- 每个图表：data-apex-chart、data-apex-chart-type、data-apex-metric、data-apex-dimension、data-apex-encoding，值必须分别匹配 analyticsLock 的 marker、type、metric、dimension、encoding。
- 每个组件：data-apex-component 与 data-apex-component-kind，匹配 componentContracts 的 marker 与 kind。
- 根容器：data-apex-token-hash，值为 Gate 1 designTokens 的稳定 SHA-256。

这些是 APEX 的验证元数据，不是面向最终用户的文案。实现代码必须保留等价标记，Stitch 与运行时导出器才可自动证明节点、图表、组件、token 的一致性。

## 中文与结构保真锁

- Prompt 必须声明输出语言；效果图为中文时使用 `zh-CN`，所有面向用户的标题、筛选器、表头、指标、按钮、空态和说明均使用内容锁中的精确中文，不得翻译、改写、拉丁化或用英文占位。
- 图文调用默认 `layoutLock.mode: strict`：参考图定义表格列数与表头、主次区块顺序、网格/分栏、容器层级、间距密度、色彩和组件形态。除非 Prompt 显式列出允许偏差，Stitch 不得将其当作风格灵感重新设计。
- `analyticsLock` 必须逐图锁定图表身份和编码：例如趋势=折线/面积趋势、进度=进度条或环形进度、雷达=雷达图、分布=直方/堆叠分布。锁中包含指标、维度、坐标/分段、颜色语义和允许缺数回退；不得用卡片、柱图或其他“看起来相近”的图形替换。
- APEX 必须把 `contentLock` 与 `layoutLock` 同时编译进 Prompt：图像只负责视觉锚点，结构化锁负责可读中文和不可猜测的表格/布局事实。
- 在确认候选前，APEX 对效果图和 Stitch 截图做逐项保真审查：语言、关键文案、表格列/表头、区块顺序、网格、组件形态、间距、色彩及每个图表的类型/指标/编码。任一关键项不一致，候选标为 `fidelity-failed`，只允许回到 Stitch 修正，不得确认或冻结。

## 图文调用的正式路径

1. 使用 `stitch-sync.mjs capabilities` 进行只读发现，确认当前 MCP 是否暴露图片输入工具；其余 Stitch 写入操作必须先取得 `sync_stitch` 授权并经 `apex-action.mjs` 执行。
2. 若可用，使用同一调用提交效果图与 Prompt，并记录 `transport: mcp-native`。
3. 若不可用，APEX 使用浏览器控制进入 Stitch UI 的 Image-to-UI / 画布导入流程，自动导入 Gate 1 后 Visual 阶段产出的效果图并提交同一 Prompt，生成真实 Screen，并记录 `transport: stitch-ui-automation`。浏览器或 UI 导入不可用时，报告能力缺口；不得要求用户重复上传或静默转为纯文本。
4. APEX 对候选执行中文与结构保真审查；通过后才请求用户确认。
5. 用户确认效果图后运行 stitch-sync.mjs freeze 读取远端 Screen、HTML、截图和设计系统，形成暂存快照；随后 strict-replica.mjs stitch 完成零差异与结构合同校验，生成待确认的 Stitch 证据。用户确认 Stitch 后才执行 stitch-sync.mjs seal；只有 seal 成功才赋予实现权威。
6. 对 Screen 集合、HTML、截图和设计系统计算内容指纹。
7. 将每个确认 Screen 的实际 HTML 与截图下载到 evidence/stitch/screens/<screen-id>/，并将其路径与 SHA-256 写入冻结记录；随后运行 structure-contract.mjs stitch 自动抽取并验证结构合同。
8. 写入符合 stitch-freeze schema 的 stitch-freeze.json。
8. 将冻结结果编译进 Visual Bundle，而不是把 Stitch HTML 直接覆盖生产代码。

若当前 Stitch 能力提供稳定 revision ID，应同时记录；不能确认时以主动重读所得内容指纹作为版本边界。

## 确认后变化检测

实现前、长任务恢复时、Proof Gate 前和 Gate 3 前重新读取或比对内容指纹：

- 文案 / 数据映射变化：重新编译局部 Content / Data Contract。
- 视觉细节变化：撤销对应 Screen 的视觉确认。
- 布局、素材、交互、动效或响应式变化：撤销对应 Screen 的 Gate 2 和实现权限。
- 设计系统、共享组件、权限或功能语义变化：撤销所有受影响页面并重新计算影响范围。

不允许在远端已变化时继续按旧冻结版本实现。

## Visual Bundle 编译

Stitch Freeze 必须与 Site Contract、Functional Freeze、真实 API / 权限 / 状态及在线素材 Dependency Lock 合并，形成：

```text
视觉节点 -> DOM / 组件 -> 样式与布局 -> assetRef -> API字段 -> 状态 -> 权限 -> 事件 -> 动效 -> 响应式 -> 验收点
```

Stitch HTML只是结构和视觉输入。演示数据、模拟交互和生成代码不自动成为生产功能。

## 降级

MCP / SDK 不可用时可以人工导出确认 Screen、HTML、截图和设计说明并计算指纹。降级不得省略选择清单、版本冻结、映射、依赖锁和Gate 2校验；无法获得最新确认态时不得开放实现权限。
