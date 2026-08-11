---
name: apex
description: Use for every frontend, UI, visual-design, UX, interaction, page-visible content or state, layout, responsive, accessibility, screenshot-to-code, design audit, or component-consistency task—even a small visible field, button, style, permission, or status fix—and whether or not the user explicitly names APEX. This bridge skill must be selected from the prompt in new, continuing, and resumed sessions; it discovers the current APEX Core only from its canonical root, reads manifest.version, runs preflight, and follows the current invocation spec instead of improvising a parallel workflow.
---

# APEX Bridge Skill（以 manifest.version 为准）

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
6. 通过 Preflight 后，先向用户说明 APEX 会带来的 Gate、工件与确认开销；仅在用户明确确认调用 APEX 后，才调用 `<CODEX_HOME>/apex/APEX/scripts/apex-router.mjs` 创建或恢复该项目的当前 APEX 运行态。

每次 APEX Router 调用都会先从主目录自动发布本 Bridge 到全局 Skill，并校验两者哈希
完全同步；发布失败时 Router 必须阻断，不得允许已发布文件本身处于旧版本。

已打开 session 在下一次 APEX Router 调用时必须自动加载当前 Core/Bridge：Router 先同步全局
Bridge，再将该 session 的绑定版本与哈希重绑到主目录版本，随后才返回状态、授权或执行动作。
旧绑定仅保留为 `previousBridge` 审计记录，不能要求用户新开 session、手动刷新或显式交接。
任何会改变阶段、确认或实现权限的裁决都只以这次自动刷新后的 Router 输出为准。

## 代码化调用路由

本 Skill 是 Codex 的发现与接入层，不是 Gate、阶段或工具权限的裁决者。每次
命中后都必须先由 `apex-router.mjs` 返回项目、run、当前阶段与 `allowedActions`。

1. 每个新 Codex session 都是一次新的 APEX 调用，必须执行 `node scripts/apex-router.mjs intake <project-root> <new-run-id> auto [scope] [authorization] <session-id>`；不得自动复用任何旧 run。`auto` 是默认且必须使用的轨道判定：只以项目正式代码为依据——Git 仓库优先读取已跟踪源码，非 Git 仓库排除 `.apex`、visual-sandbox、runtime-demo 和临时目录后读取项目源码。只有正式代码中存在页面/视图/UI 入口时才为 Existing；只有 API、数据模型、服务端或无正式页面时为 Greenfield，并自动把既有 API/数据模型作为保留契约输入。Gate 2 前的 Demo、沙箱代码、截图、Stitch 工件和其他 run 产物绝不能成为轨道判断依据，也不能把 Greenfield 改判成 Existing。不得将“没有 Existing 视觉基线”呈现为阻断、要求用户回复“按 Greenfield 重启”，或要求用户手选轨道；只有用户明确指定 Existing/Greenfield 时才传显式轨道。
2. 仅同一 session 可以执行 `node scripts/apex-router.mjs resume <project-root> [run-id] <session-id>` 恢复其已绑定 run。若用户明确说“重新执行 / 从头开始 / 重新按照需求执行”，必须使用 `restart`：创建全新 run，从入口重新完成需求、真实产品页面基线、Gate 1 与视觉方案；旧 run 仅保留审计，不得继承 Gate、方案、基线、工件或授权。只有明确的同一任务补充/澄清才使用 `reinvoke ... continue`；独立任务使用 `reinvoke ... new-task`。不得直接再次 intake。跨 session 默认必须新建 run；后续如需交接，必须使用显式交接流程。
3. 只可执行 Router 返回的 `allowedActions`；直接请求 Visual、Implement、Verify 或 Release 也不能绕过该规则。
4. 修改项目代码前先获取 `lease`，再执行 `authorize ... implement <lease-id>`；没有当前项目、run 与 session 绑定的 lease，禁止实施。
5. 所有项目中间产物只允许写入 `<project-root>/.apex/`。严禁将项目 run、截图、运行时 Demo、Stitch HTML、测试证据、缓存或用户资料写入 APEX Core。
6. Gate 2 后需要隔离代码改动时，先取得 lease 和 `prepare_workspace` 授权，再通过受控 action 创建该 run 的 Git worktree；不得把 worktree 当作绕过 Router 的项目根。
7. 用户取消时使用 `cancel` 保留 run 与证据并释放 lease；同项目并发实施使用 `queue-mutation` / `claim-mutation` 的 FIFO 队列，不得争抢或手工覆盖 lease。
8. 用户对 Gate 候选提出编辑或拒绝时，用 `review ... edited|rejected` 留存复核事实，再按 `restart` 或当前受控阶段处理；不得把拒绝视为批准。

