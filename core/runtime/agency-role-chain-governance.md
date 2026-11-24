# APEX 受控专业角色链治理

## 状态与边界

本文件记录 APEX 对 `agency-agents` 的受控集成规范和验收基线。Core 已提供角色注册表、结构化 advisory Schema、受 Router action 授权的记录器，以及 Gate/验证的就绪校验；具体确认流程由 Router 依据 Run 的确认模型裁决。

APEX 只吸收 `agency-agents` 的专业职责、交接格式和证据优先理念；不导入其自由 Agent 派生、独立流程控制、角色级用户确认、任务级 Dev↔QA 循环或自动重试。Router 继续是项目 Run、状态、动作授权、Gate 与正式代码变更的唯一裁决者。

上游参考：<https://github.com/msitarzewski/agency-agents>（MIT；当前固定 commit `3c9588880b7cafaec325a104899fd8bbe27e7d72`，适配版本由 `registry/agency-role-registry.json` 管理）。

## 用户确认与兼容模型

新 Run 的 `two-confirmations` 模型：产品角色先形成方案，设计师据此形成视觉方案；用户确认视觉改造方案后，自动生成并展示可交互 Demo。用户明确确认 Demo 后，再选择进入 Stitch 或直接落地前端代码。选择 Stitch 时，已确认 Demo 是基线，超出基线的变化须由用户决定；内部来源锁、机器 Gate 和实现准备不另设默认用户确认。产品、设计、前端在最终验收中分别核对功能、设计和实际运行行为。

旧 Run 的 `gate-summary-only` 模型保留其既有的需求与交付方案、视觉方案、按需 Stitch 内容和实施冻结确认，按原 Run 状态和 Router 的决定继续，不把旧确认套用于新 Run。无论模型如何，角色只提供专业判断和证据；Router 负责阶段、授权及用户交互。不得以泛化“继续”、进度轮询或角色级按钮代替明确决策。

## 角色链

| 顺序 | 角色 | 阶段 | 输入 | 必须产出 | 下游 |
|---|---|---|---|---|---|
| 1 | Codebase Onboarding Engineer | Existing 基线 | 正式代码、入口、依赖 | 页面/路由/组件/数据事实包 | Existing Baseline Analyst |
| 2 | Existing Baseline Analyst（APEX） | Existing 基线 | DOM、截图、样式源、代码引用 | Existing Baseline、styleBaseline、页面骨架、保护补集 | Minimal Change Engineer |
| 3 | Minimal Change Engineer | Gate 1 | 用户目标、真实基线 | `change-scope` 与未改动保护补集 | Product Manager |
| 4 | Product Manager | Gate 1 | 需求、项目事实、数据/API 契约 | 用户、场景、任务、成功标准、功能边界 | Senior Project Manager |
| 5 | Senior Project Manager | Gate 1 | 产品定义、范围、技术约束 | 交付、验收、风险、依赖、不包含项 | Gate 1 Compiler |
| 6 | UX Architect | Visual | 已确认 Gate 1、DESIGN.md、基线 | 信息架构、任务流、响应式、无障碍、组件职责 | UI Designer |
| 7 | UI Designer | Visual | UX 架构、真实候选与规范 | 布局、层级、Token、组件状态、候选比较 | 专项审查 |
| 8 | Data Visualization Engineer（按需） | Visual | 数据模型、用户问题、图表候选 | 问题→指标→编码→图表→交互→来源→回退 | Brand / Visual Compiler |
| 9 | Brand Guardian + UI Finish-Gate Reviewer（按需） | Visual | 视觉候选、styleBaseline、品牌规则 | 整体性、品牌、密度、反模板审查 | Visual Compiler |
| 10 | Backend Architect（按需） | Gate 1 | 产品范围、领域/API/权限约束 | 领域、API、失败与数据完整性风险 | Gate 1 Compiler |
| 11 | Frontend Implementation Planner | 实施冻结 | Demo、来源锁、代码闭包 | Implementation Map、数据绑定、最小依赖物化计划 | Code Reviewer |
| 12 | Frontend Engineer | 实施冻结 | 批准映射、状态/响应式合同 | 正式前端任务可执行性与风险 | Gate 2 实施 |
| 13 | Code Reviewer | 实施冻结 | 实施映射、保护补集、依赖清单 | 越界、性能、维护性、安全和回归审查 | Implementation Compiler |
| 14 | QA Test Engineer | Gate 3 | 交付契约、验证计划、负向状态 | 功能、契约、回归与覆盖缺口裁决 | Evidence Collector |
| 15 | Evidence Collector | Gate 3 | 真实运行页面、验证计划 | 截图、DOM、交互 trace、状态矩阵、性能原始证据 | Reality Checker |
| 16 | Reality Checker | Gate 3 | 原始证据、冻结方案、实现差异 | `passed` / `failed` / `unverified` 的事实核验 | Gate 3 Validator |

