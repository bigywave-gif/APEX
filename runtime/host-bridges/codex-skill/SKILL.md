---
name: apex
description: Use for every frontend, UI, visual-design, UX, interaction, page-visible content or state, layout, responsive, accessibility, screenshot-to-code, design audit, or component-consistency task—even a small visible field, button, style, permission, or status fix—and whether or not the user explicitly names APEX. This bridge skill must be selected from the prompt in new, continuing, and resumed sessions; it discovers the current APEX Core only from its canonical root, reads manifest.version, runs preflight, and follows the current invocation spec instead of improvising a parallel workflow.
---

# APEX Bridge Skill（以 manifest.version 为准）

## 确认模型与兼容规则

新建 Run 默认使用 `two-confirmations`。以当前 Router 状态返回的 `confirmationModel` 为准；`gate-summary-only` 及没有该字段的旧 Run 仍沿用下文旧版确认规则。新模型规则在有冲突时优先于下文的旧版四次确认描述。不得自行修改 Run 的确认模型或根据版本号推测模型。

新模型由产品角色先形成产品方案，设计师依据产品方案完成视觉方案；Router 返回 `确认视觉改造方案` 时按其 `presentation` 展示并记录 `visual-plan` 确认。局部改造只展示问题、改法与样式来源；整站设计或整站改造按 Router 输出完整方案。视觉确认后自动生成交互式 Demo；展示并等待用户明确确认，再将用户原话传给 `confirm-demo <project-root> <run-id> <session-id> <confirmation-id> <explicit-user-utterance>`。不得把路线选择或展示回执当作 Demo 确认。确认后才提供 Stitch 或直接代码路线。

选择 Stitch 后，严格一致时按 Router 指令自动验证和冻结；Router 返回 `stitch-difference` 时展示真实差异与原 Demo，允许用户保留 Demo 直接代码或提出调整并通过 `revise` 重建。实施映射、来源锁和 Gate 2 是受控自动操作，验证通过后再取得项目修改租约；不得添加独立的 Stitch 或实施冻结确认。Router 有明确阻断时报告真实失败，不伪造自动通过。任何模型下都必须保留角色、来源及验证约束。

## 回合结束硬约束（优先于任何阶段说明）

对于已绑定的 APEX run，基线采集、代码快照、DOM/截图采集、需求拆解、体验评估、角色
advisory、候选比较、工件写入和登记都只是**自动链内部步骤**，绝不能单独作为对用户的
结束输出。每次完成任一内部步骤后，必须立即重新调用 Router `status`，读取
`terminalResponseContract` 与 `executionDirective.currentStep`，并继续当前受控动作。

只有以下四类结果允许结束回合：Router 已暴露的完整命名确认（包括新模型的交互式 Demo 确认，且聊天导读与完整用户工件
均已输出）、Router 暴露的 Demo 后路线选择、已完成的交付结果，或携带实际操作
回执/观察错误/缺失工件的一次性阻断报告。若 `terminalResponseContract.allowed` 为 `false`，
任何“已完成基线”“已采集截图”“正在生成”“下一步将……”或文件卡片都只能作为 commentary，
不得结束、不得要求继续、不得等待用户。

## 唯一主目录

所有新建、继续和恢复中的 Codex session 只允许使用当前用户的 Codex 主目录：

`<CODEX_HOME>/apex/APEX`；未设置 `CODEX_HOME` 时固定为 `$HOME/.codex/apex/APEX`，即默认 `~/.codex/apex/APEX`。

不得将工作区、项目内或其他目录中的 `APEX/` 副本作为 APEX 运行根、规则真相源或升级目标。若该目录不可读或其 `manifest.yaml` 不是 4.x，停止并报告主目录问题；不得回退到副本。

所有涉及 APEX 的核心代码、Schema、Skill、规范文档、系统文档与正式交付输出，必须直接创建、读取和修改于该主目录及其子目录。不得因当前终端工作目录、临时工作区或项目副本而改变写入目标。工作区副本只能用于只读比对或明确标注的临时渲染；临时文件不得成为正式 APEX 交付物。

## 主目录识别约束

当用户询问“APEX 项目”“当前 APEX 版本”或 APEX 本体的需求、状态、审计、发布与能力时，默认审查对象是上述当前用户的唯一主目录，而非当前终端工作区。只有用户明确提供了另一个业务项目路径、仓库或部署地址时，才将其视为 APEX 所服务的目标项目。

若当前工作区为空、仅含 `.apex/` 运行产物，或未包含可识别的业务项目入口，不得据此判断 APEX 本体不存在、不可审计或未满足需求；必须先检查主目录中的 `manifest.yaml`、系统文档与 `release-audit.json`。APEX Core 本身不得作为 Router 的项目根，因为项目运行产物禁止写入 Core；对 Core 的审查应采用只读发布审计与版本检查。

## 默认执行顺序

1. 解析当前用户的 `<CODEX_HOME>`，读取 `<CODEX_HOME>/apex/APEX/manifest.yaml`。
2. 验证其 `version` 为 4.x。
3. 执行 `node <CODEX_HOME>/apex/APEX/scripts/preflight.mjs`；不得用文字检查冒充可执行预检。
4. 读取 `<CODEX_HOME>/apex/APEX/runtime/preflight.md`。
5. 读取 `<CODEX_HOME>/apex/APEX/core/runtime/invocation-spec.md`。
6. 通过 Preflight 后，先向用户说明 APEX 会带来的 Gate、工件与确认开销，并只输出授权提问；在该条回复中不得说“会使用/将使用 APEX”、不得规划 APEX 流程、不得调用 Router、不得创建 Run。仅在用户下一条消息给出明确确认调用 APEX 后，才把**原始确认文本**作为 intake 最后一个参数，调用 `<CODEX_HOME>/apex/APEX/scripts/apex-router.mjs` 创建该项目的当前 APEX 运行态。

每次 APEX Router 调用都会先从主目录自动发布本 Bridge 到全局 Skill，并校验两者哈希
完全同步；发布失败时 Router 必须阻断，不得允许已发布文件本身处于旧版本。

已打开 session 在下一次 APEX Router 调用时必须自动加载当前 Core/Bridge：Router 先同步全局
Bridge，再将该 session 的绑定版本与哈希重绑到主目录版本，随后才返回状态、授权或执行动作。
安装器还会注册非阻断的 `PreToolUse` 刷新守卫：已绑定 session 的下一次工具调用前，会执行
`refresh-session`，使旧会话在进入 APEX 工具链前重绑当前 Core。旧绑定仅保留为
`previousBridge` 审计记录，不能要求用户新开 session、手动刷新或显式交接。任何会改变阶段、确认或实现权限的裁决都只以这次自动刷新后的 Router 输出为准。

注意：已被 Codex 宿主注入到模型上下文的历史 Skill 文本不能由 APEX 文件自行回写。若宿主提供
“用户消息前 / BeforeTurn”生命周期，应将同一个 `refresh-session` 守卫接入该事件，才能在模型开始
阅读新消息前完成热更新；当前已知 Hook 配置仅安全使用 `PreToolUse` 与 `Stop`，不得伪造未受支持的 Hook。

## 代码化调用路由

本 Skill 是 Codex 的发现与接入层，不是 Gate、阶段或工具权限的裁决者。每次
命中后都必须先由 `apex-router.mjs` 返回项目、run、当前阶段与 `allowedActions`。

