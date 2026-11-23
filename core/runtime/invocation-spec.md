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

## 用户终止当前 Run

用户明确输入“终止/取消当前 APEX 执行”时，宿主必须调用 Router `cancel`，并将原始用户语句作为意图输入，而不是仅停止聊天回合。Router 只接受明确指向当前执行、任务、Run 或工作流的终止语义；“修改当前方案”“方案有问题请重新分析”“调整布局”等修订语句会被拒绝为取消，必须转入当前 checkpoint 的 `revise`。
Router 只处理当前 session 绑定的 Run：先在持久账本中将 Run 和排队或运行中的 Agent 任务设为取消，撤销任务租约并保留账本；再用 Run ID、PID 命令与 Run-local 沙盒根目录确认服务归属，停止并确认临时 Demo 服务退出，回收该 Run 的临时工件。清理失败时取消栅栏仍生效，可在排除原因后重试。取消成功后，Run 仅保留 `state.json` 兼容投影、`run-ledger.sqlite` 持久审计账本、`events.ndjson` 和 `cancellation-receipt.json`；回执列出已回收条目、已停止服务和被隔离的 Agent 任务；受控本地工具检测取消后，在 Unix 系统终止自身进程组；Windows 仅请求终止直接子进程，后代进程停止情况须另行确认。停止或中断外部宿主 Agent 及远程服务也须单独确认，不能据本地结果推断。Stitch 上传或生成前须持久化意图，并通过项目级事务登记防止相同输入和目标在不同 Run 并发重复提交；输入和目标均可核实时，不同输入或明确不同的 Stitch 项目不应互相阻塞；旧任务缺少哈希或目标时按未知处理并提示核实。取消回执保留尚未完成的远程任务标识和输入哈希，状态不明时不得自动重复上传或生成。项目登记和 Run 账本之间若发生中断，保留未决登记并要求核实，不假定远程请求不存在。可通过 `node scripts/project-external-inspect.mjs inspect <run-dir>` 只读查看项目登记、相关 Run 意图和账本关联；该命令不会释放占位或触发远程请求。它绝不遍历其他 session/Run，不停止项目正式服务，也不回滚已通过 Gate 2 的正式代码。普通的宿主回合停止不推断为用户取消。

APEX 在 Gate 1 前还会生成 `intent-brief.json` 和 `delivery-contract.json`。短需求不是阻塞条件：设计导演必须提炼目标、事实、假设、质量标准与待确认项；只有会改变业务语义、权限、外部依赖或不可逆迁移的决策才需要用户明确选择。

## 新建 Run 的确认流程

新建 Run 默认使用 `two-confirmations`：产品角色先形成完整产品方案，设计师依据产品方案形成视觉方案，用户确认视觉方案后自动生成可交互 Demo；用户确认 Demo 后选择 Stitch 或直接代码路线。未发生超出已确认 Demo 的设计变化时，Stitch 与实施冻结使用内部校验，不增加独立确认。Router 根据当前 Run 的 `confirmationModel` 决定实际流程；旧 Run 的 `gate-summary-only` 状态继续按原流程恢复，下文旧模型说明不能覆盖新模型。

## 受控专业角色链

新建 Run 默认启用 `roleChain` 1.1。它将代码库调研、产品、交付、后端、UX、UI、前端、图表/动效（按需）、QA、实施规划、代码审查、证据收集与现实核验串联为**阶段内自动工作**。每个角色必须产生带输入哈希、事实/推断分类、证据、选择理由、验收条件与实际 Token 用量的 `role-advisory`；每项选择还必须对应同一 Run Ledger 内成功结算的专属 Agent Job。`role-advisory-manifest.json` 记录选中角色、版本和上游来源提交；Router 会同时校验 advisory 回执、选择清单和 Job 成功状态。Router 是唯一 Gate、状态与实施授权方，角色不能修改正式项目代码、安装依赖、创建确认或批准方案。

角色结果只在 Gate 汇总展示：Gate 1 和视觉方案须将当前阶段的“内部专业协作摘要”写入完整人类可读正文，实施与验证摘要进入相应冻结/证据工件。用户不会为单个角色确认，也不会看到“继续”。任何已选中角色失败都必须保留受控失败回执并由 Router 输出真实阻断；不得写入 `unverified` advisory、不得降级汇总、更不得把失败转成确认或继续。旧 Run 未启用 `roleChain` 时保持可恢复，以确保 Core 升级不破坏既有任务。