条件角色仅在需求匹配时启用：Motion Specialist（动效/3D）、Accessibility Auditor（无障碍）、API/Backend Architect（契约或权限）、Performance Benchmarker（性能敏感）、Internationalization Engineer（多语言/RTL）。未满足适用条件时必须记录“不适用”及原因，禁止编造结论。

## 专业度合同

专业度不得以角色名称、模型自述或主观评分代替。每个角色适配器必须声明：

- 能力边界、触发条件、允许读取的工件和禁止行为；
- 对应的项目事实、设计契约和权威标准；
- 结构化输入、结构化输出、必填字段、输出哈希与下游消费者；
- 备选、取舍、风险、验收条件与置信度；
- `fact`、`inference`、`unverified` 的明确区分；
- 版本、上游 commit、文件哈希、许可证、适配版本与评测版本。

视觉、图表、动效和前端角色必须继续服从 `experience-strategy-contract.md`、`DESIGN.md`、Existing `styleBaseline` / Greenfield Token、Visual Source Manifest、Motion Contract、Implementation Map 和 Gate 2/3。无障碍以 WCAG 2.2 为最低可验证标准：<https://www.w3.org/TR/WCAG22/>。

## 受控执行与交接

角色适配器只能读取当前 Run 的最小上下文：`context-index.json`、当前阶段工件、已确认契约、变更闭包及其必要依赖。输出仅写入：

`<project-root>/.apex/runs/<run-id>/advisories/<stage>/<role>.json`

角色不得：调用 Router、修改 `state.json`、创建子 Run、启动任意 Agent、安装依赖、修改正式代码、批准/跳过 Gate 或请求额外确认。角色建议由 APEX 受控合成器写入既有 Gate 1、视觉方案、实施冻结或验证工件。

决策优先级固定为：用户明确要求 → 已确认 Gate 工件 → Existing 真实基线 / DESIGN.md → APEX 硬约束与真实来源 → 角色建议。角色建议若改变已确认内容，必须走既有 `revise` 解锁最早受影响 Gate，自动重建并回到该 Gate 的精确确认标签。

## 完整用户可读输出

Gate 1 的八节方案与视觉阶段的十节方案必须完整呈现，不能以角色文件列表、原始 JSON 或一句摘要替代。角色产物通过“角色决策摘要”纳入对应章节，并说明：

- 哪个角色基于哪些事实提出了什么结论；
- 结论是否被采纳；
- 采纳或拒绝的原因；
- 对应方案、来源选择、实现目标和验收条件。

视觉方案的每个决策必须说明最终选择、候选取舍、真实来源/版本/参数、页面节点、响应式、无障碍、动效和落地方式。Existing 任务逐项说明“现状问题、改什么、为什么改、最终选什么、解决什么”；Greenfield 说明“最终选什么、基于什么选择”。

## 评测与质量门槛

角色适配器在默认启用前、角色版本变化后和 APEX 发布前必须通过 fixture 评测。评测至少覆盖：

- Existing 局部调整不越出 `change-scope` 或保护补集；
- 图表回答真实用户问题，编码、数据、交互与库来源一致；
- 动效服务明确功能状态变化，支持 reduced-motion，无无意义循环；
- 视觉 Token、组件、图标、图表和动效与真实来源锁一致；
- 实施映射不越界，Demo、Visual Bundle 和正式代码可追溯到同源资源；
- Evidence Collector / Reality Checker 只能根据原始浏览器、DOM、交互和性能证据下结论；无证据必须是 `unverified`；
- 角色超时、输入失效、输出无效时必须留下受控操作失败回执；已选角色不得用 `unverified` advisory 替代，恢复后从同一受控步骤继续，不增加确认也不产生假完成。

