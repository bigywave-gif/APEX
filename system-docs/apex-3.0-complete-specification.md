# APEX 当前完整交付规范（以 manifest.version 为准）

## 文档控制

| 项 | 值 |
| --- | --- |
| 文档状态 | 发布级系统规范 |
| 适用范围 | Greenfield、Existing 的产品、设计、前后端实施与验收 |
| 规范真相源 | `manifest.yaml`、`core/`、运行产物 Schema 与可执行脚本 |
| 更新原则 | 文档说明不得覆盖或放宽机器 Gate；冲突时以 Schema 和脚本为准 |

本规范采用“需求可追踪、质量可测量、证据可审计”的结构。它借鉴 ISO/IEC/IEEE 29148 对需求信息项与生命周期追踪的要求、ISO/IEC 25010 对质量要求和验收度量的用途、WCAG 2.2 的无障碍基线，以及 NIST SSDF 的安全开发治理思路；它们是校准参考，不替代项目适用的法律、行业或公司制度。

## 1. 系统目的与边界

当前 APEX Core 将不完整的自然语言需求转化为经用户确认的交付合同，再将视觉事实、代码实现和验收证据串成可恢复的闭环。它不是业务需求的唯一决策者，也不自行替用户批准范围、权限、外部依赖或不可逆数据迁移。

两条轨道：

- **Greenfield**：先定义目标产品、领域、接口和设计事实，再实施。
- **Existing**：先读取真实项目、页面、接口和保护边界；未完成基线不得生成正式效果图或 Stitch。

### 标准到 APEX 的落地映射

| 领域 | 参考标准 | APEX 落地 |
| --- | --- | --- |
| 产品与需求 | ISO/IEC/IEEE 29148 | Intent Brief、Delivery Contract、假设/冲突/确认项和 Gate 1 |
| 技术架构 | ISO/IEC/IEEE 42010:2022 | 系统分层、关注点、视角、Connector/Adapter 与 Architecture Description |
| 交付流程 | ISO/IEC/IEEE 12207:2026 | 受控实施、验证、配置冻结、恢复和发布审计 |
| 产品质量 | ISO/IEC 25010:2023 | 可用性、兼容、可靠、性能、安全与可维护性要求的质量合同 |
| 可访问性 | WCAG 2.2 | Delivery Contract 无障碍目标及 Gate 3 证据 |
| 安全开发 | NIST SSDF | 权限、依赖、接口与交付前安全治理输入 |

上述映射是 APEX 的工程化采用方式，不宣称 APEX 或目标项目自动获得标准认证。

## 2. 角色与责任

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| 用户/业务负责人 | 业务优先级、范围、Gate 确认 | 代替专业人员编写完整规格 |
| 设计导演 | 将短需求提炼为体验策略、效果图、Stitch 与 DESIGN.md | 绕过业务约束或确认 Gate |
| 产品设计 | 任务流、信息架构、状态与验收口径 | 伪造数据或接口事实 |
| UI/UX 设计 | 视觉系统、交互、无障碍、动效规则 | 用审美替代功能验收 |
| 前后端实施 | 合同映射、代码、数据和错误状态 | 擅改冻结视觉或业务边界 |
| 验证负责人 | 真实运行、浏览器、契约、性能与回归证据 | 以“代码已写”代替交付 |

## 3. 用户规范接入与冲突裁决

任何公司/职业规范均可作为上下文输入：PRD、设计系统、品牌手册、Stitch 画布、效果图、`DESIGN.md`、API/OpenAPI、数据字典、权限矩阵、编码规范、测试策略、上线制度。

APEX 必须在 Gate 1 前将其归类为：

1. **硬约束**：法规、权限、数据、接口、品牌禁令、既有兼容边界；必须落入 Contract 或 Freeze。
2. **质量规则**：可用性、无障碍、性能、安全、测试和工程门槛；必须变成可验证标准。
3. **偏好与方向**：如高级、专业、华丽、动效拉满；必须由设计导演转译为可比较的视觉/动效策略，不能直接当作实现指令。
4. **待决或冲突项**：必须列出影响、备选方案和需要确认者；不得静默选择。

裁决优先级为：法律/安全/权限与真实事实 > 已确认业务合同 > Existing 保护边界 > 最新视觉冻结 > 项目工程规范 > 默认增强 Skill > 未确认偏好。

## 4. 用户确认与机器 Gate

新 Run 首先由产品角色完成需求、范围、功能和验收，再由设计师结合产品方案及 Existing 真实现状制定视觉方案。用户确认视觉方案后生成可交互 Demo；用户确认 Demo 后选择是否进入 Stitch。局部改造的确认内容聚焦问题、改法和样式来源；整站改造逐项说明现状问题、改法和目标效果。

| 机器 Gate | 核验内容 | 通过后的效果 |
| --- | --- | --- |
| Gate 1 | 产品、基线、需求和视觉方案来源 | 允许生成已确认方案的 Demo |
| Gate 2 | 已确认 Demo、可选 Stitch、设计规范、依赖和实现映射 | 开放代码实现权限 |
| Proof / Gate 3 | 代表页与实际交付的功能、视觉及回归证据 | 验证并完成交付 |

用户确认、路线选择和机器 Gate 不是同一操作。旧 Run 保留其创建时的确认模型。摘要或已确认来源发生变化时，旧授权失效并按实际影响重建；受控回执可恢复的中断不重复索要同一确认。

## 5. 视觉基线与角色协作

