# APEX 可执行 Gate

基础校验器位于 `scripts/apex-validate.mjs`：

```bash
node scripts/apex-validate.mjs validate run-state.schema.json .apex/runs/<run-id>/state.json
node scripts/apex-validate.mjs pre-gate2 .apex/runs/<run-id>
node scripts/apex-validate.mjs gate2 .apex/runs/<run-id>
node scripts/apex-validate.mjs hash <files...>
```

`pre-gate2` 验证所有冻结产物但不自行替用户授权。用户确认后，编排器才可以把 Gate 2 和实现权限写为通过，再用 `gate2` 复验。任何实现 Worker 启动前都必须执行 `gate2`；失败即停止，不得降级为警告。

该校验器只验证通用结构和锁关系。项目 Adapter 还必须补充真实 API、DOM、权限、运行时、浏览器和回归验证。

状态变更由 `scripts/apex-router.mjs transition` 统一发起；`scripts/apex-run.mjs`
是 Router 内部控制器，直接调用会被拒绝：

```bash
node scripts/apex-router.mjs intake <project-root> <run-id> <track> [scope] [authorization] <session-id> <explicit-user-apex-consent>
node scripts/apex-router.mjs restart <project-root> <new-run-id> <track> [scope] [authorization] <session-id> [reason]
node scripts/apex-router.mjs reinvoke <project-root> <session-id> <continue|new-task> [new-run-id greenfield|existing lite|standard|full interactive|autonomous reason]
node scripts/apex-router.mjs approve <project-root> <run-id> <session-id> <gate1|visual-plan|stitch|implementation> <approval-id> <run-relative-artifact> [...]
node scripts/apex-router.mjs skip <project-root> <run-id> <session-id> <gate1|visual-plan|stitch|implementation> <decision-id> <reason> [run-relative-artifact ...]
node scripts/apex-router.mjs handoff <project-root> <run-id> <session-id> <gate1|visual-plan|stitch|implementation> <decision-id> <reason> [run-relative-artifact ...]
node scripts/apex-router.mjs select-route <project-root> <run-id> <session-id> <stitch|direct-code> <decision-id> <reason> [run-relative-artifact ...]
node scripts/apex-router.mjs register-runtime-demo <project-root> <run-id> <session-id>
node scripts/apex-router.mjs present-runtime-demo <project-root> <run-id> <session-id> <authorization-ref> <presentation-id>
node scripts/apex-router.mjs resume-handoff <project-root> <run-id> <session-id> [reason]
node scripts/apex-router.mjs transition <project-root> <run-id> <session-id> <authorization-ref> <open-gate2|pass-proof|open-gate3|revoke-stitch|checkpoint> [args...]
```

禁止人工把 `implementationAllowed` 改为 `true` 绕过 `open-gate2`。

## 确认点跳过决策

用户可在 Gate 1、效果图、Stitch 或实施冻结的**当前确认点**显式选择跳过人工确认。

`skip stitch` 只跳过 Stitch 的人工确认，仍需要已生成且通过严格校验的 Stitch 工件。若用户明确说“跳过 Stitch 步骤”，Router 才可执行 `skip-stage … stitch`：不生成 Stitch 画布，改为将已确认效果图锁定为实施与 Gate 3 的基线；来源清单、实施确认、Gate 2 与 Gate 3 一律保留，任何“继续”或未明确指令都不会触发该分支。
`skip` 会写入带理由的确认豁免回执，并直接进入下一阶段；它只跳过当前的人工确认，
不会跳过已生成工件、哈希冻结、严格保真、机器 Gate 或之后的确认点。缺少该确认点
必需工件或机器校验失败时，Router 仍会拒绝继续；Gate 2 前也始终不能编辑代码。
只有用户明确提出“跳过/不需要本次确认/直接进入下一步”时，宿主才可调用 `skip`；
“继续”、提示词补充、查看工件、沉默或超时都不是跳过指令，必须继续等待当前确认。

## 修订影响分级

