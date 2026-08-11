# Source Review Records

## 目的

记录已经完成 latest / best 双维评审、且已被用户确认纳入 APEX 增强层的来源。

这些记录用于说明：

- 为什么纳入
- 纳入到哪一层
- 哪些内容可采用
- 哪些内容不能直接继承

## 2026-07 增强层纳入记录

### 来源名称

- `Radix Primitives`

### 来源类型

- accessibility-primitive-library

### 官方入口

- [Radix Primitives](https://github.com/radix-ui/primitives)

### 当前版本 / 状态

- `upstream-current`

### Latest 判断

- 最近是否仍有维护：是
- 最近更新时间：当前仓库持续活跃，GitHub 页面显示 `1,783 commits`
- 是否属于活跃状态：是

### Best 判断

- 是否优于当前已采用来源：是，补足了 `shadcn-ui` 之下的可访问性原语参考层
- 主要优势：
  - 开源
  - 低层原语清晰
  - 强可访问性取向
  - 适合作为 design system base layer
- 主要风险：
  - 不应误解为要求所有宿主项目强制改写为 Radix

### 许可状态

- MIT

### 是否允许进入 APEX

- 是

### 可采用内容

- 可访问性原语思路
- 组件交互约束参考
- 与 `shadcn-ui` 配套的底层设计原则

### 不可直接继承内容

- 宿主项目的强制框架改写要求

### 本地 adopted 落点

- `apex/references/adopted/adopted-design-rules.md`

### 是否提示用户更新

- 是
- 提示原因：补足组件原语与可访问性底座

---

### 来源名称

- `Lucide`

### 来源类型

- icon-system-library

### 官方入口

- [Lucide](https://github.com/lucide-icons/lucide)

### 当前版本 / 状态

- `upstream-current`

### Latest 判断

- 最近是否仍有维护：是
- 最近更新时间：当前仓库持续活跃，GitHub 页面显示 `2,720 commits`
- 是否属于活跃状态：是

### Best 判断

- 是否优于当前已采用来源：是，补足了 `better-icons` 缺少的公开图标真相源
- 主要优势：
  - 开源
  - 图标数量多
  - 官方多框架包齐全
  - 易迁移
- 主要风险：
  - 需要在 APEX 中补齐尺寸、线宽、命名和使用场景规则

### 许可状态

- ISC

### 是否允许进入 APEX

- 是

### 可采用内容

- 图标命名体系参考
- 图标库选型参考
- 多框架图标分发思路

### 不可直接继承内容

- 任意混用图标风格

### 本地 adopted 落点

- `apex/references/adopted/adopted-design-rules.md`

### 是否提示用户更新

- 是
- 提示原因：提供统一图标系统底座

---

### 来源名称

- `Motion`

### 来源类型

- motion-library

### 官方入口

- [Motion](https://github.com/motiondivision/motion)

### 当前版本 / 状态

- `upstream-current`

### Latest 判断

- 最近是否仍有维护：是
- 最近更新时间：当前仓库持续活跃，GitHub 页面显示 `7,772 commits`
- 是否属于活跃状态：是

### Best 判断

- 是否优于当前已采用来源：是，补足动效工程化底座
- 主要优势：
  - 开源
  - 明确覆盖 React / JavaScript / Vue
  - 官方强调生产可用、测试完善和高性能动画
- 主要风险：
  - 需要限制使用边界，防止过度动效

### 许可状态

- MIT

### 是否允许进入 APEX

- 是

### 可采用内容

- 动效工程实现参考
- 动效性能与生产可用原则
- 统一动效语言约束

### 不可直接继承内容

- 以炫技为导向的全局默认动效

### 本地 adopted 落点

- `apex/references/adopted/adopted-design-rules.md`

### 是否提示用户更新

- 是
- 提示原因：动效从灵感池升级为工程底座

---

### 来源名称

- `Storybook`

### 来源类型

- component-workshop

### 官方入口

- [Storybook](https://github.com/storybookjs/storybook)

### 当前版本 / 状态

- `upstream-current`

### Latest 判断

- 最近是否仍有维护：是
- 最近更新时间：当前仓库持续活跃
- 是否属于活跃状态：是

### Best 判断

- 是否优于当前已采用来源：是，补足组件文档化与组件级验证底座
- 主要优势：
  - 行业标准
  - 组件隔离展示
  - 支持开发、测试、文档化
- 主要风险：
  - 对非组件框架项目需要定义降级或替代方式

### 许可状态

- MIT

### 是否允许进入 APEX

- 是

### 可采用内容

- 组件状态展示
- 组件文档化思路
- UI 组件验证与演示机制

### 不可直接继承内容

- 把 Storybook 当成所有项目都必须强依赖的前置运行时

### 本地 adopted 落点

- `apex/references/adopted/adopted-design-rules.md`

### 是否提示用户更新

- 是
- 提示原因：补齐组件文档化与可视化验证底座

---

### 来源名称

- `axe-core`

### 来源类型

- accessibility-test-engine

### 官方入口

- [axe-core](https://github.com/dequelabs/axe-core)

### 当前版本 / 状态

- `upstream-current`

### Latest 判断

- 最近是否仍有维护：是
- 最近更新时间：当前仓库持续活跃，GitHub 页面显示 `5,465 commits`
- 是否属于活跃状态：是

### Best 判断

- 是否优于当前已采用来源：是，补足无障碍自动检测底座
- 主要优势：
  - 开源
  - 可集成到现有测试环境
  - 直接服务于无障碍质量门
- 主要风险：
  - 不能替代人工体验与语义审查

### 许可状态

- MPL-2.0

### 是否允许进入 APEX

- 是

### 可采用内容

- 无障碍自动检测基线
- 与测试环境集成的质量门思路

### 不可直接继承内容

- 将自动检测结果误解为完整无障碍评审

### 本地 adopted 落点

- `apex/references/adopted/adopted-design-rules.md`

### 是否提示用户更新

- 是
- 提示原因：补齐无障碍 Gate 自动检测底座