短需求进入 Gate 1 前还必须形成 `experience-strategy.json`，并由 `experience-evaluator.mjs` 写入通过的 `experience-quality-evidence.json`（阈值 85/100、无关键缺失）。策略必须把抽象目标转化为可验收的信息层级、数据问题/编码/交互、功能状态与验收、视觉系统、响应式、无障碍和动效决策；字段齐全但不能解释用户任务、数据表达或功能状态时不得通过。

## 调用确认

宿主识别到适用的前端、视觉或交互任务时，若当前会话尚无用户明确授权，先说明 APEX 可提供的 Gate、来源锁定与运行时验证并询问是否调用；用户已明确授权时沿用该授权，不重复询问。尚无授权时，首轮只输出“适用原因 + 会增加的 Gate/来源锁/运行时验证 + 是否调用 APEX？”，不得提前启动。用户明确同意后，宿主将本会话中**原始确认文本**传入 `intake` 的最后一项；Router 会拒绝缺少该原话或将 UI 请求、模型计划伪装成授权的 intake。成功登记后才进入以下首次响应。

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

Existing 基线完成后还必须自动编译 `change-scope.json`。局部调整以用户点名的页面、区域、组件或数据视图为起点，只纳入完成该改动所必需的传递运行依赖；所有其他基线文件与视觉节点形成不可变保护补集。`Lite / Standard / Full` 是执行深度，不是页面范围，不能把 Lite 局部改造扩张成全站方案。`gate-summary-only` 旧模型的 Gate 1 八节和视觉方案十节须完整；`two-confirmations` 局部任务按 Router 要求简述问题、改法和样式来源，整站方案按范围完整展示。各模型均只叙述本次受影响闭包；未调整内容只引用 Existing 基线，不重新罗列、不重新设计、不再次确认。Visual Source Manifest、运行时 Demo变更、Visual Bundle 与 Implementation Map 只能包含受影响节点和允许的代码目标，Gate 2 检查边界一致性，Gate 3 对保护文件哈希和同文件未调整节点执行回归验证。任何范围外变化必须失败，除非用户明确扩大范围并重新冻结 `change-scope.json`。Existing 的用户确认依赖当前基线：正式项目代码、页面骨架或浏览器展示证据一旦与 `existing-baseline.json` 不一致，Router 必须撤回旧模型的 Gate 1 确认或新模型的合并视觉方案确认，返回 `no-user-input` 与 `collect_existing_baseline`；不得先显示确认、再在视觉阶段报告基线阻断。

Gate 1 与视觉方案的用户可读正文也属于该边界。Existing 局部任务在工件写入时必须通过 `affected-closure-only` 展示校验，并把结果登记到 presentation manifest；Router 暴露确认前必须重新校验正文与当前 `change-scope.json`。正文必须点名全部受影响视觉节点，不得出现保护补集的页面、路由、视觉节点、数据视图或代码目标，不得使用“全站/整站/全部页面/所有页面”扩大范围；未调整内容只允许使用一句固定的 Existing 基线引用，不得罗列保护内容。旧工件、手工修改正文或缺少该校验结果时，Router 必须保持 `no-user-input` 并重建当前方案，不得向用户显示确认。

整站改造的视觉执行方案须对 `change-scope.json` 中每个受影响页面说明现状问题、改法、理由和目标效果；`deliveryNarrative.changes` 每项用 `pages` 数组列出对应的冻结页面标识（或 `scope` 精确等于单个页面标识）。共同问题可绑定多个页面，不得包含范围外页面。该映射只证明方案覆盖，不替代真实网站基线或专业判断。

验证计划执行结果中的 `verificationStatus` 只表示已声明检查的汇总结果；新模型返回的 `gate3` 是 Router 状态中的实际 Gate 3 状态。即使验证计划通过，也须完成设计复核、证据封存和剩余 Gate 校验后才能声明最终交付通过。

新生成的验证包也分别记录 `verificationStatus` 与生成时的 `gate3` 状态；该状态是生成时快照，最终 Gate 结果以 Router 当前状态为准。历史验证包没有 `verificationStatus` 时，兼容读取其旧版 `gate3` 检查汇总字段，不据此单独认定最终交付。