`revise` 不得因为出现了一句视觉相关文字就撤销整条链路。宿主先将调整分为：`non-baseline`（不改变冻结工件字段，仅留审计）、`implementation-only`（只改变实现细节）和 `visible`（改变视觉/动效/依赖/布局等冻结事实）。只有 `visible` 才从视觉计划重新开始；Stitch 变更仅撤销 Stitch 之后；Gate 2 前的 `implementation-only` 仅撤销实施冻结。Gate 2 已通过时，明确授权且不改变冻结事实的 `implementation-only` 变更保留 Gate 2 与实施权限，Gate 3 负责重新验证实际结果。

## Responsive Gate

`visual-execution-plan.json` 和 `visual-bundle.json` 的响应式合同必须使用同一 `contractId`，并覆盖 mobile、tablet、desktop 三类视口。每类需要宽度范围与布局模式，合同还必须明确组件重排、文字缩放、媒体行为、横向溢出策略和验收标准。Gate 3 的 `runtime-state-matrix.json` 必须携带该 `responsiveContractId`，除三类代表视口外，每类还需在该范围的最小/中间/最大宽度提交通过截图和无溢出、无重叠、无裁切、文字可读、比例稳定断言；缺任一类或任一采样点失败，均不得通过。

如果用户实际想暂停/交接而非继续，使用 `handoff`。它才会把 run 标记为 `handed-off`，
保留所有工件、关闭下游权限；用户可用 `resume-handoff` 回到原确认点，且不会重置工件。

Codex 调用必须先经过 `apex-router.mjs`。Router 将审批写入项目 run 的
`approvals/`，并同时冻结被确认产物的 SHA-256；`apex-run` 不再接受任意文字
作为 Gate 1 或视觉确认凭据。

## 严格复刻执行器

以下动作均须先由 Router `authorize`，再通过 `apex-action.mjs run` 调用；表中的
箭头不是可直连 shell 命令。每次 state 变化后，旧授权自动失效，下一步须重新授权。

标准自动链路：

    compile_visual_bundle -> visual-reference-compiler.mjs emit <run-dir> <gate1-visual-output.json>
    stitch-sync capabilities is read-only discovery; all mutating calls use sync_stitch
    sync_stitch -> stitch-ui-importer.mjs import <run-dir> <stitch-ui-import-plan.json>
    observe_stitch -> stitch-sync.mjs bind-screen <run-dir> <stitch-job.json> <project-id> <screen-id>
    observe_stitch -> stitch-sync.mjs await-screen <run-dir> <stitch-job.json> [attempts]
    sync_stitch -> stitch-sync.mjs freeze <run-dir> <canvas-selection.json>
    validate_stitch -> strict-replica.mjs stitch <run-dir> <screen-id>
    verify -> browser-capture.mjs capture <run-dir> <base-url> <browser-spec.json>
    verify -> strict-replica.mjs runtime <run-dir> <capture-id> <frozen-stitch-screen-id>

strict-replica 自动调用 structure-contract 与 visual-parity，生成合同、parity 输入和证据。Freeze 仅为暂存；Stitch 阶段的 strict-replica 通过后，先由用户确认 Stitch，再由 `sync_stitch` 执行 Seal。禁止手工拼装 candidateContract 或通过证据。

## Motion Gate

## 交付路线选择 Gate

新 Run 用户确认产品与视觉合并方案后，Router 自动授权 `generate_visual`，物化并启动当前 Run 的 Demo、执行浏览器任务交互并冻结运行时基线，再登记和展示 Demo。宿主必须完整执行这些受控步骤，不能要求用户点击“继续”。展示后用户明确确认交互式 Demo，再选择 Stitch 或直接代码；用户提出修改则重建并重新确认受影响内容。旧 Run 按其原确认模型恢复。

`generate_visual` 必须通过受控动作分别产出 `runtimeDemo`、`designCandidates`、`visualReference` 与 `gate1VisualOutput`。四项输出完成后，宿主必须调用 `register-runtime-demo`；Router 会逐文件核验 SHA-256 与成功 `generate_visual` operation receipt，再一次性登记 Demo 基线。登记不是展示：宿主必须只打开当前 Run 的 `visual-sandbox-runtime.json` 与 `runtime-demo.json` 精确一致的 `http://127.0.0.1:<port>/` URL，再以 `present-runtime-demo` 写入展示回执。`file://`、正式项目服务地址、项目根页面或其他 Run 的 URL 一律拒绝。没有该展示回执，`select-route`、Stitch、实施冻结和 Gate 2 均保持关闭；手填文件、旧文件或非该动作输出一律拒绝。

