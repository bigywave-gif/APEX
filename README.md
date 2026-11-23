# APEX 交付系统

## 4.37.5：登记事务恢复

Gate 1 方案、运行时 Demo 登记与 Demo 展示均采用“收据先落盘、状态后提交”的可恢复事务。运行时 Demo 登记不等于展示：只有当前 Run 的同源聊天片段已准备输出（宿主须在同轮最终回复嵌入），或其 run-local `visual-sandbox` HTTP 回退预览被实际打开，并留下哈希绑定回执后，才开放 Stitch 或直接代码路线；`file://`、正式服务和其他 Run 均会被拒绝。进程在这些边界中断时，Router 在后续 `status` 或 `resume` 中只会重放与当前 `project + run + session`、工件 SHA-256 及原受控操作回执完全一致的收据；不会跨 Session 复用数据、重跑已完成的生成步骤或重复展示同一确认门。

APEX 以 [Apache License 2.0](LICENSE) 发布。

## 定义

在本系统中，`APEX` 采用的正式展开名为：

`Agentic Product EXperience`

其中：

- `Agentic`：强调由 agent 驱动的结构化执行
- `Product`：强调面向真实产品与真实业务
- `EXperience`：强调前端、UI、视觉、UX 与真实体验交付

`APEX` 同时也是这套系统的总称；其完整名称为：

`APEX 用户意图驱动的全栈交付系统`

`APEX` 是一套通用的 Agentic Delivery System，不绑定某个具体业务项目。

它的目标不是提供一份静态方法论文档，而是提供一套可调用、可执行、可迁移、可验收的产品、设计、前端、后端、数据与体验交付系统。

系统由五部分组成：

1. `core/`
2. `references/`
3. `registry/`
4. `connectors/`
5. `adapters/`

为了降低阅读跳转成本，当前还补充了一层：

6. `system-docs/`

同时补充了一层宿主接入运行目录：

7. `runtime/`

以及可执行控制层：

8. `scripts/`

## 目录职责

### `core/`

放通用主框架、状态机、Gate、运行时规则、角色职责、模板和策略。

### `references/`

放第三方来源与 APEX 采用后的规则提炼。

补充说明：

- `external/`：来源信息、采用边界、版本与许可策略
- `adopted/`：APEX 真正采用后的本地规则

### `registry/`

放 APEX 对外部能力的声明与登记规则。

补充说明：

- `required-capabilities.yaml`：必需能力真相源
- `optional-capabilities.yaml`：可选增强能力真相源
- `registration-record.example.yaml`：宿主登记样例
- `skills/manifest.yaml`：外部 skill 声明真相源
- `skills/activation-matrix.md`：按阶段启用矩阵
- `skills/conflict-matrix.md`：冲突与优先级矩阵
- `skills/*.md`：skill 契约文件，仅用于声明与接入，不是 IDE 安装态本身
- `assets/online-sources.yaml`：不保存第三方源码副本的在线候选能力池；它不是仅供视觉参考：被选中的组件、图标、样式或动效必须以精确版本在 `visual-sandbox` 或项目运行时实际加载，并在 Gate 2 后安装或生成到项目；按任务动态择优，不设置全局强制库
- `assets/contract.md`：Visual Bundle 素材身份、完整依赖锁、许可证和失败回退契约

### `connectors/`

放通用项目类型的接入模板，例如 `generic-web-app`、`react-saas`。

### `adapters/`

放具体项目的接入层。项目只作为 APEX 的使用方，不是宿主。

补充说明：

- `README.md`：adapter 目录职责
- `examples/`：通用示例接入层

### `system-docs/`

放 APEX 本体的一站式主文档入口。

补充说明：

- 提供产品主文档
- 提供技术架构主文档
- 提供部署与接入主文档
- 不替代 `core/` 真相源，只降低阅读成本

### `runtime/`

放宿主发现、Preflight 与桥接协议。

补充说明：

- `preflight.md`：正式运行前的宿主检查规则
- `codex-discovery.md`：Codex 如何发现并调用 APEX
- `host-bridges/`：桥接宿主能力的最小包装层

### `scripts/`

除 Router、Gate、Visual 与验证脚本外，APEX 提供 `role-advisory.mjs`：它把产品、交付、后端、UX/UI、前端、按需的图表/动效、QA、实施审查与证据核验记录为当前 run 的结构化 advisory。角色不直接改项目、不创建额外确认；Router 仅在既有 Gate 的完整方案中汇总其结论。每个被选中的职业角色都会创建带输入哈希、预算和 trace 的耐久 Agent Job；失败进入受控重试或死信队列并阻断当前 Gate，不能以 `unverified` 建议伪造通过，也不能因重复重试重复消耗 Token。