## 交付路线与确认

本节编号 1–6 中的独立 Gate 1、Stitch 和实施冻结确认仅适用于 `gate-summary-only` 旧 Run；新 Run 依照上方 `two-confirmations` 和 Router 返回的实际确认与路线决策执行。自动节点、证据与授权约束对两种模型均适用。

设计能力池的项目上下文是分析输入，不是交互流程：当 `impeccable` 等能力要求 `PRODUCT.md`、`DESIGN.md` 或初始化时，APEX 必须从已确认需求、项目基线与设计规范自动生成 run 内上下文，并继续需求拆解、候选比较和视觉方案生成。不得把能力池的初始化提示、产品定位草稿、文件写入或“下一步将生成”暴露为用户确认；宿主只能展示 Router 的 `userInteraction` 或 Demo 后 `nextRequiredDecision` 所定义的阀门。

1. Gate 1：确认需求方向、目标用户、产品与功能范围、信息架构、数据/API/权限、风险、交付边界与质量门槛。确认前先用聊天语言解释“当前确认什么、重点看什么、确认后自动发生什么、如何提出调整”，再完整展示 `gate1-presentation.md` 的八节正文：需求方向与成功标准；用户、场景与核心任务；轨道判断与正式基线；产品范围、页面与功能边界；信息架构、数据、API 与权限；交付路径、技术约束与不包含项；质量门槛、验证与验收；已知事实、假设、待决项与风险。文件列表、功能清单、原始 JSON 和一句摘要不能代替正文。
2. 视觉实施方案确认：Gate 1 确认后，必须先自动完成视觉方案生成，再完整展示并要求“确认视觉方案”；确认前禁止生成运行时 Demo。视觉方案确认需求拆解、页面布局、风格/颜色/字体/特效、内容和组件来源，以及每条动效的库、精确版本、API、待安装计划、性能和降级风险；若采用 3D/WebGL，还须确认 Three/Babylon 运行时、renderer、模型/纹理/环境资源、性能预算、静态降级和 reduced-motion。
   Gate 1 通过、正在分析、正在比较候选、已写入体验策略或“下一步将生成”等内容仅为内部进度，不得结束用户回合。Gate 1 通过后缺少 `visual-execution-plan.json` 是 Router 指定的 `plan_visual` 自动工作条件，不是阻断条件：宿主必须先取得授权、实际执行候选分析与方案编译；未产生失败 operation receipt 前不得以“工件尚未生成”向用户报告无法继续。`plan_visual` 成功后，Router 必须在 `confirmation.presentation.content` 返回完整十节展示稿；宿主必须在同一消息完整渲染该内容后才能显示“确认视觉方案”。
3. 运行时 Demo 生成（视觉流）：视觉实施方案确认后，Router 直接授权在隔离沙箱中生成可访问、可交互的运行时 Demo。此时 `executionDirective` 强制宿主在同一执行回合完成生成、登记和展示回执，禁止向用户显示“继续”、再次确认或进度轮询。登记后默认以 `present-runtime-demo` 准备当前 Run 的 `runtime-demo.json.chatPreview`，在本轮最终回复输出返回的 `presentation.contentReference`；片段和 HTTP 验收页必须由同一源码生成并绑定哈希。仅不兼容聊天内嵌时才打开当前 Run 的 `runtime-demo.json.url` 并说明回退原因；该 URL 必须与 `visual-sandbox-runtime.json.url` 相同，根目录必须是当前 Run 的 `visual-sandbox`。`file://`、正式项目服务或其他 Run 一律拒绝。展示回执存在前，Router 不会给出路线选择，也不会允许 Stitch、实施冻结、Gate 2 或正式代码写入。它是唯一用户可审阅的视觉产物；DOM、源码来源、动效帧与内部截图均登记为机器证据，不另行展示或确认“效果图”。仅 `gate-summary-only` 旧 Run：若用户在该自动链尚未完成登记时已明确说“直接代码/直接生成代码”，宿主可按 Router 的旧模型规则调用 `select-route` 写入当前 Run、当前 session 的 `pendingDeliveryRoute` 回执；相同 Demo 展示并登记后，按旧模型处理该路线。`two-confirmations` 新 Run 不得将提前表达的路线偏好视为对尚未展示的 Demo 的确认；必须先展示交互式 Demo，取得用户对该 Demo 的明确确认，再按 Router 的路线决策继续。运行时来源展示名到规范包名的受控标准化（例如 `Apache ECharts` 到 `echarts`）只有在 Router 逐字段比较证明其余视觉、交互、内容、版本与来源均不变，并能绑定原视觉确认回执时，才可自动恢复原视觉确认并续跑 Demo；否则它仍是影响视觉方案的变更，必须回到“确认视觉方案”。