设计师必须实际读取并应用 taste-skill；其他视觉、交互和动效技能按场景使用，设计决定写入绑定哈希的 DESIGN.md。已确认的可交互 Demo 是直接代码路线的视觉、内容与交互基线，前端工程师据此实现并通过浏览器验证。

Stitch 是用户在确认 Demo 后选择的可选路线。候选与 Demo 一致时由机器验证并封存；存在差异时，展示差异并由用户选择保留已确认 Demo 直接落地，或调整方案并重新确认。两条路线均冻结来源、结构、依赖和实现映射，并验证正式页面及任务交互。详细运行规范见 core/runtime/strict-replica.md。

## 6. 工程实施与追踪

`implementation-map.json` 是设计到代码的追踪矩阵。每项必须连接已确认 Demo 的对应节点、运行目标、token、数据/API、事件、权限、响应式、测试选择器与验收条件；选择 Stitch 时还须绑定相应 Stitch 节点。Existing 还必须通过 `implementation-audit.mjs`，验证基线入口和实施目标真实存在。

后端或接口范围必须有 `domain-model.json` 与 `api-contract.json`；真实样本由 `contract-verifier.mjs` 校验。前端基础交互库由项目和 Gate 2 决定，Radix、shadcn/ui、HeroUI 是可选实现路线，不是全局强制依赖。

## 7. 质量与验收

质量合同至少包括：可用任务、WCAG 目标、LCP/INP/CLS 阈值、视觉基线、验证类别。默认无障碍为 WCAG 2.2 AA；默认性能目标为 LCP ≤ 2500ms、INP ≤ 200ms、CLS ≤ 0.1，项目可在 Gate 1 以更严格目标替代。

Gate 3 证据可包括：

- 代码/单元、集成与运行时检查；
- 真实浏览器页面、截图、DOM、控制台与交互；
- 视觉批准截图、无障碍零遗留违规、性能环境与指标；
- API 请求/响应契约；
- 功能、响应式、整站和 Existing 回归。

没有合同要求的证据不得被假设为已通过；有要求却没有证据时 Gate 3 失败。

## 8. Token、上下文与安全

APEX 以阶段化上下文和结构化 JSON 作为 Token 治理方式：只读取当前阶段需要的规范，复用运行目录事实，不反复转述完整规则。敏感资料、凭据、生产数据和未授权外部系统不得写入 APEX Core 或输出产物；验证应使用脱敏样本和项目授权环境。

### 8.1 Router、Session 与全局 Skill 发布

APEX Bridge Skill 负责在 Codex 中命中 APEX；`apex-router.mjs` 是项目 run、session、阶段、审批和动作授权的唯一代码化入口；`apex-action.mjs` 只执行已登记且已经授权的运行脚本。新 Codex session 必须创建新的 run；同一 session 只能恢复自己绑定的 run；跨 session 交接必须显式授权。

每次 Router 调用都从唯一主目录 `~/.codex/apex/APEX` 自动发布最新 Bridge 到全局 `apex` Skill，并校验内容哈希。若发布或校验失败，Router 必须阻断执行，不得允许旧规则继续运行。已进入中的模型回复不能被本地文件反向注入，但该 session 的下一次 APEX Router 调用必定使用最新 Bridge。

所有项目中间产物只允许位于 `<project-root>/.apex/`；APEX Core 不得保存项目 run、效果图、Stitch 画布、截图、用户资料、测试证据或缓存。项目 mutation lease 防止不同 run 同时修改同一目标项目；动作授权绑定项目、run、session、Gate、动作、状态哈希和过期时间，任何状态变化都会使旧授权失效。

## 9. 操作顺序

1. 初始化运行态并判断 Greenfield / Existing。
2. 解析用户规范，产出 Intent Brief、Delivery Contract 与待确认项。
3. Existing 运行 `project-intake.mjs` 与 `baseline-collector.mjs`；后端范围补齐领域/接口合同。
4. 产品角色与设计师完成方案后，请用户确认视觉方案；生成并展示可交互 Demo，再请用户确认 Demo 并选择是否使用 Stitch。
5. 所选路线冻结已确认视觉事实，编译 Visual Bundle 和 Implementation Map，通过机器 Gate 2；Stitch 存在差异时先按用户选择处理。
6. 实施前后端，运行实现映射、接口与质量审计。
7. 生成 Verification Plan，采集浏览器、视觉、无障碍、性能、功能与回归证据，通过 Gate 3。
8. 建立 checkpoint 和可恢复的运行记忆。

## 10. 可审计交付包

每次 Full 交付至少保留 Intent Brief、Delivery Contract、视觉三件套、Implementation Map、相关领域/API 合同、验证计划与 Verification Bundle。主目录发布使用 `node scripts/release-audit.mjs`；项目交付使用 `node scripts/apex-validate.mjs gate3 <run-dir>`。

## 11. 参考标准与状态

- ISO/IEC/IEEE 29148:2018，需求工程；ISO 页面显示该版本 2024 年确认、2026 年处于修订流程。
- ISO/IEC/IEEE 42010:2022，架构描述的结构、架构视角和模型类别要求。
- ISO/IEC/IEEE 12207:2026，软件生命周期过程；替代已撤销的 2017 版。
- ISO/IEC 25010:2023，软件与 ICT 产品质量模型。
- W3C WCAG 2.2，2024-12-12 Recommendation。
- NIST Secure Software Development Framework（SSDF），安全软件开发治理参考。

外部标准不自动赋予项目合规性；适用性、行业法定要求和认证结论必须由项目责任方确认。