对于已有 APEX 运行脚本，先调用 `authorize` 取得 `authorizationRef`，再使用：

`node scripts/apex-action.mjs run <project-root> <run-id> <session-id> <authorization-ref> <action> <apex-script> [args...]`

其中 Existing 基线使用 `collect_existing_baseline`，Stitch 严格复刻使用
`sync_stitch`，Visual Bundle 使用 `compile_visual_bundle`，浏览器、契约、质量和
回归验证使用 `verify`。不得由 Skill 直接调用这些底层运行脚本。

若项目根目录、run 选择或宿主能力不明确，Router 必须返回 `blocked` 或
`selection-required`；不得根据聊天上下文猜测后继续实施。

## 全局路由

每个新建、继续或恢复 session 都必须依据用户当前提示词识别 APEX 是否适用，但不得仅因命中而自动创建 Run 或调用 Router。必须先征询用户是否调用 APEX；仅 `[APEX]`、`确认调用 APEX`、`使用 APEX` 等明确授权才可启动。

以下任务及自然语言等价表达均必须命中：页面、前端、界面、UI、UX、视觉、设计、布局、组件、样式、表单、按钮、可见状态、页面权限、响应式、无障碍、交互、动画、截图还原、页面审计、视觉改造、设计系统、体验优化。

纯后端、纯数据、纯服务端接口或纯文档任务可以不建议 APEX；用户可见页面、交互或展示结果应提示 APEX 可用及其收益，但最终是否调用由用户确认。任务规模只影响确认后的 `Lite / Standard / Full`，不替代调用授权。

## 强约束

