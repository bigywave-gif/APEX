# APEX 调用协议（发布版本以 `manifest.yaml` 的 `version` 为准）

## 入口

```text
[APEX]
任务：
范围：
目标：
阶段要求：
约束：
```

可显式指定：

```text
Track: Greenfield | Existing

轨道默认由 Router 自动判定，不是用户确认项：判定只读取项目正式代码；Git 仓库以已跟踪源码为准，非 Git 仓库必须排除 `.apex`、visual-sandbox、runtime-demo 与临时目录。正式代码存在可运行页面、视图或 UI 入口时使用 Existing；正式代码仅有 API、数据模型、服务端能力或尚无页面时使用 Greenfield，同时将已有 API、数据模型和认证/权限契约作为新界面的不可破坏输入。Gate 2 前生成的临时 Demo、截图、Stitch 与沙箱代码不能改变轨道，也不能充当 Existing 基线。不得因缺少 Existing 视觉基线要求用户重启或手工选择 Greenfield。
Scope: Lite | Standard | Full
Authorization: Interactive | Autonomous
Phase: Audit | Plan | Visual | Implement | Verify
```

未指定时由Intake根据事实判断，不机械依赖关键词。

APEX 在 Gate 1 前还会生成 `intent-brief.json` 和 `delivery-contract.json`。短需求不是阻塞条件：设计导演必须提炼目标、事实、假设、质量标准与待确认项；只有会改变业务语义、权限、外部依赖或不可逆迁移的决策才需要用户明确选择。

短需求进入 Gate 1 前还必须形成 `experience-strategy.json`，并由 `experience-evaluator.mjs` 写入通过的 `experience-quality-evidence.json`（阈值 85/100、无关键缺失）。策略必须把抽象目标转化为可验收的信息层级、数据问题/编码/交互、功能状态与验收、视觉系统、响应式、无障碍和动效决策；字段齐全但不能解释用户任务、数据表达或功能状态时不得通过。

## 调用确认

宿主识别到适用的前端、视觉或交互任务时，必须先说明 APEX 可提供的 Gate、来源锁定与运行时验证，并询问用户是否调用；不得自动创建 Run、执行 Router 或进入 Gate。只有用户给出明确同意（如“确认调用 APEX”）时，才进入以下首次响应。

## 首次响应

```text
APEX 已命中
Core 版本：`manifest.version`
轨道：Greenfield / Existing
范围：Lite / Standard / Full
授权：Interactive / Autonomous
当前阶段：……
本阶段目标：……
实现权限：关闭 / 开放
下一步：……
```

完整内部轨迹写入运行目录。默认用户输出保持简洁，不再强制每个原子步骤重复输入、判断、结论、禁止动作和下一步。

## Existing 强制基线

Existing 任务先运行 `project-intake.mjs scan` 生成只读 `project-inventory.json`；随后冻结本次迭代目标页面入口、路由及其传递项目依赖闭包为 `code-reference.json`，并导出 `page-skeleton.json`；再从已运行项目采集真实截图和 DOM 展示证据。APEX 必须以“客户需求 + 代码树 + 页面骨架 + 真实展示”生成并登记 `experience-strategy.json`，拆解信息架构、数据表达、前端功能、视觉方向和反模式。最后登记绑定上述哈希的 `existing-baseline.json`。效果图每个布局节点都必须映射到真实骨架节点；缺少真实展示、代码变更、映射不全或策略未绑定时，不得通过 Gate 1、生成正式效果图或 Stitch 画布。

Existing 基线完成后还必须自动编译 `change-scope.json`。局部调整以用户点名的页面、区域、组件或数据视图为起点，只纳入完成该改动所必需的传递运行依赖；所有其他基线文件与视觉节点形成不可变保护补集。`Lite / Standard / Full` 是执行深度，不是页面范围，不能把 Lite 局部改造扩张成全站方案。Gate 1 八节和视觉方案十节仍须完整，但每节只叙述本次受影响闭包；未调整内容只引用 Existing 基线，不重新罗列、不重新设计、不再次确认。Visual Source Manifest、运行时 Demo变更、Visual Bundle 与 Implementation Map 只能包含受影响节点和允许的代码目标，Gate 2 检查边界一致性，Gate 3 对保护文件哈希和同文件未调整节点执行回归验证。任何范围外变化必须失败，除非用户明确扩大范围并重新冻结 `change-scope.json`。

