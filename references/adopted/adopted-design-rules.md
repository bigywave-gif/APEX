# Adopted Design Rules

APEX 采用第三方规范时遵循：

- 外部规范不能直接覆盖 APEX Core
- 必须先提炼为本地采用规则
- 采用后要标明：
  - 来源
  - 采用范围
  - 禁止范围
  - 与其他 skill / 规范的关系

当前采用原则：

- `impeccable`：结构与专业度基线
- `ui-ux-pro-max-skill`：页面级视觉组织
- `taste-skill`：审美强化与去模板化
- `google-design-md`：设计规范表达层与 agent 可读设计约束基线
- `shadcn-ui`：组件语言参考
- `radix-primitives`：可访问交互的候选可执行来源；选中后须安装精确运行时并审计 API 使用
- `lucide`：图标系统真相源
- `react-bits / motion-ai-kit`：动效参考，仅在需要时启用
- `motion`：工程化动效的候选可执行来源；选中后须锁定并验证完整 pattern 与运行时 API
- `storybook`：组件文档化、状态展示与可视化验证参考层
- `axe-core`：无障碍自动检测与质量门参考层
- `better-icons`：图标统一
- `andrej-karpathy-skills`：工程落地纪律

## 生命周期落位

### `google-design-md`

- Site Contract阶段：建立或核对整站设计契约，但不能替代代码与真实展示核对。
- Visual与Bundle编译阶段：作为视觉表达、结构和Token约束基线。
- Implement阶段：约束实现不偏离确认Visual Bundle。
- Proof、Regression与Gate 3阶段：作为设计一致性检查基线。
- Memory阶段：收敛长期设计规则。

硬边界：

- `google-design-md` 不是 APEX 准入规则，不负责决定是否命中 APEX
- `google-design-md` 不是代码真相源，不能覆盖真实产品文档、真实页面结构和真实运行时代码

### `product design` 插件

- 角色定位：`optional-host`
- 作用层级：设计执行增强层，不属于 APEX Core 真相源
- Audit：可辅助做产品、视觉、UX审视与问题归纳。
- Visual：可辅助做视觉提案、样例页和方向探索。
- Implement：只有机器Gate 2通过后才可辅助image-to-code或原型实现。
- Verify：可辅助design QA，但不能替代真实运行态、功能和整站回归。

硬边界：

- 不能参与轨道、范围、授权、准入和代码真相核对裁决
- 不能替代 Gate 语义
- 不能绕过 `google-design-md`、本地 adopted 规则或项目真实代码基线
- 插件不可用时，APEX 必须退回到本地 skill + adopted design rules 正常运行

## 补充 adopted 约束

### 组件语言层

- `shadcn-ui` 负责组件语言与组合语法参考
- `radix-primitives` 负责低层交互原语与可访问性参考
- 二者是互补关系，不是替代关系

### 图标层

- `lucide` 作为默认开源图标真相源
- `better-icons` 继续作为图标选择和统一的执行层辅助能力

### 动效层

- `motion` 作为工程化动效候选来源，选择后必须真实加载并落地
- `react-bits / motion-ai-kit` 仅作为审美/模式决策能力，不能作为任何节点的实现来源
- 动效必须服务于可用性、节奏和反馈，不得默认过度使用

### 组件文档与验证层

- `storybook` 作为优先组件文档化与状态展示参考
- 对不适合使用 Storybook 的宿主项目，允许降级为等价组件清单、状态矩阵和可视化文档

### 无障碍层

- `axe-core` 作为无障碍自动检测参考层
- 自动检测不能替代人工可读性、语义和真实体验评估