1. 仅在本 session 已收到用户原话中的明确 APEX 授权后，才可执行 `node scripts/apex-router.mjs intake <project-root> <new-run-id> auto [scope] [authorization] <session-id> <explicit-user-apex-consent>`；最后一项必须逐字传入用户授权，Router 会拒绝缺失、UI 请求、模型计划或“我会使用 APEX”等伪授权。未授权时只允许询问，例如：“此改动涉及页面展示与交互。是否调用 APEX？它会增加来源锁、运行时 Demo 与关键确认门。”不得创建或恢复 Run，也不得输出任何 APEX 规划、阶段、进度或工具调用宣告。不得自动复用任何旧 run。`session-id` 优先使用宿主提供的真实 thread/session 标识；若宿主仅允许内部别名，PreTool Hook 必须在该 session 执行 Router 命令时记录“真实 host thread → 精确 APEX 别名”的项目内桥接记录，Stop Hook 只能使用这一**精确映射**继续对应 run，绝不能扫描、猜测、闲置、接管或影响同项目的其它 session/run。`auto` 是默认且必须使用的轨道判定：只以项目正式代码为依据——Git 仓库优先读取已跟踪源码，非 Git 仓库排除 `.apex`、visual-sandbox、runtime-demo 和临时目录后读取项目源码。只有正式代码中存在页面/视图/UI 入口时才为 Existing；只有 API、数据模型、服务端或无正式页面时为 Greenfield，并自动把既有 API/数据模型作为保留契约输入。Gate 2 前的 Demo、沙箱代码、截图、Stitch 工件和其他 run 产物绝不能成为轨道判断依据，也不能把 Greenfield 改判成 Existing。不得将“没有 Existing 视觉基线”呈现为阻断、要求用户回复“按 Greenfield 重启”，或要求用户手选轨道；只有用户明确指定 Existing/Greenfield 时才传显式轨道。
2. 仅同一 session 可以执行 `node scripts/apex-router.mjs resume <project-root> [run-id] <session-id>` 恢复其已绑定 run。若用户明确说“重新执行 / 从头开始 / 重新按照需求执行”，必须使用 `restart`：创建全新 run，从入口重新完成需求、真实产品页面基线、Gate 1 与视觉方案；旧 run 仅保留审计，不得继承 Gate、方案、基线、工件或授权。只有明确的同一任务补充/澄清才使用 `reinvoke ... continue`；独立任务使用 `reinvoke ... new-task`，且与首次 intake 一样必须附带该新任务的原始明确 APEX 授权，不能沿用旧任务同意。不得直接再次 intake。跨 session 默认必须新建 run；后续如需交接，必须使用显式交接流程。
3. 只可执行 Router 返回的 `allowedActions`；直接请求 Visual、Implement、Verify 或 Release 也不能绕过该规则。
4. 修改项目代码前先获取 `lease`，再执行 `authorize ... implement <lease-id>`；没有当前项目、run 与 session 绑定的 lease，禁止实施。
5. 所有项目中间产物只允许写入 `<project-root>/.apex/`。严禁将项目 run、截图、运行时 Demo、Stitch HTML、测试证据、缓存或用户资料写入 APEX Core。
6. Gate 2 后需要隔离代码改动时，先取得 lease 和 `prepare_workspace` 授权，再通过受控 action 创建该 run 的 Git worktree；不得把 worktree 当作绕过 Router 的项目根。
7. 只有用户原话明确表达“取消/终止/停止当前 APEX 执行（或当前任务/Run）”时，宿主才可把该原话传给 `cancel`；Router 会拒绝没有当前执行目标、或同时包含“修改、调整、重新分析、重新设计、方案有问题、优化”等修订语义的取消请求。后者必须走当前 checkpoint 的 `revise`，不能删除 Run。通过校验的 `cancel` 只回收当前 session 绑定 Run 的临时工件，并先停止该 Run 登记的临时 Demo 服务和端口；只保留最小取消回执，绝不清理其它 session/Run、项目正式服务或已获批准的正式代码。不得把宿主的普通回合停止自动当作取消。并发实施仍使用 `queue-mutation` / `claim-mutation` 的 FIFO 队列，不得争抢或手工覆盖 lease。
8. 用户对 Gate 候选提出编辑或拒绝时，用 `review ... edited|rejected` 留存复核事实，再按 `restart` 或当前受控阶段处理；不得把拒绝视为批准。

对于已有 APEX 运行脚本，先调用 `authorize` 取得 `authorizationRef`，再使用：

`node scripts/apex-action.mjs run <project-root> <run-id> <session-id> <authorization-ref> <action> <apex-script> [args...]`

其中 Existing 基线使用 `collect_existing_baseline`，Stitch 严格复刻使用
`sync_stitch`，Visual Bundle 使用 `compile_visual_bundle`，浏览器、契约、质量和
回归验证使用 `verify`。不得由 Skill 直接调用这些底层运行脚本。

以下 Gate 1 独立确认链仅适用于 `gate-summary-only` 旧 Run；`two-confirmations` 仍须形成完整产品方案，但不单独向用户确认，继续生成合并视觉方案。旧模型的 Gate 1 自动链必须实际完成“需求/交付契约 → 体验策略 → 八节 `gate1-presentation.md` → 登记 → 展示”。生成八节正文时，宿主必须以 `analyze_requirement` 授权通过 `apex-action.mjs` 调用 `contract-recorder.mjs gate1-presentation`；随后重新取得新的同动作授权，并调用 `node scripts/apex-router.mjs register-gate1-presentation <project-root> <run-id> <session-id> <authorization-ref>`。只有该登记成功、Router 返回 `确认需求与交付方案` 后，才可用聊天导读加完整八节正文呈现唯一确认。

所有确认模型均不得调用或导入 `apex-run.mjs`：它是内部拒绝入口，不是状态注册 API；不得以文件卡、进度句或空方案要求确认。

若项目根目录、run 选择或宿主能力不明确，Router 必须返回 `blocked` 或
`selection-required`；不得根据聊天上下文猜测后继续实施。

## 全局路由

每个新建、继续或恢复 session 都必须依据用户当前提示词识别 APEX 是否适用，但不得仅因命中而自动创建 Run 或调用 Router。用户已在当前会话明确授权调用 APEX 时，授权持续有效，无须再次询问；创建 Run 时将该原始授权文本传入 `intake`，不得由宿主伪造。尚无明确授权时，先说明适用原因及会增加的 Gate、来源锁和运行时验证，再询问是否调用；等待答复时不得启动 APEX。

以下任务及自然语言等价表达均必须命中：页面、前端、界面、UI、UX、视觉、设计、布局、组件、样式、表单、按钮、可见状态、页面权限、响应式、无障碍、交互、动画、截图还原、页面审计、视觉改造、设计系统、体验优化。

纯后端、纯数据、纯服务端接口或纯文档任务可以不建议 APEX；用户可见页面、交互或展示结果应提示 APEX 可用及其收益，但最终是否调用由用户确认。任务规模只影响确认后的 `Lite / Standard / Full`，不替代调用授权。

## 强约束