每个受控动作还绑定 `run + stateHash + action + script + inputDigest` 的稳定操作键。新的授权不是新的输入：相同操作键的失败只能作为一次可审计阻断，只有运行状态、真实输入或已观察到的环境原因改变后才允许重试。运行时视觉基线同样要求至少两帧真实浏览器截图具有不同 SHA-256，避免静态页面以重复截图伪造动效证据。

放 Router、受控动作入口和 Gate 校验器。`apex-router.mjs` 是唯一公开的状态、登记与 Gate 命令入口；`apex-run.mjs` 刻意拒绝直接执行或导入，防止绕过 Router；`apex-validate.mjs`负责 Schema、锁关系和实现权限验证。

## 安装与自检

```bash
git clone https://github.com/bigywave-gif/APEX.git
cd APEX
npm run install:apex
npm run preflight
npm test
```

默认安装到当前用户的 `~/.codex/apex/APEX`，同步 `~/.codex/skills/apex/SKILL.md`，并合并安装 APEX 的 Codex `Stop` Hook 与非阻断 `PreToolUse` 会话刷新 Hook。前者只在当前 Codex session 绑定了未完成 APEX Run 时阻止提前结束；后者会在已绑定旧 session 的下一次工具调用前重绑当前 Core/Bridge。若宿主设置了 `CODEX_HOME`，三者都以该目录为根。安装器不会覆盖非空 Core、不会改业务项目，也不会自动下载第三方 Skill；Preflight 会列出真实缺失项、来源与显式安装命令。Codex 若未来提供用户消息前 Hook，可复用同一 `refresh-session` 守卫实现模型开始回答前的完全热更新；当前不伪造未支持的事件。

## 使用方式

当 `Codex` 已发现本地 APEX 包后，调用 APEX 时，建议使用统一入口：

```text
[APEX]
任务：
范围：
目标：
阶段要求：
约束：
```

或：

```text
[APEX-Lite]
[APEX-Standard]
[APEX-Full]
```

页面、视觉或交互请求即使命中 APEX，也**不会自动进入状态机**。首轮只会说明 APEX 将增加的 Gate、来源锁与运行时验证，并询问是否调用；只有用户明确回复如“确认调用 APEX”或“使用 APEX”后，Router 才会创建当前 session 的 Run。模型的“我会使用 APEX”、页面改造计划或普通 UI 请求都不是授权，也不会产生 Run、采集或阶段进度。

## 系统主文档入口

如果希望直观完整地查看 APEX 本体内容，优先阅读：

1. [system-docs/README.md](system-docs/README.md)
2. [system-docs/product-document.md](system-docs/product-document.md)
3. [system-docs/technical-architecture.md](system-docs/technical-architecture.md)
4. [system-docs/deployment-and-integration.md](system-docs/deployment-and-integration.md)
5. [APEX 产品设计与技术架构白皮书](output/pdf/APEX-Product-Design-and-Technical-Architecture.pdf)

## APEX 当前系统调用链（版本以 `manifest.yaml` 为准）

APEX 先编译用户短需求为 Intent Brief 和 Delivery Contract，再按 `Greenfield / Existing` 分轨，并组合 `Lite / Standard / Full` 范围和 `Interactive / Autonomous` 授权。新项目先建立产品、技术、数据和 Site Contract；已有项目先核对真实基线、冻结功能和影响范围。

新 Run 先由产品角色形成方案，设计师结合需求和真实现状完成视觉方案。用户确认视觉方案后，在隔离 Run 中生成并展示可交互 Demo；用户确认 Demo 后选择 Stitch 或直接代码。Stitch 候选一致时自动验证封存，存在差异时由用户选择保留 Demo 直接落地或调整方案。两条路线均需冻结已确认基线，通过机器 Gate 2、正式代码实现和 Gate 3 验证。旧 Run 按原确认模型恢复。

运行状态和产物位于目标项目 `.apex/runs/<run-id>/`；Checkpoint、内容哈希和 `run-ledger.sqlite` 持久账本支持增量恢复，不再因中断无条件重跑全部流程。用户明确终止当前 APEX Run 时，Router 会先以 Run ID 和沙盒根目录验证并停止该 Run 的临时 Demo 服务/端口，再回收该 Run 的候选、截图、缓存、证据、审批和其他临时文件；仅保留 `state.json` 兼容投影、`run-ledger.sqlite`、`events.ndjson` 与 `cancellation-receipt.json`。该操作只影响当前 session 绑定 Run，不会停止项目正式服务、清理其他 session/Run 或回滚已获批准的正式代码。

## 系统边界

APEX 是“通用交付系统”，不是：

- 某个单项目的产品文档
- 某个页面的静态设计稿集合
- 某个技能仓库的镜像副本
- 某个前端框架专属脚手架

APEX 负责：