- 所有 APEX run 同时遵守五项不可互相牺牲的运行约束：**流程严格**（只按 Router 路由与既定 Gate 推进）、**内容完整**（用户可读叙事和机器工件均齐备才出现确认）、**执行连续**（确认阀门之间自动完成全部工作）、**执行高效**（增量索引、变更闭包和受控并行，避免重复全量扫描）、**Token 合理**（只加载当前阶段索引、摘要、已冻结契约和变化依赖闭包）。不得以提速为由跳步骤或省工件，也不得以完整为由每轮重读无关文件；Router 返回的 `operatingConstraints` 是宿主每一回合的执行边界。
- 向用户提出任何确认时必须遵守 `confirmation.presentation.renderPolicy`。先用自然聊天语言完整渲染 `chatOrientation`：说明“当前确认什么、重点看什么、确认后自动发生什么、未确认时如何调整”；随后在同一消息中完整展示对应用户可读工件，最后才显示唯一的精确确认标签。正文使用说明、标题、清单和必要表格，禁止以原始 JSON、内部哈希或文件列表作为主要阅读内容；哈希仅进入来源与审计附录。也禁止只给摘要或一句“将包括”。Gate 1 必须完整展示八节需求方向与交付方案；视觉方案必须完整展示十节视觉实施方案；Stitch 必须展示候选、差异、一致性、来源、风险和可调整项；实施冻结必须展示代码目标、来源物化、依赖、验证、风险和可调整项。宿主未完成“聊天导读 + 完整正文”时不得显示确认按钮、不得记录 approval。
- APEX 是唯一的流程编排者。`impeccable`、`ui-ux-pro-max-skill`、`taste-skill`、`google-design-md` 及任何设计 Skill 只能作为**内部非交互能力**：从当前需求、Existing 基线或 Greenfield 标准中提炼产品定位、信息架构、审美约束、候选比较与设计上下文。不得执行这些 Skill 的独立 `init`、项目上下文确认、命令推荐、`PRODUCT.md` / `DESIGN.md` 确认或任何“继续”流程。若其原生指令称缺少 `PRODUCT.md`、`DESIGN.md` 或其他上下文文件，宿主必须自动将其生成为当前 run 的内部工件，再继续 APEX 分析；这些文件不是用户确认点，也不能先于需求分析向用户提问。
- 每次向用户渲染任何按钮、提问或阶段文本前，宿主必须使用 Router 返回的 `userInteraction`、`nextRequiredDecision` 与 `capabilityExecution` 裁决。`capabilityExecution.mode: internal-non-interactive` 时，能力池的初始化、候选检索、文档生成和方案生成必须在同一自动执行链完成；禁止呈现 `确认产品定位`、`确认 PRODUCT.md`、`确认 DESIGN.md`、`生成视觉方案`、泛化 `确认` 或 `继续`。唯一可见的人机阀门仍只为 Router 给出的四个精确确认标签及 Demo 后的两项路线选择。
- 不得跳过 Preflight、Intent Brief、Gate 1、Gate 2 或 Gate 3。
- `generate_visual` 成功后，宿主必须直接展示 `runtime-demo.json` 中的可访问 Demo URL、入口视口、交互状态与运行时来源摘要（`runtime-source-lock.json` 的选中组件/样式/图标/动效文件）；不得另行生成、展示或要求确认静态效果图。内部浏览器截图只允许用于 Stitch 导入和机器一致性校验。Demo 页面是用户进入 Stitch 或直接代码路线前唯一的视觉审阅对象。
- `generate_visual` 的四项产物 `runtimeDemo`、`designCandidates`、`visualReference`、`gate1VisualOutput` 完成后，宿主必须调用 `register-runtime-demo`。该 Router 命令只接受成功 `generate_visual` operation receipt 中逐文件哈希匹配的当前输出；登记前不得调用 `select-route`、`sync_stitch`、实施冻结或 Gate 2，也不得以手填工件代替登记。
- Demo 产品原型源码只能通过 `visual-sandbox-writer.mjs materialize` 写入当前项目的 `<project-root>/.apex/runs/<run-id>/visual-sandbox`；manifest 也必须位于同一 run。用户目录中的孤立 `.apex`、APEX Core、其他项目、系统临时目录及正式 `src/app/pages/public` 均不是合法 Demo 写入目标。`apex-action` 对每个 `generate_visual` 受控动作执行正式项目树前后 SHA-256 快照，`.apex` 之外发生任何变化即判定动作失败。宿主不得用 `apply_patch`、shell 重定向或设计 Skill 绕过该写入器。
- 用户只在 `gate1`、`visual-plan`、`stitch`、`implementation` 当前确认点使用 `skip` 跳过当前人工确认并进入下一阶段；Router 必须登记原因与完整工件哈希。`visual-plan` 是 Gate 1 后唯一的视觉方案确认：APEX 必须调用 `google-design-md` 和至少一项 `ui-ux-pro-max-skill`、`impeccable` 或 `taste-skill`，结合用户任务、现有页面、信息密度、技术栈、无障碍和性能约束，按布局、样式、组件、字体及适用的图标、图表、动效逐类比较至少两项真实候选。每项比较必须说明平台适配、视觉高级感/整体性、落地成本，明确选中与拒绝理由；不得因候选库多就混搭，也不得仅列库名或用审美偏好替代分析。再展示并冻结每个布局、颜色/Token、字体、组件、图标、样式、动效和在线候选的精确来源、版本、资源 ID、参数与落地方式，收敛为同一设计系统；确认后 `generate_visual` 只能消费这份选择表并自动生成正式运行时 Demo，代码只能物化其中已选的最小精确资源。运行时 Demo是工件与 Stitch 输入，不是新的用户确认点。`skip stitch` 仍只豁免人工确认，必须已有 Stitch 工件。仅当用户明确要求“跳过 Stitch 步骤”时，才可使用 `skip-stage … stitch`：它跳过 Stitch 生成与确认，以已生成运行时 Demo作为实施基线，仍要求来源锁定、实施确认、Gate 2 和以运行时 Demo为基线的 Gate 3；“继续”等措辞绝不触发该路径。
- 只有用户明确要求“跳过/不需要本次确认/直接下一步”才可调用 `skip`；“继续”、调整提示词、查看、沉默和超时均不得被推断为跳过或批准。
- 不得用桥接 skill 替代 APEX Core 本体。
- 其他设计或实现 skill 只能在 APEX 分级与阶段内作为增强能力，不能绕过状态机、Gate 与实现权限。
- 用户在任何确认点前提出调整而未明确确认时，宿主必须调用已安装的开源 `doc-coauthoring` Skill 的自由反馈提取能力：识别保留/删除/修改项和隐含偏好，更新当前未确认工件并补齐受影响的缺失步骤。只采用该 Skill 的“自由反馈 → 偏好提取 → 局部修订”能力，不采用其逐节再次征询流程；不得新增用户确认、不改变现有 Gate、不得自动批准。调用结论必须通过既有 `contract-recorder.mjs` / Context Sources 记录为可审计、去敏的规则，并将引用写入 DESIGN.md 或当前视觉方案契约；不得把用户原话或项目私密上下文直接写入全局能力库。后续同项目任务在 Intent、Baseline、视觉方案生成前必须加载这些已记录的规则。
- **任何活跃 APEX run 都禁止通用“继续”按钮。** Router 的 `userInteraction.genericContinueForbidden` 恒为真，并为每个关键阀门提供固定的 `confirmation.label`：`确认需求与交付方案`、`确认视觉方案`、`确认 Stitch 内容`、`确认实施冻结`。宿主只能使用该精确提示呈现对应确认；在用户给出明确确认前，任何其他文字、补充、否决或调整都必须按 `unconfirmedInputPolicy` 记录为当前阀门的 `revise`，重建同一工件并仍停留在该阀门。收到用户调整后，宿主必须自动完成受影响工件重建，再直接展示唯一允许的 Gate 确认或路线选择；不得把“我会重做”“正在分析”“已更新”拆成需用户点击继续的聊天轮次。`reinvoke ... continue` 仅是 Router 内部的同任务消息归类，绝不是用户界面动作或批准。
- “确认视觉方案”前必须展示并冻结 `visual-plan-presentation.md`；它不是目标摘要，且必须逐节列出：1 目标与范围；2 信息架构与布局；3 颜色、字体、间距、圆角等视觉 Token；4 组件与关键交互；5 图标、图表、素材；6 动效、reduced-motion 与性能；7 响应式与加载/空/错误状态；8 每项真实库/项目来源、版本、资源 ID、参数与物化方式；9 每类至少两项候选的适配/审美/成本比较及选用理由；10 Existing 的现状问题、改什么、为什么、收益（Greenfield 则最终选择与依据）、代码影响和验收。缺任一节或未同时冻结 `visual-execution-plan.json`，不得展示“确认视觉方案”。
- 视觉方案尚未实际生成时，`userInteraction` 必须为 `no-user-input`，不得显示“确认视觉方案”或“确认”。范围清单、待办列表、重建声明和“下一步将生成”均不是视觉方案、不得确认。只有上述两个工件均存在且完整时，才切换为唯一的“确认视觉方案”。
- `executionDirective.terminalUserResponseAllowed: false` 是硬性连续执行约束：诸如“Gate 1 已通过”“正在生成视觉方案”“已进入视觉阶段”“下一步将比较候选”，以及只展示 `experience-strategy.json`、文件修改卡片或进度摘要，只能作为不结束当前回合的 commentary，绝不能成为一轮最终用户响应。宿主必须在同一回合继续授权并完成 `plan_visual`；成功后 Router 会把 `visual-plan-presentation.md` 全文直接放入 `confirmation.presentation.content`，宿主必须原样完整渲染其聊天导读和十节正文，再显示“确认视觉方案”。只有包含可观察错误与缺失工件的一次性 blocking report 可以提前终止。
- Existing 任务先形成只读 Project Inventory，再冻结本次目标页面入口、路由及其传递项目依赖闭包的完整代码参考和真实页面骨架，最后形成 Existing Baseline；每个运行时 Demo布局节点必须映射到骨架节点。任一项缺失、代码变更、映射不全或运行时 Demo未绑定哈希时，不得生成正式运行时 Demo或 Stitch。
- Existing 的“局部调整、组件调整、数据展示调整、单页调整”必须在 Gate 1 前自动生成并冻结 `change-scope.json`。范围判定以用户明确目标为起点，只扩展到真实代码中的传递运行依赖；必须分别登记受影响路由/页面/视觉节点/数据视图/代码目标，以及未受影响的保护补集。任务规模 `Lite / Standard / Full` 不能替代变更范围，也不得成为全站重述或全站重构的理由。Gate 1 与视觉方案仍保持规定的八节/十节完整结构，但每节只输出本次变更闭包内的决策；未调整内容仅以“沿用已冻结 Existing 基线”引用，不重复展示、不要求重新确认。视觉方案、来源选择、运行时 Demo变更、Visual Bundle 和 Implementation Map 中的节点与代码目标必须是该闭包的子集；越界即阻断。实施后 Gate 3 必须逐文件复核保护补集哈希，并对同文件内的未调整视觉节点做回归验证，任何未授权变化均不得交付。
- Gate 1 的规范审核必须先冻结 `styleBaseline`，不能只写“现代、专业”之类描述。Existing 必须从真实项目样式源文件提取并锁定 SHA-256，统一复用字体家族/字号阶梯/行高/字重、颜色与语义 Token、间距阶梯/页边距/区段间距、圆角/边框/阴影；视觉方案不得新增未在该基线内的值，除非用户明确批准并重建基线。0–1 必须先按设计规范冻结同样完整的 `greenfield-standard` Token 集，再开始视觉方案；不能把散落的 CSS 值当作规范。
- 视觉方案的用户可读决策叙事必须按轨道输出：Greenfield（0–1）只输出“最终选了什么 + 基于什么选择”，每项绑定 source selection；Existing（1–N 迭代）必须逐项输出“现状问题 + 要改什么 + 为什么改 + 最终选什么 + 能解决什么”，每项同样绑定 source selection。不得把 Existing 改造写成泛泛的新建风格提案，也不得以笼统的“优化体验”代替改造收益。
- Existing 与 Greenfield 的正式运行时 Demo前必须形成并遵守 `core/runtime/experience-strategy-contract.md`，并以 `experience-evaluator.mjs` 产出分数不低于 85、无关键缺失的质量证据：场景/用户任务、信息架构、数据表达、功能交互、Token/组件、响应式、无障碍、动效和反模式必须可追溯；不得把“高级、专业”等抽象形容词直接当作视觉指令。Visual 阶段必须呈现至少两个有明确取舍的候选；选中的候选哈希必须锁定正式运行时 Demo。
- 运行时 Demo生成前必须形成绑定当前运行时 Demo哈希的 Visual Source Manifest。能力池不是“仅供参考”的图库：一旦选择 shadcn/ui、Radix、Lucide、Motion 等组件、图标或动效来源，每个视觉节点都必须绑定到其精确包版本、已生成组件源码、项目已有代码或原生 Web 实现，并在运行时 Demo、Implementation Map 与最终代码中实际使用同一来源；项目未安装的候选先在 `visual-sandbox` 运行，Gate 2 后再安装或生成到项目。`ui-ux-pro-max-skill`、`impeccable`、`taste-skill` 等是设计决策能力，不是可加载 CSS 或组件包：它们必须登记为 `designCapabilities`，但不能充当任何节点的组件、样式或布局实现来源。图标、素材、图表、图示和动效在适用时也必须有具体来源、版本和参数。实施代码必须在对应目标中保留 `data-apex-source` 来源标记，审计会验证其存在；不得在落代码时重新搜索相似元素或用假匹配填充。
- 需求或参考包含动态效果时，运行时 Demo生成前必须先盘点并冻结项目已有动效资产、已安装库与宿主提供能力，并为每条正式动效选择可执行来源；运行时 Demo和动效预览只能使用该选择单中的能力。实施冻结前必须形成可调整并经用户确认解释的 Motion Contract 与 Motion Implementation Map；每条动效必须有业务角色、选择器、引擎、关键帧、时长/缓动、循环策略、代码目标/API、预览时间点、reduced-motion、性能预算和验收条件，并强制绑定 `functionalPlan` 中的任务、真实事件、不同的前后状态、可枚举的信息收益和价值说明。不能证明其服务操作反馈、状态变化、空间定位、层级引导、进度解释或风险提示的动效不得进入运行时 Demo或代码；产品页面禁止无限循环，`delight` 仅可在声明任务完成后以不超过 1200ms 的一次性反馈出现。Gate 2 必须验证能力→合同→实现映射→功能绑定闭环；Gate 3 必须取得每条动效至少两个运行时关键时间点样本、真实事件 trace、前后状态和 reduced-motion 证据；不得用单张静态截图放行动态复刻。
- Gate 2 通过前只允许读取项目代码、生成运行时 Demo、同步 Stitch、冻结和验证；禁止编辑项目代码、安装项目依赖、迁移或发布。若确认的视觉方案需要项目尚未安装的精确库，宿主必须在现有 `generate_visual` 中调用 `visual-sandbox-dependency.mjs prepare`，仅在 `<run-dir>/visual-sandbox` 解析该版本，校验项目 `package.json` 与 lockfile 不变，并用该真实运行时采集运行时 Demo和动效证据；不得以“等待 Gate 2 安装”为由阻断或向用户追加确认。Gate 2 后才可将同一锁定版本安装到项目。顺序固定为：Gate 1 文案确认 → **视觉实施方案确认（唯一视觉确认）** → 立即执行并展示 `generate_visual` 的运行时 Demo → Stitch 内容确认（仅选择 Stitch 时）→ 实施冻结（Visual Bundle + Implementation Map）确认 → 机器 Gate 2 → 实施。视觉方案确认回执返回自动 `executionDirective` 时，宿主必须在同一回合按 `requiredChain` 依次完成：在 `<run-dir>/visual-sandbox` **实际写入并启动 Demo 代码**（Existing 只能在已冻结的真实页面骨架映射上改造）、采集浏览器/动效证据、冻结运行时基线、生成 `visualReference`，再登记 Demo；它不能只说“已进入 Demo 阶段”。未产生 `runtime-demo.json`、可访问 URL、DOM、来源锁和浏览器证据时，禁止向用户发任何成功消息。生成前只允许 `generate_visual`；其成功输出齐备后 Router 会自动转为 `register_runtime_demo`，仍不允许用户操作。`executionDirective.automatic: true` 时不得渲染“继续”、确认、轮询或任何其他用户操作。下一条用户可见消息只能是实际候选运行时 Demo、可审阅的运行时 Demo工件，或一次性包含失败证据与缺失工件的阻断报告；不得要求用户再确认运行时 Demo。四次确认分别使用 `gate1`、`visual-plan`、`stitch`、`implementation` 回执；未满足当前确认的下游动作不在 Router `allowedActions` 中。
- 对标记为 `inline-transfer` 或 `generated-source` 的已选图标、SVG、CSS、字体或组件源码，运行时 Demo登记后必须在实施冻结期调用 `asset-materializer.mjs collect`，从运行时 Demo运行时已加载的精确文件中将**全部且仅被选中的文件**连同来源哈希、许可和项目目标路径写入 `materialized-assets.json`；Gate 2 必须验证该清单完整，Gate 2 后的 `implement` 调用 `apply` 将同一文件转存到项目，Gate 3 的 `verify` 调用 `audit` 逐文件比对哈希。对 `runtime-package`，Gate 2 后必须调用 `runtime-materializer.mjs install` 安装运行时 Demo锁定的最小精确包，再调用 `audit` 验证项目 package、完整 pattern 文件和实施目标 import/API；不得改为下载完整无关库，不得以只有包名/资源 ID 的 dependency lock 或 `data-apex-source` 标记代替实体文件和实际使用。
- 运行时 Demo展示后，Router 返回 `nextRequiredDecision.id: delivery-route`。这不是新增“确认 Demo”Gate，但必须被渲染为明确的 Demo 审阅决策：先展示可访问 Demo及布局、交互、响应式和真实来源摘要，再显示标题“运行时 Demo 已生成，请确认后续路线”，说明“选择任一路线即接受当前 Demo作为实施基线”。宿主只能提供两个完整标签：**继续执行流程（进入 Stitch）** 或 **直接代码（跳过 Stitch，继续实施冻结、Gate 2 与 Gate 3）**。用户未选择而提出任何修改时，必须按 `unselectedInputPolicy` 回到当前视觉方案、自动重建 Demo，再次展示同一决策，不能卡住也不能默认选择。用户选择后必须调用 `select-route <project-root> <run-id> <session-id> <stitch|direct-code> <decision-id> <reason> [artifacts...]`；不得仅凭按钮文案、聊天文本或内部 `skip-stage` 变更状态。选择直接代码时 Router 受控地复用 Stitch stage skip，并继续 `compile_visual_bundle`、实施确认、Gate 2 与 Gate 3；严禁要求“停止 APEX”、要求跳过后续 Gate，或把直接代码表述为脱离 APEX 的实现。
- 在 `delivery-route` 决策点，用户输入“直接代码”“直接生成代码”“直接生成生产代码”或“跳过 Stitch 生成代码”均必须映射为 `direct-code`，不能回答“代码已存在”。判断生产代码是否存在时必须排除整个 `.apex`、runtime-demo、visual-sandbox、截图与 Stitch 工件；这些只是临时证据。`direct-code` 表示跳过 Stitch，随后自动形成 Visual Bundle 与 Implementation Map，展示“确认实施冻结”，通过 Gate 2 后才写入正式生产目录；它绝不表示跳过 APEX Gate。
- 每个正式页面必须先冻结响应式合同：至少覆盖 mobile、tablet、desktop 三类视口，逐项声明宽度范围、布局模式、组件重排、文字缩放、媒体处理、横向溢出例外及验收条件。运行时 Demo、Stitch 与代码必须遵守同一合同；不得以压缩桌面布局代替移动端设计，也不得出现未经声明的横向滚动、裁切、重叠或变形。Gate 3 除三类代表视口外，还必须在每个宽度区间的最小、中间、最大宽度采集真实截图，并逐项证明无横向溢出、重叠、裁切、文字不可读或比例漂移。
- 浏览器截图、交互和控制台采集使用 APEX `browser-capture.mjs` 与全局 Playwright bridge；截图是证据，不等于视觉批准。
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

- `gate1`、`visual-plan`、`stitch` 与 `implementation` 的每一次用户确认前，必须先向用户展示当前工件、差异、待确认项与可调整提示词；用户可多次调整，APEX 不得将“继续”“看看”“差不多”自动视为批准。运行时 Demo生成后只展示结果，不增加 `visual` 用户确认。
- 不得把用户的每一句补充都当作冻结基线变更。先比较其是否会改变已冻结的布局、内容、组件、视觉 token、动效/3D、依赖、交互或实现映射；仅当实际工件会变化时才调用 `revise`。纯说明、偏好重述或未改变冻结字段的补充使用 `non-baseline`，只记录审计事件，不撤销任何确认或实施授权。
- 用户明确确认前，使用 `revise <project-root> <run-id> <session-id> <checkpoint> <visible|implementation-only|non-baseline> <reason>` 记录调整。`visible` 才会回到运行时 Demo阶段；`stitch` 变更仅撤销 Stitch 与实施冻结；Gate 2 前的 `implementation-only` 仅撤销实施冻结。Gate 2 已开放后，明确授权且不触碰冻结视觉/动效/依赖/映射的 `implementation-only` 改动保留 Gate 2 和实施权限，仍须完成 Gate 3 重新验证。