- 所有 APEX run 同时遵守五项不可互相牺牲的运行约束：**流程严格**（只按 Router 路由与既定 Gate 推进）、**内容完整**（用户可读叙事和机器工件均齐备才出现确认）、**执行连续**（确认阀门之间自动完成全部工作）、**执行高效**（增量索引、变更闭包和受控并行，避免重复全量扫描）、**Token 合理**（只加载当前阶段索引、摘要、已冻结契约和变化依赖闭包）。不得以提速为由跳步骤或省工件，也不得以完整为由每轮重读无关文件；Router 返回的 `operatingConstraints` 是宿主每一回合的执行边界。
- 向用户提出任何确认时必须遵守 `confirmation.presentation.renderPolicy`。先用自然聊天语言完整渲染 `chatOrientation`：说明“当前确认什么、重点看什么、确认后自动发生什么、未确认时如何调整”；随后在同一条**持续流式输出**中完整展示对应用户可读工件，最后才显示唯一的精确确认标签。若 `confirmation.presentation.streaming.enabled` 为真，宿主必须先立即输出其 `start`，再按 `sections` 顺序持续输出 `progressFormat` 与该节正文；每节输出后继续生成下一节，不能等待全文完成才首次响应。正文使用说明、标题、清单和必要表格，禁止以原始 JSON、内部哈希或文件列表作为主要阅读内容；哈希仅进入来源与审计附录。确认按钮、确认文案、通用“继续”、部分批准或文件卡片在流式输出期间一律禁止；只有所有章节、来源绑定和最终校验完成后，才可以显示精确确认标签。`two-confirmations` 以 Router 的 `renderPolicy` 和实际 `requiredSections` 为准：局部改造简述问题、改法与样式来源，整站设计或改造展示完整方案；Demo 是第二次确认。旧模型才按其 Router 返回的八节、十节、Stitch 或实施冻结内容展示。宿主未完成“聊天导读 + 完整正文”时不得显示确认按钮、不得记录 approval。
- **确认恢复语义**：只要 Router 返回 `terminalResponseContract.allowedKinds: ["named-confirmation"]`、`confirmation.approvalStatus: "pending-user-confirmation"` 或 `confirmationPending: true`，且没有 `approvalRecovery`，该确认就尚未通过。即使刚完成基线重建、工件重登记或恢复到原确认节点，也必须在聊天中完整重新呈现当前工件，并仅显示 `exactLabels` 中的确认标签；链接、文件卡片或“查看重建方案”不能替代正文。若 Router 返回已记录的批准回执恢复信息，则该回执是唯一用户决策，宿主必须等待 Router 自动推进或输出一次带回执的阻断报告，绝不能再次渲染同一确认。只有 Router 显示相应 Gate 为 `passed` 且没有待确认 checkpoint 时，才能宣称确认已通过。
- APEX 是唯一的流程编排者。`impeccable`、`ui-ux-pro-max-skill`、`taste-skill`、`google-design-md` 及任何设计 Skill 只能作为**内部非交互能力**：从当前需求、Existing 基线或 Greenfield 标准中提炼产品定位、信息架构、审美约束、候选比较与设计上下文。不得执行这些 Skill 的独立 `init`、项目上下文确认、命令推荐、`PRODUCT.md` / `DESIGN.md` 确认或任何“继续”流程。若其原生指令称缺少 `PRODUCT.md`、`DESIGN.md` 或其他上下文文件，宿主必须自动将其生成为当前 run 的内部工件，再继续 APEX 分析；这些文件不是用户确认点，也不能先于需求分析向用户提问。
- `apex-recover.mjs` 返回 `status: waiting` 时，先检查 `deferredOperations`：`gateway-live` 或 `subprocess-group-live` 必须等待已有本机进程实际结束，不得重新启动对应动作；`owner-unverified`、`gateway-status-unverified`、`subprocess-group-unverified` 或不可读回执须保留并调查，不能视为已退出。确认状态变化后用新授权重新读取 Router；本机进程组退出不证明外部副作用已停止。
- 每次向用户渲染任何按钮、提问、阶段文本或结束当前回合前，宿主必须重新调用 Router `status`，并同时服从 `userInteraction`、`nextRequiredDecision`、`capabilityExecution` 与 `terminalResponseContract`。`terminalResponseContract.allowed: false` 时只能继续执行 `mustContinueAction`；阶段说明只能作为 commentary，不能结束回合。`allowed: true` 时也只能输出 `allowedKinds` 并逐字使用 `exactLabels`，且必须先满足 `requiredPresentation`。`capabilityExecution.mode: internal-non-interactive` 时，能力池的初始化、候选检索、文档生成和方案生成必须在同一自动执行链完成；禁止呈现 `确认产品定位`、`确认 PRODUCT.md`、`确认 DESIGN.md`、`生成视觉方案`、泛化 `确认` 或 `继续`。用户可见确认与选择以当前 Router 返回的模型、精确标签和选项为准；新 Run 为视觉方案、交互式 Demo 和其后的路线选择。
- 自动链运行较久时，宿主必须读取 `executionDirective.streamingProgress`：立即以其 `start` 发送 commentary，并在每个 `requiredChain` 步骤实际完成后按其 `format` 更新。该进度不是确认、不是“继续”也不是一轮可结束的最终答复；必须持续执行到完整方案、Demo 路线选择或带操作回执的实际阻断报告。禁止只沉默等待全文或只在末尾输出文件卡片。
- 不得跳过 Preflight、Intent Brief、Gate 1、Gate 2 或 Gate 3。
- `generate_visual` 是一个不可拆开的自动链，不是“写出沙盒文件”就完成。宿主每完成一个受控子步骤都必须重新读取 Router 的 `executionDirective.currentStep`，并在同一回合持续执行：编译来源清单 → 物化 Run-local 源码 → 启动 `visual-sandbox-runtime.mjs` 并取得真实 URL → 生成 `runtime-browser-spec.json` 并采集 DOM/截图/动效证据 → 编译 `runtime-visual-baseline-input.json` 与运行时来源锁 → 从冻结截图发出 `visual-reference` → 登记真实候选 → 登记 Runtime Demo。`currentStep` 为 null 而必需产物未齐全属于 Router 缺陷，宿主不得输出阶段总结、文件卡片或“继续执行当前任务”来结束回合。
- `generate_visual` 成功后，宿主必须直接展示 `runtime-demo.json` 中的聊天内可交互片段（不兼容时才回退 HTTP 预览）、入口视口、交互状态与运行时来源摘要（`runtime-source-lock.json` 的选中组件/样式/图标/动效文件）；不得另行生成、展示或要求确认静态效果图。内部浏览器截图只允许用于 Stitch 导入和机器一致性校验。Demo 页面是用户进入 Stitch 或直接代码路线前唯一的视觉审阅对象。
- `generate_visual` 的四项产物 `runtimeDemo`、`designCandidates`、`visualReference`、`gate1VisualOutput` 完成后，宿主必须先取得 `register_runtime_demo` 的当前 Router 授权，再调用 `register-runtime-demo <project-root> <run-id> <session-id> <authorization-ref>`。登记不是展示：随后必须取得 `present_runtime_demo` 授权，优先准备**当前 Run** 的 `runtime-demo.json.chatPreview`，校验片段与 HTTP 验收页同源后调用 `present-runtime-demo … <presentation-id> chat-inline`；在同一轮最终回复原样输出返回的 `presentation.contentReference`。该回执只证明输出已准备，不证明客户端已渲染或用户已操作。浏览器回退时实际打开 `runtime-demo.json.url`，确认它与 `visual-sandbox-runtime.json.url` 和该 Run 的 `visual-sandbox` 根目录完全一致，再以 `browser-panel <具体原因>` 登记。`file://`、正式项目服务地址、项目根页面和其他 Run 的 URL 一律禁止。没有展示回执，`select-route`、Stitch、实施冻结、Gate 2 和任何正式代码写入均不得执行。旧模型中的提前“直接代码/直接生成代码”仅可记录待生效意图；新模型必须先取得同一 Run 的明确 Demo 确认，再选择直接代码，绝不能仅凭展示回执或提前意图进入实施。
- Demo 产品原型源码只能通过 `visual-sandbox-writer.mjs materialize` 写入当前项目的 `<project-root>/.apex/runs/<run-id>/visual-sandbox`；manifest 也必须位于同一 run。视觉确认后的首个 `generate_visual` 子步骤固定为 `compile-demo-source-manifest`：宿主先在当前 run 自动生成 `demo-source-input.json`，覆盖全部已选来源，并为 Existing 绑定每项来源与冻结 `page-skeleton` 节点；然后必须以当前 `generate_visual` 授权调用 `demo-source-compiler.mjs compile` 生成 `demo-source-manifest.json`，最后才可调用写入器。每个 `sourceBinding` 的声明文件还必须实际渲染对应的 `data-apex-source-selection="<id>"` 标记；仅写 JSON 绑定而页面未使用来源会被拒绝。清单缺失、无效或过时是可重建的内部输入问题，必须重建并重试，绝不能向用户报告缺失、要求确认或结束回合。用户目录中的孤立 `.apex`、APEX Core、其他项目、系统临时目录及正式 `src/app/pages/public` 均不是合法 Demo 写入目标。`apex-action` 对每个 `generate_visual` 受控动作执行正式项目树前后 SHA-256 快照，`.apex` 之外发生任何变化即判定动作失败。宿主不得用 `apply_patch`、shell 重定向或设计 Skill 绕过该写入器。
- **仅 `gate-summary-only` 旧 Run 的确认与跳过规则：**用户只在 `gate1`、`visual-plan`、`stitch`、`implementation` 当前确认点使用 `skip` 跳过当前人工确认并进入下一阶段；Router 必须登记原因与完整工件哈希。`visual-plan` 是 Gate 1 后唯一的视觉方案确认：APEX 必须调用 `google-design-md` 和至少一项 `ui-ux-pro-max-skill`、`impeccable` 或 `taste-skill`，结合用户任务、现有页面、信息密度、技术栈、无障碍和性能约束，按布局、样式、组件、字体及适用的图标、图表、动效逐类比较至少两项真实候选。每项比较必须说明平台适配、视觉高级感/整体性、落地成本，明确选中与拒绝理由；不得因候选库多就混搭，也不得仅列库名或用审美偏好替代分析。再展示并冻结每个布局、颜色/Token、字体、组件、图标、样式、动效和在线候选的精确来源、版本、资源 ID、参数与落地方式，收敛为同一设计系统；确认后 `generate_visual` 只能消费这份选择表并自动生成正式运行时 Demo，代码只能物化其中已选的最小精确资源。在该旧模型中，运行时 Demo 是工件与 Stitch 输入，不新增独立 Demo 确认；`two-confirmations` 必须按 Router 要求先取得用户明确 Demo 确认，再选择路线。`skip stitch` 仍只豁免人工确认，必须已有 Stitch 工件。仅当用户明确要求“跳过 Stitch 步骤”时，才可使用 `skip-stage … stitch`：它跳过 Stitch 生成与确认，以已生成运行时 Demo作为实施基线，仍要求来源锁定、实施确认、Gate 2 和以运行时 Demo为基线的 Gate 3；“继续”等措辞绝不触发该路径。
- 只有用户明确要求“跳过/不需要本次确认/直接下一步”才可调用 `skip`；“继续”、调整提示词、查看、沉默和超时均不得被推断为跳过或批准。
- 不得用桥接 skill 替代 APEX Core 本体。
- 其他设计或实现 skill 只能在 APEX 分级与阶段内作为增强能力，不能绕过状态机、Gate 与实现权限。
- 用户在任何确认点前提出调整而未明确确认时，宿主必须调用已安装的开源 `doc-coauthoring` Skill 的自由反馈提取能力：识别保留/删除/修改项和隐含偏好，更新当前未确认工件并补齐受影响的缺失步骤。只采用该 Skill 的“自由反馈 → 偏好提取 → 局部修订”能力，不采用其逐节再次征询流程；不得新增用户确认、不改变现有 Gate、不得自动批准。调用结论必须通过既有 `contract-recorder.mjs` / Context Sources 记录为可审计、去敏的规则，并将引用写入 DESIGN.md 或当前视觉方案契约；不得把用户原话或项目私密上下文直接写入全局能力库。后续同项目任务在 Intent、Baseline、视觉方案生成前必须加载这些已记录的规则。
- 用户调整的处理必须区分三类：新任务使用 `reinvoke … new-task`（或用户明确从头执行时 `restart`），绝不继承旧 run 的确认或工件；调整只影响当前尚未确认方案时，调用当前 checkpoint 的 `revise`，自动重建并回到同一个精确确认标签；调整若改变任何**已确认**的上游范围、数据/API/权限/验收、布局/Token/来源/动效或实施映射，必须以最早受影响 checkpoint 调用 `revise`，不能只改下游。Router 的 `revisionOutcome.kind: reopened-upstream-checkpoint` 必须先在聊天中明确说明“已解锁哪些已确认方案、为什么、哪些派生工件失效、将自动重建并回到哪个精确确认标签”，随后自动重建。该说明不是新 Gate、不是“继续”按钮，也不要求用户二次授权；用户发出的实质调整本身即为解锁请求，重建完成后仍须重新确认被解锁的正式方案。
- 用户明确“重新运行/重新加载 APEX/从头执行”时，宿主必须调用 `restart` 并分配新的 Run-ID，不能映射成 `reinvoke continue` 或复用旧 run。新 Run 初始化和会话切换成功后，Router 只能删除**当前 session 已绑定且被替换**的旧 Run-ID 目录；绝不能枚举、清理或影响其他 session 的 run。旧 run 绝不可被读取为当前输入、Demo 或确认工件。新 Run 从正式项目代码重新采集。对于同一 run 内的实质修订，Router 必须把被撤销的运行时 Demo、视觉沙盒、视觉计划、来源锁、运行时基线及其下游工件移动到 `invalidated/<timestamp>/`，活跃 run 根目录不得残留任何可被展示、启动或登记为当前 Demo 的旧文件。宿主只可依据 Router 当前 `state.artifacts.runtimeDemo` 且存在有效 `register_runtime_demo` 回执来呈现 Demo，禁止按文件名扫描或链接任何未登记/已失效的 `runtime-demo.json`。
- **任何活跃 APEX run 都禁止通用“继续”按钮。** Router 的 `userInteraction.genericContinueForbidden` 恒为真，并根据当前确认模型返回精确的 `confirmation.label` 或 `nextRequiredDecision`；新模型不得套用旧模型的四个确认标签。宿主只能使用该精确提示呈现对应确认；在用户给出明确确认前，任何其他文字、补充、否决或调整都必须按 `unconfirmedInputPolicy` 记录为当前阀门的 `revise`，重建同一工件并仍停留在该阀门。收到用户调整后，宿主必须自动完成受影响工件重建，再直接展示唯一允许的 Gate 确认或路线选择；不得把“我会重做”“正在分析”“已更新”拆成需用户点击继续的聊天轮次。`reinvoke ... continue` 仅是 Router 内部的同任务消息归类，绝不是用户界面动作或批准。
- Gate 1 已确认后，如果用户在视觉方案、Demo、Stitch 或实施冻结前补充会改变功能、数据、API、权限、范围或验收的需求，宿主必须调用 `revise ... gate1 visible ...`。Router 会撤销旧 Gate 1 与所有派生视觉/实施锁，保留 Existing 的只读正式基线证据，回到需求影响分析并自动重建八节正文；不得只回复“已加入并记录”，不得沿用旧审批继续视觉或代码阶段。只有不改变任何冻结字段的解释性补充才可使用 `non-baseline` 保留 Gate。
- “确认视觉方案”前必须展示并冻结 `visual-plan-presentation.md`；它不是目标摘要，且必须逐节列出：1 目标与范围；2 信息架构与布局；3 颜色、字体、间距、圆角等视觉 Token；4 组件与关键交互；5 图标、图表、素材；6 动效、reduced-motion 与性能；7 响应式与加载/空/错误状态；8 每项真实库/项目来源、版本、资源 ID、参数与物化方式；9 每类至少两项候选的适配/审美/成本比较及选用理由；10 Existing 的现状问题、改什么、为什么、收益（Greenfield 则最终选择与依据）、代码影响和验收。缺任一节或未同时冻结 `visual-execution-plan.json`，不得展示“确认视觉方案”。
- Existing 局部任务的 Gate 1 与视觉方案正文必须通过当前 `change-scope.json` 的机器展示边界：完整章节只展开受影响闭包，保护页面、节点、数据视图和代码目标不得出现在正文；未调整内容仅以固定 Existing 基线句引用。presentation manifest 缺少通过结果、正文被手改或 Router 复核不通过时不得显示确认，必须自动重建当前工件。
- 视觉方案尚未实际生成时，`userInteraction` 必须为 `no-user-input`，不得显示“确认视觉方案”或“确认”。范围清单、待办列表、重建声明和“下一步将生成”均不是视觉方案、不得确认。只有上述两个工件均存在且完整时，才可由 Router 暴露当前模型的视觉方案确认。
- `executionDirective.terminalUserResponseAllowed: false` 与 `terminalResponseContract.allowed: false` 是硬性连续执行约束：诸如“Gate 1 已通过”“正在生成视觉方案”“已进入视觉阶段”“已开始改造”“下一步将比较候选”，以及只展示 `experience-strategy.json`、文件修改卡片或进度摘要，只能作为不结束当前回合的 commentary，绝不能成为一轮最终用户响应。宿主必须在同一回合继续授权并完成 Router 指定链；成功后重新读取 Router，只在它返回完整展示稿确认或已登记 Demo 的路线选择时结束。四个命名确认都必须读取并完整渲染 `confirmation.presentation.content`：Gate 1 为八节正文，视觉方案为十节正文，Stitch 为候选/差异/一致性/来源/风险/影响六节正文，实施冻结为范围/目标/来源与依赖/约束/验证与风险/执行链六节正文。Stitch 与实施冻结正文必须是当前 Run 内由 `confirmation-presentation.mjs` 写出的工件，其 manifest 必须绑定当前来源哈希和成功 action receipt；禁止在宿主临时拼接、缓存或复用旧正文。若 `contentRequiredInUserMessage` 为 true 但正文为空，宿主不得展示按钮或结束回合，必须继续当前自动链直至重建。只有包含可观察错误与缺失工件的一次性 blocking report 可以提前终止。
- **Intake / restart / reinvoke 的强制续跑**：这些命令返回的 `routerState` 是内部控制结果，不是可直接呈现的聊天答复。只要其 `terminalResponseContract.allowed === false`，宿主必须立即以 `executionDirective.actionAuthorization.action` 获取当前授权、执行 `executionDirective.requiredChain`，再读取 Router；循环直到取得完整确认稿、运行时 Demo路线选择，或某个实际执行过的动作返回带 operation receipt 的 blocking report。不得把“已创建新运行”“已扫描项目”“正在建立 Existing 基线”“正式代码尚未改动”等任一进度句或文件卡片作为终止消息。此规则同样适用于启动首个 `collect_existing_baseline` 动作；禁止把它留给用户继续、重新调用或再次确认。
- **逐步续跑协议**：每次 Router `status` 的 `executionDirective.currentStep` 是当前自动链唯一可结束前继续执行的具体工作项。宿主必须先以流式 commentary 报告该项标题，完成其 `produces` 后立即重新读取 Router 并处理新的 `currentStep`；每次状态写入都必须重新授权，不能复用旧授权。`currentStep` 变为下一项、仍处于同一 action 或从 `collect_existing_baseline` 转为 `analyze_requirement` 都不是停顿条件。`baseline-captured-only`、`code-reference-captured-only`、`browser-captured-only` 与阶段概述一律不是可呈现终点；只有 Router 的精确 confirmation、Demo 路线选择、交付证据，或已有失败 operation receipt 的阻断报告才允许结束回合。
- **宿主硬性终止保护**：安装时必须执行 `scripts/install-codex-stop-hook.mjs`。该 Codex `Stop` Hook 会读取当前 session 绑定的 run 并复核 Router；只要没有失败动作回执且 `terminalResponseContract.allowed === false`，它就必须阻止本回合结束并注入“继续执行当前受权链”的续跑提示。相同 `currentStep` 再次出现只说明尚未产生完成回执，绝不能因去重放行；但同一 action/currentStep 连续三次被 Stop Hook 观察到无回执结束时，Hook 必须写入当前 Run 的 `hook-continuation-stall.json`，Router 将其作为一次可检查的 `executor-no-progress` 阻断，而非无限续跑。该约束同样覆盖 Gate 1、视觉方案、Demo、Stitch、实施冻结及 Gate 2/3 验证的全部自动节点。不得禁用、绕过或用文件卡片代替该保护。已有 `blockingOperation` 时，宿主必须输出一次包含回执、观察错误、失败类别和下一项实际修复条件的阻断报告；不得重试、不得再次注入续跑提示、不得显示“继续”。此机制只对精确绑定的 APEX session 生效：创建或恢复 Run 优先传入真实 Codex thread ID；使用别名时必须由 PreTool bridge 精确登记，不能通过扫描其它 session 或宽松匹配猜测绑定。在 Router 返回精确确认、Demo 路线选择、交付或已执行操作的阻断回执时才自动放行。
- **Agent 领取与中断恢复**：领取 Job 前生成并在当前 Run 安全保存一个随机 `claimKey`（16–128 位字母、数字、下划线或短横线），以 `agent-runtime.mjs claim <run-dir> <job-id> <stage> <claimKey>` 领取。若领取后回执丢失，先获取新的 Router 授权，再使用同一 `claimKey` 重试，系统只返回当前有效租约，不增加执行次数；如果租约过期或 Job 已恢复排队，新尝试必须使用新 `claimKey`。旧租约不得提交结果。不得共享其他 Run 或 Agent 的领取标识。
- **UI Designer 的 taste-skill**：新建视觉阶段的 UI Designer Job 领取回执若包含 `requiredSkill`，宿主必须将其中完整 `content` 作为该设计师的输入，结合产品方案、用户要求、项目基线和场景采用适用规则；不得仅凭名称宣称已加载。记录 advisory 时，`execution.tasteSkillUsage` 必须包含领取回执中的 `sha256`、实际采用的 `appliedRules` 和不适用的 `notApplicableRules`。缺失或哈希不匹配必须保留真实失败回执；历史 Job 无该绑定时按原协议恢复。
- **设计师按场景引用其他技能**：领取 UI Designer Job 时读取 `optionalSkills` 中的名称、适用范围和哈希；只选择当前产品和页面确有帮助的能力，并以新的 `plan_visual` 授权通过 `agent-runtime.mjs skill <run-dir> <job-id> visual <lease-token> <name> <sha256>` 领取其真实内容，再依据项目和用户需求综合取舍。调用会验证租约与文件哈希并记录加载证据；不得把清单中的名称当成已经读取，也不得把无关技能全部加载。记录设计师 advisory 时，对本次执行实际读取的每项可选技能填写 `execution.optionalSkillUsage`，包含名称、哈希、`applied` 或 `not-applicable`、理由和适用规则；未读取的技能不得申报。技能缺失或变更须如实记录，不得冒充已引用。
- **Caveman、Ponytail、research-intake**：宿主按会话配置实际读取 Caveman，用于精炼用户可见说明，不能删减持久化方案和验证证据。产品角色在确需调研或时效核验时，从领取回执的 `optionalSkills` 按需加载 `research-intake`；前端实施规划角色按当前会话规则使用 `ponytail`，保持最小完整实现并保留必要验证。对实际加载的角色技能记录 `execution.optionalSkillUsage`，禁止把能力名称当作已执行。
- **受控专业角色链**：新 Run 的 `roleChain.enabled: true` 时，角色不是新的对话流程。宿主必须在 Router `executionDirective.requiredChain` 中出现 `select_and_run_*_role_advisories` 的位置，通过当前 action 授权调用 `role-advisory.mjs select`。选择会在 Run Ledger 中为每个命中角色创建独立 Agent、持久 Job、输入哈希与 Token 预算；**必须先以同一 action 调用 `agent-runtime.mjs claim <run-dir> <job-id> <stage>`，再让该职业在冻结输入上工作**。视觉方案 `designCapabilities` 必须与 UI Designer 实际使用记录一致：包含 `taste-skill` 和适用并已采用的专项技能，不得声明未加载或不适用的技能。领取返回 `waiting` 时只排队，不启动角色；`running` 才可执行。 领取操作返回 `stage-token-budget-exhausted` 失败回执时不得启动或循环重试；保留实际预算不足的失败回执并按 Router 执行受控修复。`running` 回执的 `reservedTokens` 是该次可上报预算；宿主支持请求上限时应按此设置，不支持时只能作为软预算。失败尝试如有宿主用量，以 `agent-runtime.mjs fail <run-dir> <job-id> <stage> <error> <lease-token> <usage-json>` 报告该次输入、输出和 `usageSource`；不可获得时留空并记为未知，不能称为零消耗。宿主不得同时用独立 `tokens` 命令重复登记同一尝试。宿主必须保存领取回执中的 `leaseToken`，长任务在到期前以当前阶段授权调用 `agent-runtime.mjs renew` 续租，并在 advisory 的 `execution.leaseToken` 中原样传回。宿主生成符合 `role-advisory.schema.json` 的结构化 advisory 时必须在 `execution.usageSource` 标明 `provider-reported`、`estimated` 或 `unknown`：仅宿主实际提供用量时使用 provider-reported；无法计量时标记 unknown 并将数值设为 0 占位，不得称为零消耗或完整预算。用 `record` 使已领取的对应 Job 写入 trace 并成功结算，再 `summarize`。角色仅可读取当前 run 的索引、已冻结契约与变更闭包；不得改项目、改 Router 状态、安装依赖、要求用户确认或自行批准 Gate。`baseline`（Existing）、`gate1`、`visual`、`implementation` 和 `verify` 均在对应阶段自动完成。被当前阶段选中的任何角色失败时，宿主必须保留该次受控 action 的失败回执并由 Router 输出一次真实阻断；不得写入 `unverified` advisory、不得降级汇总、不得把失败转为用户确认或“继续”。未被条件选择的角色仅记录为不适用。角色总结必须综合进产品与视觉内部方案；用户可见内容按当前确认模型和 Router 的 renderPolicy 展示。没有已记录并哈希匹配且全部 Agent Job 已成功的当前 stage summary 时，不得展示该 Gate。旧 Run 没有 `roleChain` 字段时可继续按原有规则恢复，不得被这项升级误阻断。
- 自动链的“所需工件尚未生成”绝不是阻断理由：例如 Gate 1 已通过而 `visual-execution-plan.json` 缺失时，宿主必须先按 `executionDirective.actionAuthorization` 取得 `plan_visual` 授权、完成需求/候选分析与十节方案编译；不得把该文件缺失写成“当前无法继续”。仅当该动作已经实际执行失败，且可提供失败的 operation receipt、观察到的错误和缺失工件时，才可输出一次阻断报告。批准 Gate 1 的回执若返回 `mustContinueAction: plan_visual`，同一回合不得停止、不得要求用户补充操作、不得重新确认。
- Gate 1 若 `gate1-presentation.md` 已写入但 Router 仍返回 `analyze_requirement`，宿主必须将它视为“尚未受控登记”的自动工作：重新读取当前状态、取得当前 `analyze_requirement` 授权、调用 `register-gate1-presentation`，再重新读取 Router。不得报告“内部状态注册缺失”、不得调用 `apex-run.mjs`、不得把该可修复链路暴露为用户的权限请求。
- 当当前 `delivery-contract.json` 声明 `backend` 或 `api-contract` 时，`analyze_requirement` 的自动链必须在生成 Gate 1 正文前派生并登记 `domain-model.json` 与 `api-contract.json`：分别取得 `record_context` 当前授权，经 `apex-action.mjs` 调用 `contract-recorder.mjs domain|api`，再继续体验评估、角色汇总、八节正文与登记。它们不是额外确认，也不能因缺失而显示 Gate 1 按钮、阶段状态或文件卡片后结束。实施冻结自动链同样必须从已经确认的 `visual-execution-plan.json` 派生并登记 `site-contract.json`（`compile_visual_bundle` 授权下的 `contract-recorder.mjs site`），再编译 Visual Bundle；缺失 Site Contract 是待执行内部工作，不是用户阻断。
- `plan_visual` 的输入 JSON 是宿主的内部编译中间件，不是用户工件。调用 `visual-execution-plan.mjs compile` 前，宿主必须在同一自动链验证它可被 JSON 解析、没有 `TO_REPLACE` 等模板占位符，并将 `change-scope.json` 与 `DESIGN.md` 的当前 SHA-256 精确写入；任何语法、占位符或失效哈希错误都必须自动重建输入并重试。不得把“第 N 行 JSON 错误”、文件卡片或内部修复请求呈现为用户阻断、确认或下一步。
- 同一自动链规则覆盖确认阀门之间的空档。`two-confirmations` 下，用户确认 Demo 并选择路线后，Stitch 候选一致时自动验证封存，存在差异时按 Router 给出的差异决策处理；直接代码与一致的 Stitch 路线均自动编译实现映射并完成机器 Gate 2，不新增实施冻结确认。`gate-summary-only` 旧 Run 才按其 Router 返回的 Stitch 与实施冻结确认继续。任何工件在尝试前缺失都是待执行工作，不得伪装成阻断或“继续”提示。`implement` 必须先取得 mutation lease 与授权，再在批准的实现映射范围内修改项目；完成后以当前 `implement` 授权和有效租约调用 `register-implementation <project-root> <run-id> <session-id> <authorization-ref> <lease-id> <page-delta-relative>` 登记真实 `page-delta.json` 与正式目标文件哈希。
- Existing 任务先形成只读 Project Inventory，再冻结本次目标页面入口、路由及其传递项目依赖闭包的完整代码参考和真实页面骨架，最后形成 Existing Baseline；每个运行时 Demo布局节点必须映射到骨架节点。任一项缺失、代码变更、映射不全或运行时 Demo未绑定哈希时，不得生成正式运行时 Demo或 Stitch。
- Existing 的“局部调整、组件调整、数据展示调整、单页调整”必须在 Gate 1 前自动生成并冻结 `change-scope.json`。范围判定以用户明确目标为起点，只扩展到真实代码中的传递运行依赖；必须分别登记受影响路由/页面/视觉节点/数据视图/代码目标，以及未受影响的保护补集。任务规模 `Lite / Standard / Full` 不能替代变更范围，也不得成为全站重述或全站重构的理由。Gate 1 与视觉方案仍保持规定的八节/十节完整结构，但每节只输出本次变更闭包内的决策；未调整内容仅以“沿用已冻结 Existing 基线”引用，不重复展示、不要求重新确认。视觉方案、来源选择、运行时 Demo变更、Visual Bundle 和 Implementation Map 中的节点与代码目标必须是该闭包的子集；越界即阻断。实施后 Gate 3 必须逐文件复核保护补集哈希，并对同文件内的未调整视觉节点做回归验证，任何未授权变化均不得交付。
- Gate 1 的规范审核必须先冻结 `styleBaseline`，不能只写“现代、专业”之类描述。Existing 必须从真实项目样式源文件提取并锁定 SHA-256，统一复用字体家族/字号阶梯/行高/字重、颜色与语义 Token、间距阶梯/页边距/区段间距、圆角/边框/阴影；视觉方案不得新增未在该基线内的值，除非用户明确批准并重建基线。0–1 必须先按设计规范冻结同样完整的 `greenfield-standard` Token 集，再开始视觉方案；不能把散落的 CSS 值当作规范。
- 视觉方案的用户可读决策叙事必须按轨道输出：Greenfield（0–1）只输出“最终选了什么 + 基于什么选择”，每项绑定 source selection；Existing（1–N 迭代）必须逐项输出“现状问题 + 要改什么 + 为什么改 + 最终选什么 + 能解决什么”，每项同样绑定 source selection。不得把 Existing 改造写成泛泛的新建风格提案，也不得以笼统的“优化体验”代替改造收益。
- Existing 与 Greenfield 的正式运行时 Demo前必须形成并遵守 `core/runtime/experience-strategy-contract.md`，并以 `experience-evaluator.mjs` 产出分数不低于 85、无关键缺失的质量证据：场景/用户任务、信息架构、数据表达、功能交互、Token/组件、响应式、无障碍、动效和反模式必须可追溯；不得把“高级、专业”等抽象形容词直接当作视觉指令。Visual 阶段必须呈现至少两个有明确取舍的候选；选中的候选哈希必须锁定正式运行时 Demo。
- `two-confirmations` 下，Demo 生成前先形成依据已确认视觉方案的 `demo-source-manifest.json`；用户确认 Demo 并选择路线后，实施准备阶段再冻结绑定该 Demo 的 Visual Source Manifest，之后才进入 Gate 2。旧 Run 依其 Router 当前步骤执行。能力池不是“仅供参考”的图库：一旦选择 shadcn/ui、Radix、Lucide、Motion 等组件、图标或动效来源，每个视觉节点都必须绑定到其精确包版本、已生成组件源码、项目已有代码或原生 Web 实现，并在运行时 Demo、Implementation Map 与最终代码中实际使用同一来源；项目未安装的候选先在 `visual-sandbox` 运行，Gate 2 后再安装或生成到项目。`ui-ux-pro-max-skill`、`impeccable`、`taste-skill` 等是设计决策能力，不是可加载 CSS 或组件包：实际采用的技能须登记为 `designCapabilities`，其中视觉任务的 `taste-skill` 必须实际加载；其他技能按适用性选用，均不能充当节点的组件、样式或布局实现来源。图标、素材、图表、图示和动效在适用时也必须有具体来源、版本和参数。实施代码必须在对应目标中保留 `data-apex-source` 来源标记，审计会验证其存在；不得在落代码时重新搜索相似元素或用假匹配填充。
- 需求或参考包含动态效果时，运行时 Demo生成前必须先盘点并冻结项目已有动效资产、已安装库与宿主提供能力，并为每条正式动效选择可执行来源；运行时 Demo和动效预览只能使用该选择单中的能力。实施冻结前必须形成可调整并经用户确认解释的 Motion Contract 与 Motion Implementation Map；每条动效必须有业务角色、选择器、引擎、关键帧、时长/缓动、循环策略、代码目标/API、预览时间点、reduced-motion、性能预算和验收条件，并强制绑定 `functionalPlan` 中的任务、真实事件、不同的前后状态、可枚举的信息收益和价值说明。不能证明其服务操作反馈、状态变化、空间定位、层级引导、进度解释或风险提示的动效不得进入运行时 Demo或代码；产品页面禁止无限循环，`delight` 仅可在声明任务完成后以不超过 1200ms 的一次性反馈出现。Gate 2 必须验证能力→合同→实现映射→功能绑定闭环；Gate 3 必须取得每条动效至少两个运行时关键时间点样本、真实事件 trace、前后状态和 reduced-motion 证据；不得用单张静态截图放行动态复刻。
- Gate 2 通过前只允许读取项目代码、生成 Run-local Demo、同步 Stitch、冻结与验证；禁止修改正式代码、安装项目依赖、迁移或发布。确需尚未安装的精确库时，先在当前 Run 的 visual-sandbox 中按锁定版本准备并采集证据，不修改项目依赖文件；Gate 2 后才可安装到项目。`two-confirmations` 的顺序是产品角色 → 设计师视觉方案 → 用户确认视觉方案 → 自动生成并展示交互式 Demo → 用户确认 Demo → 选择路线 → 机器 Gate 2 → 实施。自动链未完成时不得要求用户点击继续；完成展示后必须按 Router 要求请求 Demo 确认。旧 Run 按原模型执行。
- 对标记为 `inline-transfer` 或 `generated-source` 的已选图标、SVG、CSS、字体或组件源码，运行时 Demo登记后必须在实施冻结期调用 `asset-materializer.mjs collect`，从运行时 Demo运行时已加载的精确文件中将**全部且仅被选中的文件**连同来源哈希、许可和项目目标路径写入 `materialized-assets.json`；Gate 2 必须验证该清单完整，Gate 2 后的 `implement` 调用 `apply` 将同一文件转存到项目，Gate 3 的 `verify` 调用 `audit` 逐文件比对哈希。对 `runtime-package`，Gate 2 后必须调用 `runtime-materializer.mjs install` 安装运行时 Demo锁定的最小精确包，再调用 `audit` 验证项目 package、完整 pattern 文件和实施目标 import/API；不得改为下载完整无关库，不得以只有包名/资源 ID 的 dependency lock 或 `data-apex-source` 标记代替实体文件和实际使用。
- `present-runtime-demo` 成功后，`two-confirmations` 必须先展示并请求用户明确确认交互式 Demo，再依据 Router 的 `delivery-route` 提供 Stitch 和直接代码选项；不得将展示或路线选择当作 Demo 确认。用户要求修改时按 Router 重建受影响工件。`gate-summary-only` 旧 Run 按其 Router 返回的原决策恢复。路线选择必须调用 `select-route`，不得只凭聊天或内部 skip 变更状态。
- 在 `delivery-route` 决策点，用户明确选择直接代码应映射为 `direct-code`，不能回答“代码已存在”。判断正式代码是否存在时排除 `.apex`、Demo、截图及 Stitch 工件。`two-confirmations` 下直接代码自动编译 Visual Bundle 与 Implementation Map 并运行机器 Gate 2，之后才写入正式生产目录；旧模型按 Router 原有确认规则恢复。
- 每个正式页面必须先冻结响应式合同：至少覆盖 mobile、tablet、desktop 三类视口，逐项声明宽度范围、布局模式、组件重排、文字缩放、媒体处理、横向溢出例外及验收条件。运行时 Demo、Stitch 与代码必须遵守同一合同；不得以压缩桌面布局代替移动端设计，也不得出现未经声明的横向滚动、裁切、重叠或变形。Gate 3 除三类代表视口外，还必须在每个宽度区间的最小、中间、最大宽度采集真实截图，并逐项证明无横向溢出、重叠、裁切、文字不可读或比例漂移。
- 浏览器截图、交互和控制台采集使用 APEX `browser-capture.mjs` 与全局 Playwright bridge；截图是证据，不等于视觉批准。
- Playwright 的浏览器二进制是只读共享工具依赖；每个 APEX run 的 daemon/profile/cache 必须写入项目 `.apex/runs/<run-id>/cache/playwright-daemon`。宿主不得要求用户为 `~/Library/Caches/ms-playwright/daemon` 授权，也不得把该环境隔离错误呈现为用户确认或流程阻断；应自动以 run-local cache 重试。
- 实施前必须通过当前 APEX 的机器 Gate 2；交付前必须有真实 Gate 3 证据，包括多视口、默认/加载/空/异常/无权限状态及关键交互的 `runtime-state-matrix.json`。不适用状态必须保留原因。
- 不得直接编辑 `state.json` 放行阶段；状态变更只能使用 APEX Router 或既有受控运行脚本。
- 任何高风险工具调用都必须先获得 Router 的动作授权；Skill、设计工具和专项能力无权自行放行。
- 对流程、调用、依赖、证据、输出、性能、兼容性或安全风险的修复，必须遵循 `core/runtime/remediation-method.md`：先定位可观察失败条件，再核对适用的权威标准、官方文档或成熟开源实现及其边界；仅映射到既有 Router、Gate、工件和受控脚本，以最小改动验证。必须区分原始证据、机器结论与 AI 解释；模板、手填 JSON、旧版本工件和无法复现的推断一律只能标记 `unverified`。不得为修复增加无实质决策的用户确认、反复扫描或平行流程。