## 交付路线与确认

设计能力池的项目上下文是分析输入，不是交互流程：当 `impeccable` 等能力要求 `PRODUCT.md`、`DESIGN.md` 或初始化时，APEX 必须从已确认需求、项目基线与设计规范自动生成 run 内上下文，并继续需求拆解、候选比较和视觉方案生成。不得把能力池的初始化提示、产品定位草稿、文件写入或“下一步将生成”暴露为用户确认；宿主只能展示 Router 的 `userInteraction` 或 Demo 后 `nextRequiredDecision` 所定义的阀门。

1. Gate 1：确认需求方向、目标用户、产品与功能范围、信息架构、数据/API/权限、风险、交付边界与质量门槛。确认前先用聊天语言解释“当前确认什么、重点看什么、确认后自动发生什么、如何提出调整”，再完整展示 `gate1-presentation.md` 的八节正文：需求方向与成功标准；用户、场景与核心任务；轨道判断与正式基线；产品范围、页面与功能边界；信息架构、数据、API 与权限；交付路径、技术约束与不包含项；质量门槛、验证与验收；已知事实、假设、待决项与风险。文件列表、功能清单、原始 JSON 和一句摘要不能代替正文。
2. 视觉实施方案确认：Gate 1 确认后，必须先自动完成视觉方案生成，再完整展示并要求“确认视觉方案”；确认前禁止生成运行时 Demo。视觉方案确认需求拆解、页面布局、风格/颜色/字体/特效、内容和组件来源，以及每条动效的库、精确版本、API、待安装计划、性能和降级风险；若采用 3D/WebGL，还须确认 Three/Babylon 运行时、renderer、模型/纹理/环境资源、性能预算、静态降级和 reduced-motion。
   Gate 1 通过、正在分析、正在比较候选、已写入体验策略或“下一步将生成”等内容仅为内部进度，不得结束用户回合。`plan_visual` 成功后，Router 必须在 `confirmation.presentation.content` 返回完整十节展示稿；宿主必须在同一消息完整渲染该内容后才能显示“确认视觉方案”。
3. 运行时 Demo 生成（视觉流）：视觉实施方案确认后，Router 直接授权在隔离沙箱中生成可访问、可交互的运行时 Demo 并展示该 Demo。此时 `executionDirective` 强制宿主在同一执行回合完成生成与登记，禁止向用户显示“继续”、再次确认或进度轮询。它是唯一用户可审阅的视觉产物；DOM、源码来源、动效帧与内部截图均登记为机器证据，不另行展示或确认“效果图”。