- 定义交付主流程
- 定义技能接入与调用顺序
- 定义项目接入层结构
- 定义验收门与恢复机制

项目自身负责：

- 提供真实代码真相源
- 提供真实页面和业务目标
- 提供项目 adapter
- 提供运行、构建、验收与发布环境

## 迁移原则

如果要把 APEX 迁移给其他项目或其他人使用：

1. 把整个 `APEX` 目录复制到宿主固定发现目录
2. 让目标项目保留自己的产品、代码和部署文档
3. 新建目标项目自己的 `adapter`
4. 使用最接近的 `connector`
5. 由宿主先发现 `manifest.yaml`，再由 APEX 读取项目

## 开源使用边界

如果目标是把 APEX 作为“开源且可长期使用的系统包”对外迁移，还必须额外满足：

1. 关键规范、组件语言、工具来源具备公开来源与许可证
2. 宿主本地 skill 不能作为硬依赖
3. 插件 / 宿主能力必须有降级策略
4. 采用状态以 [references/external/sources.yaml](references/external/sources.yaml) 与 [references/external/open-source-eligibility-policy.md](references/external/open-source-eligibility-policy.md) 为准

## 持续更新能力

APEX 支持在使用中持续补充外部能力池，但遵循：

- 先检查本地，再检查外部
- 同时判断 `最新` 与 `最优`
- 不自动替换现有能力池
- 如发现值得纳入的新开源能力，应提示用户是否更新与补充

补充边界：

- 持续更新只允许作用于增强层
- 不允许影响核心工作流、状态机、Gate 与项目 adapter 真相源
- 更新目标仅限专项能力增强、效果增强、约束增强、规范增强
- 用户确认前只能提示，不能替换默认能力池
- 外部更新检查默认后台执行
- 更新检查结果返回不应阻塞当前主任务

规则真相源见：

- [references/external/continuous-update-policy.md](references/external/continuous-update-policy.md)

## 接入示例

匿名通用 SaaS 接入层位于：

- [adapters/examples/generic-saas/adapter.md](adapters/examples/generic-saas/adapter.md)

## 关键文件

- [INDEX.md](INDEX.md)
- [PACKAGING.md](PACKAGING.md)
- [manifest.yaml](manifest.yaml)
- [core/framework/APEX.md](core/framework/APEX.md)
- [core/framework/state-machine.md](core/framework/state-machine.md)
- [core/framework/gates.md](core/framework/gates.md)
- [core/runtime/invocation-spec.md](core/runtime/invocation-spec.md)
- [core/policies/admission-rules.md](core/policies/admission-rules.md)
- [core/policies/priority-model.md](core/policies/priority-model.md)
- [core/policies/accessibility-gate.md](core/policies/accessibility-gate.md)
- [core/runtime/apex-audit-spec.md](core/runtime/apex-audit-spec.md)
- [core/runtime/token-policy.md](core/runtime/token-policy.md)
- [core/runtime/tooling-matrix.md](core/runtime/tooling-matrix.md)
- [core/runtime/host-capability-governance.md](core/runtime/host-capability-governance.md)
- [core/runtime/system-requirements.md](core/runtime/system-requirements.md)
- [runtime/preflight.md](runtime/preflight.md)
- [runtime/codex-discovery.md](runtime/codex-discovery.md)
- [registry/required-capabilities.yaml](registry/required-capabilities.yaml)
- [registry/optional-capabilities.yaml](registry/optional-capabilities.yaml)
- [registry/skills/manifest.yaml](registry/skills/manifest.yaml)
- [registry/skills/activation-matrix.md](registry/skills/activation-matrix.md)
- [registry/skills/conflict-matrix.md](registry/skills/conflict-matrix.md)

## Demo 交付形式：可交互 UI 原型

APEX Demo 统一为可交互 UI 原型，也称前端 Demo。按确认范围提供可操作的导航、关键任务、表单与状态反馈，使用明确标识的示例数据并提供重置入口；多角色任务支持切换预览视角。源码输入必须包含 `interactionContract`，浏览器实际执行全部任务并验证操作前后的可见变化；静态截图、自动播放动画和无效按钮不能替代交互验收。详情及字段格式见 `core/runtime/interactive-demo-contract.md`。

默认在聊天正文嵌入可直接使用的 Demo，支持页签、按钮、表单、状态反馈与重置。通过 `chatPreview.fragment` 指定自包含 HTML 片段，编译器从同一片段生成 HTTP 验收页；Router 校验哈希并返回 `presentation.contentReference`，宿主必须在本轮最终回复原样输出。不能用 localhost iframe、截图或链接代替聊天交互。仅宿主缺少能力或已选来源无法兼容片段时，说明具体原因并打开同一 Run 浏览器面板。保留来源锁、响应式要求和后续路线选择，不新增确认。