Demo 源码必须先形成 run 内 source manifest，再由 `visual-sandbox-writer.mjs materialize` 写入当前 `<project-root>/.apex/runs/<run-id>/visual-sandbox`。写入器拒绝绝对路径、`..` 越界、符号链接逃逸、外部 manifest、孤立 `.apex` 和非当前 Router run。`apex-action` 在每个 `generate_visual` 动作前后比较排除 `.apex/.git/node_modules/dist/build` 后的正式项目文件 SHA-256；正式树变化则动作失败。Demo代码不属于正式项目代码，不得触发“代码已存在”。

新 Run 的路线选择必须在 Demo 确认后调用 Router 的 `select-route`，不得从普通聊天或 `skip-stage` 推断。`direct-code` 跳过 Stitch，但保留已确认 Demo、Visual Bundle、Implementation Map、依赖锁、机器 Gate 2 和实施后的验证。`stitch` 路线核验候选与已确认 Demo 的一致性；一致时自动封存，存在差异时向用户呈现差异，并提供保留 Demo 直接落地或调整方案的选择。实施冻结是内部机器操作，不新增独立确认。

## Runtime Visual Baseline Gate

## 正式实施登记

新 Run 的正式目标由已审核的 Implementation Map 确定。Gate 2 后先持有效项目 mutation lease 和 `implement` 授权完成代码，再以 Router `register-implementation` 登记 Run 内 page delta、实施映射和正式文件哈希。注册拒绝 Run 沙箱、构建目录、项目外路径与失效租约；Existing 同时检查受保护文件。正式文件、映射或 delta 发生变化时，登记不再有效；重新登记后须重新采集受影响的正式浏览器证据和验证结果，不得复用旧交付结论。

## 证据与溯源 Gate

Gate 3 前必须调用 `evidence-provenance.mjs seal`，将浏览器、测试、构建、依赖或运行时原始证据与产生它们的成功 Router 操作回执一起封存。每项封存证据必须记录文件哈希，并与回执中的 `outputFileHashes` 精确匹配；无原始文件、无成功回执、非该操作输出、哈希变化或仅由 AI/模板/手填 JSON 声明的结论均为 `unverified`，不得作为 Gate 3 的 `passed` 依据。

行业基准复核不得把视觉方案中的计划分数复制为验证分数。Gate 3 的 `industry-benchmark.mjs verify` 必须接收逐准则 `industry-benchmark-review.json`：每项都绑定已封存的浏览器采集证据 ID、已在 DOM 中渲染的来源选择、观察结论和独立分数。受控操作回执必须记录该复核输入的哈希；复核、回执或任一渲染来源变化都使行业结论失效。此为 Gate 3 内部机器/审阅复核，不新增用户确认。

`generate_visual -> browser-capture.mjs capture <run-dir> <sandbox-url> <browser-spec.json>` 只能采集隔离视觉沙盒的真实 DOM、截图与动效帧；spec 必须声明本次视觉方案的 `requiredSourceSelectionIds` 和 `requiredSourceFiles`，页面 DOM 必须以 `data-apex-source-selection` 暴露每个已选来源，并以 `data-apex-source-file="<selectionId>:<sha256>"` 暴露每个完整 pattern 的组件/样式/动效文件哈希，否则截图失败。若确认方案选用了项目未安装的精确在线候选，复用同一 `generate_visual` 阶段先执行 `visual-sandbox-dependency.mjs prepare`：仅在 `<run-dir>/visual-sandbox` 解析该版本，强制校验项目 `package.json` 与 lockfile 哈希未变化。随后 `runtime-visual-baseline.mjs compile` 冻结项目已安装库或该隔离沙盒中已运行 package 的精确版本、完整 pattern 源码/样式/动效文件的逐文件哈希、props/theme 与浏览器证据，并记录来源类别。Gate 2 前严禁把候选写入项目依赖；Gate 2 后才安装同一锁定版本。`visual-reference-compiler.mjs emit` 仅可使用这个基线的截图；ImageGen 不能生成 UI 结构、组件样式或动态效果。没有完整 pattern、真实 DOM、选中来源与精确文件 DOM 标记、截图、动效关键帧或 reduced-motion 方案时，效果图不得进入确认。