## 执行优先级

- 稳定性、正确性、状态完整性、Gate 与严格 1:1 约束优先于速度、功能扩展和 token 节省。
- 方案必须具备可复核质量证据与可恢复路径；不得用未验证的推断替代用户事实、基线或验收。
- token 消耗必须按阶段受控：优先引用 `context-index.json`、已确认契约与 Checkpoint，只加载当前 Gate 必需的最小上下文；预算不足时缩小范围或请求重新定界，不得跳过流程。
- 当前 APEX 范围不新增监控、指标采集、告警或监控控制台功能；运行审计、Gate 证据、恢复和发布审计不属于该限制。

## 确认前的提示词迭代

- 用户确认前先展示当前模型要求的工件与可调整内容；用户可多次调整，不得将“继续”“看看”“差不多”视为批准。`two-confirmations` 要求视觉方案和交互式 Demo 的明确确认；旧模型的确认点由 Router 返回。
- 不得把用户的每一句补充都当作冻结基线变更。先比较其是否会改变已冻结的布局、内容、组件、视觉 token、动效/3D、依赖、交互或实现映射；仅当实际工件会变化时才调用 `revise`。纯说明、偏好重述或未改变冻结字段的补充使用 `non-baseline`，只记录审计事件，不撤销任何确认或实施授权。
- 用户明确确认前，使用 `revise <project-root> <run-id> <session-id> <checkpoint> <visible|implementation-only|non-baseline> <reason>` 记录调整。`visible` 才会回到运行时 Demo阶段；`stitch` 变更仅撤销 Stitch 与实施冻结；Gate 2 前的 `implementation-only` 仅撤销实施冻结。Gate 2 已开放后，明确授权且不触碰冻结视觉/动效/依赖/映射的 `implementation-only` 改动保留 Gate 2 和实施权限，仍须完成 Gate 3 重新验证。