所有活跃 APEX 阶段的用户交互由 Router 的 `userInteraction` 与 `terminalResponseContract` 共同裁决，而非聊天 UI 默认按钮。以下四个旧标签及其阀门映射仅适用于 `gate-summary-only`；`two-confirmations` 以 Router 返回的视觉方案确认、Demo 确认及其后路线决策为准。宿主结束每个回合前必须重新读取 Router；`terminalResponseContract.allowed: false` 时必须继续执行 `mustContinueAction`，不得用阶段状态结束回合；允许结束时也只能输出 `allowedKinds`、逐字使用 `exactLabels` 并先满足 `requiredPresentation`。关键阀门必须显示其精确 `confirmation.label`：`确认需求与交付方案`、`确认视觉方案`、`确认 Stitch 内容` 或 `确认实施冻结`；不得以“确认”“继续”或含混文案代替。Router 只有在该阀门的完整生成工件和机器校验均已就绪时才可暴露该标签：Gate 1 为 `pre-gate1` 校验通过；视觉方案为 `visual-execution-plan.json` 加十节完整的 `visual-plan-presentation.md`；Stitch 为已选择 Stitch 路线、冻结候选、一致性证据，以及由 `confirmation-presentation.mjs` 在同一受控动作中产出的六节 `stitch-presentation.md` 与来源清单；实施为已冻结 Visual Bundle、Implementation Map，以及同样受控生成并绑定来源的六节 `implementation-presentation.md` 与来源清单。范围清单、重做声明、阶段说明和未完成草稿一律不可确认。只有用户明确执行该阀门确认才能向下流转；在此之前，任何补充都按 `unconfirmedInputPolicy` 视作当前工件调整，自动执行“反馈提取 → `revise` → 工件重建”，仍回到同一明确确认提示。若 Gate 1 已确认后又出现改变功能、数据、API、权限、范围或验收的新需求，必须执行 `revise ... gate1 visible ...`；Router 撤销旧 Gate 1 和全部派生视觉/实施锁，保留 Existing 正式只读基线，并重建八节需求与交付方案。不得只在聊天中“记录”后继续沿用旧方案。`genericContinueForbidden: true` 时，宿主必须持续执行当前工作，直至出现明确的 Gate 确认、`stitch|direct-code` 路线选择、Demo 或阻断报告，中间不得显示“继续”或把内部处理拆成新的用户操作。

重复 Stop 不构成自动节点的完成信号。只要 `terminalResponseContract.allowed` 为 `false` 且不存在带回执的 `blockingOperation`，宿主必须保持当前回合受控，即使 `mustContinueAction` 与 `currentStep` 未变化；未变化只表示该动作尚未完成，不能以“已提示一次”为由放行。此规则覆盖 Gate 1、视觉方案、运行时 Demo、Stitch、实施冻结和 Gate 2/3 验证的所有自动节点。

### 自动节点完整性（不得以阶段文案代替可执行链）

`scripts/workflow-node-registry.mjs` 是 Router 自动节点的唯一注册表。每个 `executionDirective.currentStep` 必须同时带有注册的 `nodeId`、受控执行器、输入策略、必需输出、完成条件、状态提交方式、重试策略和失败策略；没有注册项、动作不匹配或 Router 声明的输出少于注册输出时，Router 必须作为 Core 配置错误拒绝返回该步骤，不能把不完整步骤暴露成用户等待状态。

“文件存在”不是步骤完成。确认正文至少要满足标题顺序、每节实质内容、无模板占位符、各节内容不重复、当前来源哈希与受控动作回执；Stitch 与实施冻结还必须保存每节正文的哈希和对应事实字段。正文和清单必须先原子写入，再原子发布 `state.json` 引用；因此异常最多留下未引用的可重建临时工件，不能留下可确认的半正文。任何未能通过这些后置条件的动作只能继续重建其内部输入，或在已有实际失败回执时返回一次带类型的阻断报告，绝不能显示确认按钮或泛化“继续”。