正式效果图之前必须先通过用户确认的 `visual-execution-plan.json`。它列出布局、颜色、字体、特效、组件和每条动效的引擎/API；对于项目未安装的在线候选，还必须列出官方来源、精确版本、许可/风险和 `installAfterGate2: true`。若使用 3D/WebGL，每个场景还必须锁定 Three/Babylon 引擎、renderer、精确依赖、模型/纹理/环境资源、性能预算、静态降级与 reduced-motion。只有该方案确认后，`generate_visual` 才可被 Router 授权；Gate 2 再验证每个 online candidate 和每个 3D runtime 同时出现在方案和 `dependency-lock.json` 中。

动态效果不是补几条 `@keyframes`。当 Visual Bundle 含动效时，实施冻结前必须通过
`motion-capability.mjs compile <run-dir> <project-root> <selection.json>` 冻结项目已有动效资产、可用运行库及本次选定的设计/组件/动效能力。每条正式动效必须绑定真实实现路径和至少两个预览时间点；未选择或未绑定的动效不得进入效果图、Stitch 或 Gate 2。

`motion-contract.mjs compile <run-dir> <motion-spec.json>` 生成 `motion-contract.json`。每条动效
必须绑定业务角色、选择器、CSS/WAAPI/Framer Motion/GSAP 引擎、可动画属性、触发方式、至少两个
关键帧、时长/缓动、循环策略、reduced-motion 和性能预算；还必须绑定已冻结 `functionalPlan` 中的
**任务、真实事件、前后业务状态、信息收益与价值说明**。不能映射到操作反馈、状态变化、空间定位、
层级引导、进度解释或风险提示之一的动效不得进入效果图或代码。产品交付禁止无限循环；`delight`
仅可在已声明的任务完成后，以不超过 1200ms 的一次性反馈出现。

Gate 3 前，浏览器规格可在 screen 中声明 `motionSamples: [{ id, timestampMs }]` 采集关键时间点截图；每帧由 `browser-capture.mjs` 写入 SHA-256，运行时基线至少两帧必须具有不同指纹，静态页面不得用多张相同截图伪装动效；
随后用 `motion-contract.mjs verify <run-dir> <motion-evidence.json>` 验证每条动效至少两张运行时样本、
触发事件的结构化运行时 trace、trace 哈希、前后状态和 reduced-motion 证据。trace 内容必须实际包含
该动效 ID、事件、前后状态、通过结果和时间戳；缺少合同、合同哈希不匹配、事件—状态闭环、trace 内容/哈希、
样本或 reduced-motion 证据，Gate 3 必须失败。

若方案含 3D 场景，使用 `three-d-evidence.mjs record <run-dir> <input.json>` 仅在真实运行证据文件已写入 run 目录后登记 `three-d-evidence.json`。它必须覆盖每个冻结场景及同一 renderer，并保存 renderer 截图、性能、静态降级和 reduced-motion 证据；Gate 3 将其与视觉方案哈希逐项核验。

## Visual Source Gate

`visual-source.mjs compile <run-dir> <source-manifest.json>` 必须在正式效果图工件登记后、实施冻结前执行。每个视觉节点都要锁定布局、组件、样式和内容来源；图标、图表、图示、素材和动效出现时也必须锁定具体资源。宿主 Skill 名称、APEX 官方注册来源和 native-web 能力会被校验；任何新增候选库必须在 `dependency-lock.json` 中有精确锁定。Implementation Map 必须保留同一来源 ID、代码目标、选择器和 `data-apex-source` 标记；Gate 2 / Gate 3 审计不接受“相似替代”或未标记代码。