角色质量档案必须记录评测 fixture、通过状态、已知限制和失效条件。未通过评测的角色不得进入默认角色链。

## 效率、失败与发布

- 每阶段的全部核心角色与命中触发条件的专项角色都必须入队；不得以角色数上限静默省略专业审查。仅相互独立的 Job 可受控并行，最大并发为 2。
- 每次视觉阶段必须向 UI Designer 实际提供当前安装的 `taste-skill` 内容；Job 绑定路径与内容哈希，领取时加载并输出内容，advisory 记录采用的规则及不适用规则，不能将登记或绑定本身视为设计质量证明。 两次确认模型下，视觉方案的 `designCapabilities` 必须列出 `taste-skill` 及设计师实际采用的专项 Skill；未加载或被判定不适用的 Skill 不得列为已采用。该声明与已完成的设计师 Job、advisory 哈希、当前尝试及成功的受控 Skill 加载回执核对；按需引用的其他 Skill 同样验证对应尝试、租约、内容哈希和回执。回执证明内容已返回角色，不证明模型实际理解或审美达标；仍须由设计师审查并由用户确认 Demo。 设计师可发现已安装且元数据表明适用于视觉、界面或品牌设计的其他本地 Skill；发现只读取前 8 KiB 元数据并提供有限的描述，不算加载；动态来源限 1 MiB，超限、重名冲突、缺少有效元数据或不可读取的 Skill 不自动提供；Stitch 专用技能仍仅在用户选择 Stitch 后处理。实际采用须经当前任务受控加载、哈希与回执验证，并映射到设计决策。 已成功加载的可选 Skill 后续不再安装时，历史回执仍可证明该次加载；不能据此在新的角色尝试中声称重新加载。
- 每个选中角色必须生成独立 Agent、持久 Job、输入哈希、Token 用量和 trace span；Job 仅在 advisory 通过 Schema 与输入绑定后成功。进程中断的运行中 Job 会受控回队，达到最大尝试次数则进入死信队列。
- advisory 以输入工件 SHA-256 作为缓存键；未变化的上游工件只复用当前 Run 内的结果，不跨项目或跨 session 污染。
- 已选角色失败时记录 operation receipt 并在当前 Gate 阻断；只有未被当前阶段选择的条件角色才是“不适用”，而不是降级成功。恢复只能在输入、环境证据或状态实际改变后进行。
- 角色输入变更后需要重建阶段时，先检查旧 Job：存在运行中 Job 时等待其结束；租约确已过期时按受控恢复处理，不能仅凭本地退出推断外部执行结束。没有运行中 Job 后，以同一数据库事务阻止旧排队 Job 再被领取，保留已完成与失败记录，再归档旧选择并创建新 Job。重试须保持幂等，不能静默遗留可执行的旧 Job。
- 同一 Agent 存在排队或运行中的 Job 时，只允许幂等重用完全相同的注册信息，不得切换阶段、能力版本或会话上下文；排队 Job 已受控失效且没有其他未完成 Job 后，才可重新注册。
- 新 Job 的阶段必须与当前 Agent 注册阶段一致；历史排队 Job 若阶段与当前注册不一致，不能领取，须保留记录并按受控角色修复处理。已在运行的历史 Job 仍按现有租约与完成协议处理，不能凭阶段不一致推断其已停止。
- 不得因角色失败而输出“继续”、让用户修复内部 JSON、反复扫描、自动批准或静默中断。
- 角色结果须经受控 advisory、阶段摘要与 Gate 验证；兼容和回退行为按当前 Run 的确认模型、Router 状态及实际测试证据判断，不得跳过用户已确认的基线。


两次确认模型的视觉方案必须引用当前 Run 或项目内真实设计规范文件及其 SHA-256。编译、用户确认、视觉来源冻结和 Gate 2 会检查内容；确认后发生变化时，原方案不可继续生成 Demo 或授权实施。路径指向多个不同文件或越出当前项目时不得通过。