以下独立 Stitch 与实施冻结确认仅适用于 `gate-summary-only`；`two-confirmations` 按 Router 自动验证，且须先明确确认 Demo。旧模型中，该连续执行约束不止适用于 Gate 1→视觉方案和视觉方案→Demo。Demo 路线选择后，Stitch 路线必须自动同步、导出并校验候选，直到可完整展示“确认 Stitch 内容”；直接代码路线必须自动编译 Visual Bundle、物化已选来源并生成 Implementation Map，直到可完整展示“确认实施冻结”。实施冻结确认后必须自动运行 Gate 2 机器校验并开启实施权限。任何自动阶段的缺少工件在**实际受控操作执行前**都只能被标记为待完成工作，不能被报告为阻断、不能显示泛化确认或“继续”；只有失败 operation receipt、可观察错误与缺失清单同时存在时才能结束为阻断报告。
4. 交付路线确认：Demo 生成完成后，用户明确选择 `stitch` 或 `direct-code`；普通“继续”不能代替选择。
5. Stitch 确认（Stitch 流）：仅在选择 `stitch` 后，将同一 Demo 的截图、DOM、内容锁与来源清单导入并严格校验 Stitch 候选；确认后才可 Seal Stitch。Stitch 不得重新设计或替换 Demo 的任何已锁定来源。
6. 直接代码路线：以已确认的运行时 Demo 为视觉基线，确认代码目标、组件/样式/动效来源、实现映射和直接代码实施方案，再确认实施冻结；不生成 Stitch，但不豁免任何确认、来源锁、Visual Bundle、Implementation Map、Gate 2 或 Gate 3。
7. Gate 2：机器验证共同效果图基线和所选路线的冻结基线、设计契约、依赖与实现映射后，才开放实施和已批准依赖安装。项目未安装但已确认的视觉库可在此前的既有 `generate_visual` 阶段，仅于 run-local `visual-sandbox` 中以锁定版本运行并采集证据；该沙盒不得修改项目 `package.json` 或 lockfile，Gate 2 后才可安装同一版本到项目。
8. Gate 3：以真实功能、视觉、无障碍、性能和回归证据完成交付。

每一个确认点之前都进入提示词迭代区：用户可基于当前工件连续调整提示词，APEX 记录调整及其影响，但绝不自动确认。用户补充并不天然构成基线变更：只有实际改变已冻结的布局、内容、组件、视觉 token、动效/3D、依赖、交互或实现映射时，才撤销受影响的效果图/Stitch/实施冻结。未改变冻结字段的补充只记录审计，不撤销确认或已开放实施权限。Gate 2 后，明确授权且不触碰这些冻结字段的纯实现改动保留实施权限，但交付前仍须重新通过 Gate 3。

调整还必须按影响范围处理：新任务创建新的 run，不继承任何旧确认、方案或工件；仅影响当前未确认 checkpoint 的调整，自动重建当前工件并返回同一个精确确认标签；若调整改变已确认的上游 checkpoint，必须从最早受影响 checkpoint 解锁，撤销全部派生工件与下游确认。Router 会返回 `revisionOutcome`：宿主必须先用聊天语言说明已解锁的确认、原因、失效范围、自动重建动作以及重建后的精确确认标签，例如“已解锁视觉方案；Demo、路线、Stitch 与实施冻结将重建；完成后请确认视觉方案”。这不是新增确认，也不显示“继续”：用户的实质调整即授权解锁；重建完成后才由用户重新确认被解锁方案。

用户也可明确要求跳过当前人工确认并直接进入下一步；宿主仅在收到“跳过/不需要本次确认/直接下一步”等明确指令时调用 `skip`。普通“继续”、提示词补充、查看工件、沉默或超时仍停留在当前确认点，绝不自动跳过。`skip` 仍要求该点的完整工件与机器前置，且不绕过 Gate 2、严格复刻或后续确认。

Gate 3 前用 `verification-planner.mjs generate <run-dir>` 将 Project Inventory 中项目声明的测试、构建、静态检查脚本编译为可审阅的验证计划。它只提出安全的已声明命令；视觉、无障碍、性能、接口契约等无法从代码安全推断的证据会明确列为缺口，必须补充，不能被“自动通过”。