正式项目的 Gate 3 浏览器采集不得依赖手写的空 `requiredSourceSelectionIds`。`browser-capture.mjs` 必须从已冻结的 Visual Source Manifest 和 Visual Execution Plan 自动导出每个正式节点的 `selector + data-apex-source marker + sourceSelectionIds`，并在每个采集视口验证该选择器上的精确标记。采集结果必须把已渲染标记映射回全部来源选择，`runtime-state-matrix.json.sourceProvenance` 必须保存该映射；缺少标记、标记未在对应选择器上渲染、或来源选择覆盖不完整，都只能回到受控的 implementation/verify 自动步骤，不得等到行业基准复核才暴露为 Gate 3 失败。

来源不是只写入 `dependency-lock.json`。选中 `inline-transfer` / `generated-source` 时，必须由 `asset-materializer.mjs collect` 从效果图已运行的精确文件中冻结全部组件、样式、图标或字体文件；Gate 2 必须看到该冻结清单，Gate 3 必须逐文件验证项目副本。选中 `runtime-package` 时，必须由 `runtime-materializer.mjs install` 在 Gate 2 后按锁定版本安装最小必需 package，再由 `audit` 验证项目 package manifest、pattern 组件/样式/动效文件哈希以及实施目标的真实 import/API 使用；不得仅凭包名、来源标记或相似 CSS 放行。

底层调试命令：

    validate_stitch -> structure-contract.mjs stitch <run-dir> <screen-id>
    verify -> structure-contract.mjs runtime-captured <run-dir> <capture-id>
    validate_stitch|verify -> visual-parity.mjs compare <run-dir> <stitch|implementation> <parity-input.json>
    sync_stitch -> stitch-sync.mjs seal <run-dir>
    sync_stitch -> stitch-sync.mjs check <run-dir>

其他运行器：

    compile_visual_bundle -> asset-resolver.mjs resolve <run-dir> <asset-selection.json>
    compile_visual_bundle -> bundle-compiler.mjs compile <run-dir> <visual-spec.json>
    record_context -> context-compiler.mjs compile <run-dir> <context-sources.json> [project-root]
    verify -> verification-orchestrator.mjs run <run-dir> <verification-plan.json> [project-root]
    collect_existing_baseline -> project-intake.mjs scan <run-dir> <project-root>
    verify -> verification-planner.mjs generate <run-dir>
    verify -> contract-verifier.mjs verify <run-dir> <samples.json>
    verify -> quality-evidence.mjs verify <run-dir> <visual|accessibility|performance> <input.json> [project-root]
    node scripts/apex-router.mjs authorize <project-root> <run-id> <session-id> pass_proof
    node scripts/apex-router.mjs transition <project-root> <run-id> <session-id> <authorization-ref> pass-proof <evidence-path>
    `pass-proof` 只接受本 run 内、由成功 `verify` 受控操作输出且其 `outputFileHashes` 与当前文件哈希相同的 `passed` 证据；手填 JSON、旧回执或后写同路径文件均不能通过。

    node scripts/apex-router.mjs authorize <project-root> <run-id> <session-id> open_gate3
    node scripts/apex-router.mjs transition <project-root> <run-id> <session-id> <authorization-ref> open-gate3
    recover -> apex-recover.mjs <run-dir>
    node scripts/release-audit.mjs

`stitch-sync capabilities` 必须在需要图文生成的 Visual 阶段先运行；若没有原生图片输入能力，记录 Stitch UI 导入路径，不得静默调用文本生成。UI 导入先做不超过 15 秒的浏览器桥健康检查，失败时不得开始上传；优先使用已缓存的 Playwright CLI。UI 点击提交前先持久化 `submission-uncertain` 与 `stitch-job.json`；超时或中断时只能观察并绑定远端结果，不得重复提交。提交确认后更新作业状态；恢复时先绑定实际 Screen，默认只做一次短观察，未就绪即返回 `pending`，下一次只观察而不得再次提交。需要更长观察时才显式传入 attempts（上限 3）。`stitch-sync check`必须在实现前、恢复时、Proof前和Gate 3前运行。验证计划的八类证据缺少任意一类时，Gate 3保持失败。

每个 `apex-action` 回执都会记录 `durationMs`。性能诊断应据此区分本地执行、浏览器桥、远端 Stitch 和恢复等待；不得把未就绪任务统一报为“重新连接”。