所有活跃 APEX 阶段的用户交互由 Router 的 `userInteraction` 与 `terminalResponseContract` 共同裁决，而非聊天 UI 默认按钮。宿主结束每个回合前必须重新读取 Router；`terminalResponseContract.allowed: false` 时必须继续执行 `mustContinueAction`，不得用阶段状态结束回合；允许结束时也只能输出 `allowedKinds`、逐字使用 `exactLabels` 并先满足 `requiredPresentation`。关键阀门必须显示其精确 `confirmation.label`：`确认需求与交付方案`、`确认视觉方案`、`确认 Stitch 内容` 或 `确认实施冻结`；不得以“确认”“继续”或含混文案代替。Router 只有在该阀门的完整生成工件和机器校验均已就绪时才可暴露该标签：Gate 1 为 `pre-gate1` 校验通过；视觉方案为 `visual-execution-plan.json` 加十节完整的 `visual-plan-presentation.md`；Stitch 为已选择 Stitch 路线且已有冻结候选和一致性证据；实施为已冻结 Visual Bundle 与 Implementation Map。范围清单、重做声明、阶段说明和未完成草稿一律不可确认。只有用户明确执行该阀门确认才能向下流转；在此之前，任何补充都按 `unconfirmedInputPolicy` 视作当前工件调整，自动执行“反馈提取 → `revise` → 工件重建”，仍回到同一明确确认提示。若 Gate 1 已确认后又出现改变功能、数据、API、权限、范围或验收的新需求，必须执行 `revise ... gate1 visible ...`；Router 撤销旧 Gate 1 和全部派生视觉/实施锁，保留 Existing 正式只读基线，并重建八节需求与交付方案。不得只在聊天中“记录”后继续沿用旧方案。`genericContinueForbidden: true` 时，宿主必须持续执行当前工作，直至出现明确的 Gate 确认、`stitch|direct-code` 路线选择、Demo 或阻断报告，中间不得显示“继续”或把内部处理拆成新的用户操作。
4. 交付路线确认：Demo 生成完成后，用户明确选择 `stitch` 或 `direct-code`；普通“继续”不能代替选择。
5. Stitch 确认（Stitch 流）：仅在选择 `stitch` 后，将同一 Demo 的截图、DOM、内容锁与来源清单导入并严格校验 Stitch 候选；确认后才可 Seal Stitch。Stitch 不得重新设计或替换 Demo 的任何已锁定来源。
6. 直接代码路线：以已确认的运行时 Demo 为视觉基线，确认代码目标、组件/样式/动效来源、实现映射和直接代码实施方案，再确认实施冻结；不生成 Stitch，但不豁免任何确认、来源锁、Visual Bundle、Implementation Map、Gate 2 或 Gate 3。
7. Gate 2：机器验证共同效果图基线和所选路线的冻结基线、设计契约、依赖与实现映射后，才开放实施和已批准依赖安装。项目未安装但已确认的视觉库可在此前的既有 `generate_visual` 阶段，仅于 run-local `visual-sandbox` 中以锁定版本运行并采集证据；该沙盒不得修改项目 `package.json` 或 lockfile，Gate 2 后才可安装同一版本到项目。
8. Gate 3：以真实功能、视觉、无障碍、性能和回归证据完成交付。

每一个确认点之前都进入提示词迭代区：用户可基于当前工件连续调整提示词，APEX 记录调整及其影响，但绝不自动确认。用户补充并不天然构成基线变更：只有实际改变已冻结的布局、内容、组件、视觉 token、动效/3D、依赖、交互或实现映射时，才撤销受影响的效果图/Stitch/实施冻结。未改变冻结字段的补充只记录审计，不撤销确认或已开放实施权限。Gate 2 后，明确授权且不触碰这些冻结字段的纯实现改动保留实施权限，但交付前仍须重新通过 Gate 3。

用户也可明确要求跳过当前人工确认并直接进入下一步；宿主仅在收到“跳过/不需要本次确认/直接下一步”等明确指令时调用 `skip`。普通“继续”、提示词补充、查看工件、沉默或超时仍停留在当前确认点，绝不自动跳过。`skip` 仍要求该点的完整工件与机器前置，且不绕过 Gate 2、严格复刻或后续确认。

Gate 3 前用 `verification-planner.mjs generate <run-dir>` 将 Project Inventory 中项目声明的测试、构建、静态检查脚本编译为可审阅的验证计划。它只提出安全的已声明命令；视觉、无障碍、性能、接口契约等无法从代码安全推断的证据会明确列为缺口，必须补充，不能被“自动通过”。

## 响应式布局规范

视觉实施方案与 Visual Bundle 都必须包含同一 `responsive.contractId`。合同至少覆盖 `mobile`、`tablet`、`desktop` 三类视口，并逐项写明宽度范围、布局模式、三条以上组件重排规则、文字缩放、媒体处理、禁止非预期横向溢出的策略及可验证验收条件。禁止简单缩放桌面页面来冒充移动适配；表格、图表等必要横向滚动必须作为明确例外说明。Gate 3 的 `runtime-state-matrix.json` 必须绑定该合同：除三类代表视口外，每个宽度区间都须在最小、中间、最大宽度留下真实截图，并确认无横向溢出、重叠、裁切、文字不可读或比例漂移；任一项失败均不得通过。

当交付合同要求接口契约时，用 `contract-verifier.mjs verify <run-dir> <samples.json>` 按 `api-contract.json` 的端点与 JSON Schema 校验真实请求/响应样本，并将结果写到 `evidence/contract-verification.json`，再作为 verification plan 的 `contract` evidence check 登记。