在正式页验证中，来源证明是自动步骤而不是新的确认点：Browser Capture 自动从冻结的 Visual Source Manifest 导出每个节点的选择器、`data-apex-source` 标记与来源选择 ID，并在桌面、平板、移动端逐一核验。通过后将证据写入 `runtime-state-matrix.json.sourceProvenance`；没有这份浏览器绑定证据时，验证链必须继续修复或采集，不能跳过到 Proof/Gate 3，也不能让行业复核承担发现基础标记缺失的职责。

## 正式实施登记与变更恢复

机器 Gate 2 通过后，宿主先获取当前项目、Run、session 的 mutation lease，再申请 `implement` 授权，并仅在已审核 Implementation Map 的正式源码目标内实施。完成后创建 Run 内 `page-delta.json`，调用 Router `register-implementation <project-root> <run-id> <session-id> <authorization-ref> <lease-id> <page-delta-relative>`。Router 校验租约、授权、Gate 2、Site Contract、正式目标路径和文件哈希；Existing 还校验冻结的受影响范围和保护文件。不得通过修改 `state.json` 登记。

登记回执绑定项目、Run、会话、授权、租约、实施映射、page delta 与正式文件哈希。已登记文件变化会停止验证并要求重新登记；实质变化使旧浏览器捕获和下游验证结论失效，重采真实证据，但不撤销未变化的用户 Demo 确认。登记回执持久化后若状态提交中断，可用相同有效授权恢复同一回执；不匹配的内容必须使用新授权。

两次确认模型中新编译的视觉方案须在 `selectionAnalysis.skillRuleDecisions` 中逐条关联设计师实际采用的 taste-skill 和按需技能规则，字段为 `skill`、`rule`、`decision`、`rationale`、`sourceSelectionIds`。规则必须来自当前设计师回执，来源 ID 必须属于当前方案；这些映射及已确认视觉方案哈希由 Demo 来源编译器写入 Demo 清单，并在物化和浏览器证据读取时复核；同时随视觉来源交接。机器只检查关联完整性，规则适用性和视觉品质仍由设计师与用户判断。已确认的历史方案不因缺少该新增字段而自动失效。

Existing 项目的适配器推荐优先依据实际框架或明确的微前端依赖；普通 `platform` 或 `shell` 目录本身不足以高置信度证明平台架构。仅有目录提示时标为低置信度，须结合真实项目入口和运行方式复核；推荐不等于跨项目交付验收。

## 响应式布局规范

视觉实施方案与 Visual Bundle 都必须包含同一 `responsive.contractId`。合同至少覆盖 `mobile`、`tablet`、`desktop` 三类视口，并逐项写明宽度范围、布局模式、三条以上组件重排规则、文字缩放、媒体处理、禁止非预期横向溢出的策略及可验证验收条件。禁止简单缩放桌面页面来冒充移动适配；表格、图表等必要横向滚动必须作为明确例外说明。新 Run 的每个范围样本必须使用同次受控浏览器采集的文档滚动宽度与可视宽度验证横向溢出；缺少测量或发生文档级溢出时不得仅凭截图声明通过。该测量不替代对内部滚动容器、裁切、重叠和可读性的检查。Gate 3 的 `runtime-state-matrix.json` 必须绑定该合同：除三类代表视口外，每个宽度区间都须在最小、中间、最大宽度留下真实截图，并确认无横向溢出、重叠、裁切、文字不可读或比例漂移；任一项失败均不得通过。

