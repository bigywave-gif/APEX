# APEX 受控专业角色链治理

## 状态与边界

本文件记录 APEX 对 `agency-agents` 的受控集成规范和验收基线。Core 已提供角色注册表、结构化 advisory Schema、受 Router action 授权的记录器，以及 Gate/验证的就绪校验；现有四个 Gate、Demo 路线选择和正式代码授权不变。

APEX 只吸收 `agency-agents` 的专业职责、交接格式和证据优先理念；不导入其自由 Agent 派生、独立流程控制、角色级用户确认、任务级 Dev↔QA 循环或自动重试。Router 继续是项目 Run、状态、动作授权、Gate 与正式代码变更的唯一裁决者。

上游参考：<https://github.com/msitarzewski/agency-agents>（MIT；当前固定 commit `3c9588880b7cafaec325a104899fd8bbe27e7d72`，适配版本由 `registry/agency-role-registry.json` 管理）。

## 固定确认模型

角色完成后自动交接。用户只在 Router 既有阀门查看汇总结果并确认：

1. `确认需求与交付方案`
2. `确认视觉方案`
3. `确认 Stitch 内容`（仅选择 Stitch 路线时）
4. `确认实施冻结`

Runtime Demo 是视觉方案确认后的自动产物。展示 Demo 后仅要求用户选择“继续执行流程（进入 Stitch）”或“直接代码”；它不是新的确认 Gate。任何角色不得显示“继续”、泛化“确认”、轮询、角色级按钮或自行结束自动链。

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
| 10 | Frontend Implementation Planner | 实施冻结 | Demo、来源锁、代码闭包 | Implementation Map、数据绑定、最小依赖物化计划 | Code Reviewer |
| 11 | Code Reviewer | 实施冻结 | 实施映射、保护补集、依赖清单 | 越界、性能、维护性、安全和回归审查 | Implementation Compiler |
| 12 | Frontend Developer | Gate 2 后 | 批准映射、mutation lease | 仅范围内的正式代码与 `page-delta` | Evidence Collector |
| 13 | Evidence Collector | Gate 3 | 真实运行页面、验证计划 | 截图、DOM、交互 trace、状态矩阵、性能原始证据 | Reality Checker |
| 14 | Reality Checker | Gate 3 | 原始证据、冻结方案、实现差异 | `passed` / `failed` / `unverified` 的事实核验 | Gate 3 Validator |

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
- 角色超时、输入失效、输出无效时的降级与恢复不增加确认、不产生假完成。

角色质量档案必须记录评测 fixture、通过状态、已知限制和失效条件。未通过评测的角色不得进入默认角色链。

## 效率、失败与发布

- 默认每阶段最多启用 3 个角色；仅相互独立的专项角色可受控并行，最大并发为 2。
- advisory 以输入工件 SHA-256 作为缓存键；未变化的上游工件只复用当前 Run 内的结果，不跨项目或跨 session 污染。
- 增强角色失败时记录 operation receipt 并由 APEX 既有能力降级完成；若缺失的结论是来源、数据、安全或验收成立的必要条件，则仅在完成实际尝试后输出一次可观察的阻断报告。
- 不得因角色失败而输出“继续”、让用户修复内部 JSON、反复扫描、自动批准或静默中断。
- 发布采用影子 advisory → Gate 1/Visual 可见摘要 → 实施冻结/Gate 3 审查的分阶段启用。关闭角色适配后必须完全回退至现有 APEX 功能、四个 Gate 和使用方式。
