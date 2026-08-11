# 发布说明

## v4.15.0

- 补强同文件局部修改保护：`runtime-state-matrix.json` 必须为每个未调整视觉节点登记 `protected:<visualNode>` 的前后截图证据、范围合同哈希与零像素差异结果；只验证未修改文件哈希不再足够。

## v4.14.0

- 新增 Existing 局部变更闭包合同 `change-scope.json`：区分任务执行深度与真实页面变更范围，自动冻结受影响节点和未调整保护补集。
- Gate 1 八节与视觉方案十节保持完整，但局部任务只展示本次受影响内容；未调整页面、组件、数据展示和 Token 仅引用 Existing 基线，不再重复输出或要求全站确认。
- Visual Execution Plan、来源选择、Visual Bundle 与 Implementation Map 必须严格落在确认范围内；任何越界节点或代码目标在 Gate 2 阻断。
- Gate 3 新增保护补集逐文件 SHA-256 审计，未调整文件发生变化即交付失败；同文件内未调整视觉节点仍纳入回归验证。
- 局部边界采用目标路径变更与保护基线模型，设计原则对齐 RFC 6902/7396 的定址 Patch 语义及安全部署中的 blast-radius 控制。

## v3.29.0

- 响应式布局从空字段升级为冻结合同：强制 mobile、tablet、desktop 三类视口、重排规则、溢出策略、文字/媒体行为和验收条件。
- Gate 2 验证视觉方案与 Visual Bundle 绑定同一响应式合同；Gate 3 验证三类真实尺寸截图，阻止页面在不同分辨率下乱序、裁切或变形。
- 增加连续宽度区间验证：每类视口的最小、中间、最大宽度均须有真实截图和稳定性断言，避免仅在三个固定断点正常、拖动窗口即错乱。

## v3.26.0

- 修复提示词调整被一律视为视觉基线变化的问题：新增 `non-baseline` 审计分级，不撤销确认或实施权限。
- Gate 2 已开放后，明确授权且不触碰冻结视觉/动效/依赖/映射的纯实现改动保留实施权限，并由 Gate 3 重新验证。

## v3.22.0

- 新增效果图前的 Visual Execution Plan 确认点，冻结布局、视觉系统、内容、组件、动效、依赖和风险后才允许生成正式效果图。
- 在线动效候选必须同时绑定确认方案中的精确版本、待安装状态与 `dependency-lock.json`；Gate 2 不再接受脱离依赖计划的 Motion/GSAP 等候选。

## v3.20.0

- 明确区分 `skip stitch`（仅跳过人工确认）与 `skip-stage stitch`（明确跳过整个 Stitch 阶段）。
- 全阶段跳过以已确认效果图作为实施、运行态对比与 Gate 3 的可追溯基线，不伪造 Stitch 画布或冻结工件。
- 保留 Visual Source Manifest、实施确认、Gate 2、Gate 3 与运行时结构/状态证据；“继续”不会触发阶段跳过。

## v2.0.0

- 新增Greenfield / Existing双轨、范围与授权三维分流。
- Gate 2升级为可执行设计冻结门，加入实现权限锁。
- 新增Site Contract、Functional Freeze、Stitch Freeze、Visual Bundle、Implementation Map、Page Delta、Dependency Lock和Verification Bundle Schema。
- Stitch Connector支持用户直接编辑画布、确认后最新态同步、内容指纹冻结及变更撤销。
- 新增Checkpoint恢复、按阶段Context Compiler和Gate校验器。
- Existing页面允许按确认效果图完整重构，同时强制功能保护和整站回归。
- 新增Stitch真实MCP同步、Screen选择、下载内容哈希、冻结和远端变化自动撤销执行器。
- 新增Visual Bundle / Implementation Map编译器与在线素材Resolver。
- 新增八类验证编排、Proof / Gate 3状态控制、Context索引和Checkpoint失效恢复控制器。
- 轻量Schema校验器支持本地`$ref`与`additionalProperties`递归校验。

## v1.0.0

当前版本达到：

- 通用 APEX Core 已独立
- 项目 adapter 与 core 分离
- 状态机、Gate、恢复、token、subagent、工具矩阵已落地
- skill 层与 adopted 规则层已落地
- connector 与 adapter 示例已具备

## 当前仍建议继续补强的点

- 外部来源版本与许可值继续精细化
- 阈值继续根据真实使用调整
- 更多 connector 与 adapter 示例
# APEX 3.23.0

- 3D/WebGL 已成为视觉实施方案的一等能力：采用 Three/Babylon 时，必须在正式效果图前锁定 runtime、renderer、资源、性能预算与降级策略。
- Gate 2 验证每个 3D runtime 的精确依赖锁；Gate 3 验证真实 renderer 截图、性能、静态降级及 reduced-motion 证据，阻止“设计稿有 3D、代码没有”的伪复刻。
- 动效能力盘点现可识别 Three、React Three Fiber、Drei、Babylon 及项目内 3D 使用点。