当交付合同要求接口契约时，用 `contract-verifier.mjs verify <run-dir> <samples.json>` 按 `api-contract.json` 的端点与受支持的 JSON Schema 子集校验请求/响应样本，并将结果写到 `evidence/contract-verification.json`，再作为 verification plan 的 `contract` evidence check 登记。支持 type、required、properties、items、enum、const、additionalProperties、数值上下限、字符串长度和 pattern、数组长度；未支持的约束（包括 $ref、format 和组合关键字）会明确失败，不能忽略。合同、请求与响应 Schema、样本必须位于当前 Run；验证结果绑定其哈希，输入变化后须重新执行。手工样本只证明结构，在两次确认模型中标记为 unverified。需要真实接口证据时，先通过受控 `verify` 执行 `api-contract-capture.mjs capture <run-dir> <cases.json>`：cases 指定合同的 method、path、实际 route、request 与 expectedStatus；同一接口可配置多个场景，多个场景必须提供不同的 `caseId`，每个场景均会校验。接口可选用 `responseSchemas` 按明确状态码映射不同响应 Schema；配置后必须为每个采集状态码提供映射，不能静默回退，未配置时保留原有 `responseSchema` 兼容行为。状态码来自实际响应；手工样本须提供 `responseStatus`。采集要求当前实施登记和受控正式页面捕获，限定同一 loopback HTTP 来源，拒绝重定向，并记录实际 JSON 响应；随后用生成的 `evidence/api-observed-samples.json` 调用契约校验。采集、实施、页面、合同或样本变化会使证据失效。采集支持本地 JSON GET、POST、PUT、PATCH、DELETE，并可通过 `auth.bearerEnv` 指定 Bearer Token 环境变量；配置和证据不得包含凭据，若响应包含当前认证密钥则拒绝保存。认证采集使用项目私有密钥生成认证绑定，凭据变化或缺失时旧证据不可用于验收；执行后续验证时须提供相同环境变量。写请求的凭据变化也不能复用旧结果，明文凭据不写入账本或证据。写用例须提供 16–128 位安全字符的稳定 `executionId`，项目级账本在发送前记录意图：相同输入已完成时复用结果，超时、中断或失败时保持结果未知并阻止重发，须先检查测试服务；同一 ID 不能绑定不同输入。账本和身份标记缺失、损坏或不匹配时停止采集，需恢复原始账本及标记并核查；同时丢失全部持久记录或回退旧备份无法仅凭本机账本发现。应使用隔离测试数据和可重置服务；其他认证方式仍未支持。此证据不证明未测场景或远端部署。

视觉、无障碍和性能证据通过受控验证动作生成。两次确认模型中，合同要求无障碍或性能时，先使用当前正式项目验证清单中已声明且未变化的检查脚本，通过 `quality-measurement.mjs measure <run-dir> <accessibility|performance> <project-check-id>` 采集 JSON 报告；再以 `quality-evidence.mjs verify <run-dir> <accessibility|performance> <input.json> <project-root>` 登记结果，输入文件包含 `measurementPath` 指向当前 Run 的受控测量。报告须包含 `kind`、`tool.name`、`tool.version`、`environment`、`scope: "automated-checks-only"`；无障碍报告还须包含目标 `standard`、`violations` 和 `incomplete` 数组，性能报告须在 `metrics` 中给出合同要求的非负数值。测量与项目、当前实施登记、清单及 package.json 哈希绑定；缺少测量、未完成项、违规、超标或绑定过期不得标为通过。自动化检查通过只表示已执行的自动检查通过，不宣称完整 WCAG 合规或真实用户性能达标。旧模型保留原协议。视觉验证仍须绑定当前 Demo 和正式页面的真实结构与像素证据。

严格运行时基线模式适用于视觉实施方案确认后直接生成的运行时 Demo：Demo 不是 ImageGen 或提示词的产物。生成前必须形成 `runtime-source-lock.json`、`runtime-visual-baseline.json` 与 `runtime-demo.json`；每个视觉节点必须绑定已安装且精确版本的完整组件/动效 pattern、源码与样式文件、真实 props/theme/状态机配置，并通过真实浏览器的 Demo URL、DOM、内部截图和动效关键帧采集。截图只作 Stitch 导入与机器一致性证据，不作为面向用户的效果图。不得用 CSS 补丁或自行编写时间线仿制第三方完整样式；只提供动效原语的库必须绑定官方完整 demo/pattern 才可使用。动态效果还必须生成 `motion-capability-inventory.json` 与 `motion-capability-selection.json`，并锁定项目已有动效资产、已安装库与实现 API；每条动效必须绑定真实实现路径和至少两个预览时间点。选择直接代码时，已登记 Demo 仍为视觉基线，并继续锁定同一来源、动效能力、实现路径和 reduced-motion。Gate 2 验证共同 Demo 基线和所选路线到实现映射，Gate 3 验证实际运行代码、关键帧和 reduced-motion；任何断链都不得通过。