视觉、无障碍、性能分别使用 `quality-evidence.mjs verify <run-dir> <visual|accessibility|performance> <input.json> [project-root]` 生成证据。视觉证据必须引用真实截图并逐屏获得批准；无障碍证据必须为合同指定 WCAG 目标且零遗留违规；性能证据必须记录测量环境并不超过 Delivery Contract 的 LCP、INP、CLS 阈值。

严格运行时基线模式适用于视觉实施方案确认后直接生成的运行时 Demo：Demo 不是 ImageGen 或提示词的产物。生成前必须形成 `runtime-source-lock.json`、`runtime-visual-baseline.json` 与 `runtime-demo.json`；每个视觉节点必须绑定已安装且精确版本的完整组件/动效 pattern、源码与样式文件、真实 props/theme/状态机配置，并通过真实浏览器的 Demo URL、DOM、内部截图和动效关键帧采集。截图只作 Stitch 导入与机器一致性证据，不作为面向用户的效果图。不得用 CSS 补丁或自行编写时间线仿制第三方完整样式；只提供动效原语的库必须绑定官方完整 demo/pattern 才可使用。动态效果还必须生成 `motion-capability-inventory.json` 与 `motion-capability-selection.json`，并锁定项目已有动效资产、已安装库与实现 API；每条动效必须绑定真实实现路径和至少两个预览时间点。选择直接代码时，已登记 Demo 仍为视觉基线，并继续锁定同一来源、动效能力、实现路径和 reduced-motion。Gate 2 验证共同 Demo 基线和所选路线到实现映射，Gate 3 验证实际运行代码、关键帧和 reduced-motion；任何断链都不得通过。

需要真实页面截图时，使用 `browser-capture.mjs capture <run-dir> <base-url> <browser-spec.json>` 调用全局 Playwright bridge。采集产物只记录真实截图和浏览器日志，永远不会自行把 `approved` 设为 true；通过必须由已冻结的 Stitch 画布及适用设计契约基线确认。

所有正式效果图在 Stitch 前还必须形成 `visual-source-manifest.json`：每个视觉节点必须分别锁定布局、组件、样式、图标/素材（如适用）和内容来源，并声明同一份代码目标、选择器与实现方式。效果图只能使用该清单中可追溯的资源；代码阶段不得重新检索“相似元素”或替换来源。Existing 实施与 Gate 3 前使用 `implementation-audit.mjs audit <run-dir> <project-root>` 验证 Implementation Map 消费这份来源清单、指向真实代码目标、保留基线入口、测试选择器与后端 API 映射；任何断链都写成失败证据，不能以效果图替代。

## 阶段直接入口

直接请求Visual、Implement或Verify时仍需验证前置产物。Implement入口必须先通过机器Gate 2；缺少状态或产物时回到最接近的缺失阶段，不从头重跑。

## 增强层

Stitch、设计Skill、素材MCP和其他工具只能增强阶段能力，不能改变轨道、Gate、权限锁和真实验收语义。增强层更新不得阻塞当前任务或未经确认改写能力池。

## Stitch 图文生成（仅运行时 Demo 路线）

Gate 1 与视觉实施方案确认后，APEX Visual 阶段先生成运行时 Demo；用户审阅的是 Demo 页面而非静态效果图。`runtime-demo.json` 必须锁定入口 URL、DOM、来源锁与浏览器证据；`visualReference` 与内部截图仅用于 Stitch 导入和严格比对。Demo 完整登记后，用户选择 Stitch 或直接代码；普通 `继续` 不可代替该路线选择。选择 Stitch 时，MCP 有原生图片参数则导入同一 Demo 的内部证据；否则 APEX 通过浏览器控制导入 Stitch UI，同时带入内容、布局、来源和动效锁。Screen 就绪后必须与 Demo 进行像素、结构和来源一致性校验，任一不一致不得进入 Stitch 确认。选择直接代码时，同一 Demo 直接作为 Gate 2/Gate 3 基线。Gate 3 前必须登记 `runtime-state-matrix.json`：至少两个视口、默认/加载/空/异常/无权限状态的适用性与证据、以及关键交互证据均需通过；不适用状态必须说明原因，不能静默省略。