## Demo 交付形式：可交互 UI 原型

APEX Demo 统一为可交互 UI 原型，也称前端 Demo。按确认范围提供可操作的导航、关键任务、表单与状态反馈，使用明确标识的示例数据并提供重置入口；多角色任务支持切换预览视角。源码输入必须包含 `interactionContract`，浏览器实际执行全部任务并验证操作前后的可见变化；静态截图、自动播放动画和无效按钮不能替代交互验收。详情及字段格式见 `core/runtime/interactive-demo-contract.md`。

默认在聊天正文嵌入可直接使用的 Demo，支持页签、按钮、表单、状态反馈与重置。通过 `chatPreview.fragment` 指定自包含 HTML 片段，编译器从同一片段生成 HTTP 验收页；Router 校验哈希并返回 `presentation.contentReference`，宿主必须在本轮最终回复原样输出。不能用 localhost iframe、截图或链接代替聊天交互。仅宿主缺少能力或已选来源无法兼容片段时，说明具体原因并打开同一 Run 浏览器面板。保留来源锁和响应式要求；新模型展示后请求用户明确确认 Demo，再进入路线选择。

新生成 Demo 默认在 `demo-source-input.json` 中声明 `chatPreview: {"fragment":"preview.html"}`；全屏桌面应用可加 `"mode":"wide"`。只编写这一份片段，`entrypoint: "index.html"` 由编译器生成，不在 files 中另写入口。片段内联产品 CSS/JS 与资源，使用稳定根 ID 和局部 DOM 查询；界面使用产品自己的样式与字体，不依赖聊天宿主的工具类、Lucide 全局或网络请求。按需将已选资源先打包，不得替换确认来源。路由使用本地视图切换，journeys 的 route 为 `/`。`window.openai` 状态能力须检测存在并处理失败，浏览器独立运行时仍可交互；状态仅保存示例选择，不含秘密。聊天引用只在 final 输出，紧跟原有路线选择；修改或重显 Demo 时重新输出当前引用。详细格式见 `core/runtime/interactive-demo-contract.md`。