需要真实页面截图时，使用 `browser-capture.mjs capture <run-dir> <base-url> <browser-spec.json>` 调用全局 Playwright bridge。采集产物只记录真实截图和浏览器日志，永远不会自行把 `approved` 设为 true；通过必须由已冻结的 Stitch 画布及适用设计契约基线确认。

所有正式效果图在 Stitch 前还必须形成 `visual-source-manifest.json`：每个视觉节点必须分别锁定布局、组件、样式、图标/素材（如适用）和内容来源，并声明同一份代码目标、选择器与实现方式。效果图只能使用该清单中可追溯的资源；代码阶段不得重新检索“相似元素”或替换来源。Existing 实施与 Gate 3 前使用 `implementation-audit.mjs audit <run-dir> <project-root>` 验证 Implementation Map 消费这份来源清单、指向真实代码目标、保留基线入口、测试选择器与后端 API 映射；任何断链都写成失败证据，不能以效果图替代。

## 阶段直接入口

直接请求Visual、Implement或Verify时仍需验证前置产物。Implement入口必须先通过机器Gate 2；缺少状态或产物时回到最接近的缺失阶段，不从头重跑。

## 增强层

Stitch、设计Skill、素材MCP和其他工具只能增强阶段能力，不能改变轨道、Gate、权限锁和真实验收语义。增强层更新不得阻塞当前任务或未经确认改写能力池。 用户确认 Demo 并选择 Stitch 后，可在 `sync_stitch` 阶段调用 `stitch-sync.mjs skills <run-dir> list` 查询适配技能；确有需要时使用 `load <name> <sha256>` 加载当前内容并保留回执。`stitch-design-taste` 仅作为表达参考，任何与已确认 Demo 的布局、内容、交互、Token 或无障碍约束冲突的规则均不得采用；未安装或不适用时不强制加载，也不声称已使用。如选择采用，Stitch UI 导入计划须通过 `skillUse` 记录技能哈希、适用规则、排除规则及原因；导入器验证同一已确认 Demo 的技能加载回执，将适用规则并入实际提示并按最终提示计算哈希。是否真正符合设计仍以候选与 Demo 的严格验证为准。

## Stitch 图文生成（仅运行时 Demo 路线）

以下旧版独立 Stitch 确认描述只适用于 `gate-summary-only`；新 Run 在用户确认 Demo 并选择 Stitch 后，按 Router 的一致性验证或差异决策执行，不额外添加确认。

Gate 1 与视觉实施方案确认后，APEX Visual 阶段先生成运行时 Demo；用户审阅的是 Demo 页面而非静态效果图。`runtime-demo.json` 必须锁定入口 URL、DOM、来源锁与浏览器证据；`visualReference` 与内部截图仅用于 Stitch 导入和严格比对。Demo 完整登记后，用户选择 Stitch 或直接代码；普通 `继续` 不可代替该路线选择。选择 Stitch 时，MCP 有原生图片参数则导入同一 Demo 的内部证据；否则 APEX 通过浏览器控制导入 Stitch UI，同时带入内容、布局、来源和动效锁。Screen 就绪后必须与 Demo 进行像素、结构和来源一致性校验，任一不一致不得进入 Stitch 确认。选择直接代码时，同一 Demo 直接作为 Gate 2/Gate 3 基线。Gate 3 前必须登记 `runtime-state-matrix.json`：至少两个视口、默认/加载/空/异常/无权限状态的适用性与证据、以及关键交互证据均需通过；不适用状态必须说明原因，不能静默省略。

## Demo 交付形式：可交互 UI 原型

APEX Demo 统一为可交互 UI 原型，也称前端 Demo。按确认范围提供可操作的导航、关键任务、表单与状态反馈，使用明确标识的示例数据并提供重置入口；多角色任务支持切换预览视角。源码输入必须包含 `interactionContract`，浏览器实际执行全部任务并验证操作前后的可见变化；静态截图、自动播放动画和无效按钮不能替代交互验收。详情及字段格式见 `core/runtime/interactive-demo-contract.md`。

优先在宿主内嵌可操作预览；宿主不支持时在浏览器面板打开同一 Run 的 HTTP Demo，并说明展示方式。不能只贴截图或链接就登记已展示。保留现有来源锁、响应式要求和后续路线选择，不新增用户确认。
