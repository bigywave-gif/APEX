# APEX 当前能力池 Latest / Best 评估

## 文档目的

本文件用于评估 APEX 当前使用的：

- skill
- 工具
- 规范
- 工作流
- 参考网站

是否已经具备足够的“最新（Latest）”与“最优（Best）”参考价值，并明确哪些内容已经足够强、哪些只适合作为灵感来源、哪些仍需要补充。

本文件属于后台更新检查后的评估记录，不直接改变 APEX 已采用规则，也不自动把候选来源写入默认能力池。

## 评估范围

### 当前 skill

- `impeccable`
- `ui-ux-pro-max-skill`
- `taste-skill`
- `better-icons`
- `react-bits`
- `motion-ai-kit`
- `shadcn-ui-reference`
- `andrej-karpathy-skills`

### 当前工具与规范

- `design.md`
- `shadcn-ui`
- 浏览器控制 / 截图 / 页面验证
- APEX 自身工作流、状态机、Gate 与验证链

### 当前参考网站池

- `Landing Love`
- `Landbook`
- `Awwwards`
- `One Page Love`
- `Mobbin`
- `Lapa Ninja`
- `Framer Gallery / Marketplace`
- `Aceternity UI`
- `21st`
- `SiteInspire`

## 评估标准

### Latest 判断

重点看：

- 是否仍持续更新
- 是否仍有维护活跃度
- 是否仍被社区广泛使用
- 是否存在更新、更清晰的官方定位

### Best 判断

重点看：

- 是否真正适合 APEX 的高标准交付目标
- 是否兼顾设计、实现、验证与长期治理
- 是否更适合作为“规范真相源”而不是单纯灵感池
- 是否具有更强的开源长期可用性和迁移稳定性

## 总体结论

当前 APEX 已经具备较强参考性，但尚未达到“最新 + 最优 + 可长期稳定迁移”的满分状态。

更准确的判断是：

- 工作流层：较强
- 规范层：较强
- skill 层：执行力强，但外部可验证性不足
- 工具层：可用，但工程级质量底座仍有缺口
- 参考网站层：灵感足够丰富，但分层还不够硬

## 一、Skill 层评估

### 1. `impeccable`

- Latest：中
- Best：高

判断：

- 作为结构、信息架构、专业度和产品级交付基线，非常有价值
- 但其版本与演进主要依赖宿主环境，不适合作为对外可验证的唯一真相源

结论：

- 继续保留
- 适合作为执行层能力
- 不适合作为开源长期依赖的唯一标准层

### 2. `ui-ux-pro-max-skill`

- Latest：中
- Best：中上

判断：

- 对页面级视觉组织有帮助
- 但同样存在宿主管理、外部不可验证的问题

结论：

- 保留为执行层辅助 skill
- 不上升为唯一规范真相源

### 3. `taste-skill`

- Latest：中
- Best：中上

判断：

- 对“去模板化”和审美强化有帮助
- 适合做视觉增强
- 不适合代替结构与产品逻辑

结论：

- 适合作为视觉增强 skill
- 必须始终排在结构确认之后

### 4. `better-icons`

- Latest：中
- Best：中

判断：

- 对图标一致性有帮助
- 但缺少明确公开、可迁移的图标真相源

结论：

- 当前可保留
- 需要补一个更稳的开源图标底座

### 5. `react-bits`

- Latest：中
- Best：中

判断：

- 动效参考价值存在
- 但在 APEX 当前开源长期使用目标下，许可边界不够理想

结论：

- 保留为参考
- 不适合升格为默认强依赖

### 6. `motion-ai-kit`

- Latest：中
- Best：中上

判断：

- 对动效组织和动效方向有帮助
- 但依然属于宿主型 skill，不是公开可验证的底层实现标准

结论：

- 保留为动效方向增强层
- 仍需补工程化动效底座

### 7. `shadcn-ui-reference`

- Latest：高
- Best：高

判断：

- 当前开源组件语言中仍然非常强
- 适合作为组件语法、视觉语法、可实现性语法的重要基线

结论：

- 保留
- 继续作为开源组件语言主基座

### 8. `andrej-karpathy-skills`

- Latest：中
- Best：中上

判断：

- 对工程约束、最小 diff、验证纪律有正向价值
- 更偏工程风格强化，而不是系统级规范真相源

结论：

- 保留
- 作为实现纪律层能力

## 二、工具层评估

### 当前结论

- 浏览器控制：高价值
- 页面截图：高价值
- 静态校验：高价值
- 运行时验证：高价值

判断：

- 这些能力足以支撑“真实页面验收”
- 但还缺少：
  - 组件文档化底座
  - 自动无障碍检查底座
  - 更明确的视觉回归与组件状态验证底座

## 三、规范层评估

### `design.md`

- Latest：高
- Best：高

判断：

- 它与 APEX 这种 agentic design delivery system 的目标高度匹配
- 适合作为设计规范表达层

结论：

- 保留为核心设计规范参考

### `shadcn-ui`

- Latest：高
- Best：高

判断：

- 当前仍是开源组件语言与工程落地之间的优秀桥梁

结论：

- 保留为组件语法基座

### APEX 自身工作流

- Latest：中上
- Best：高

判断：

- 当前主流程、Gate、验证门、后台更新旁路等逻辑已经比较完整
- 在“结构化执行”上已经具有较强竞争力

结论：

- 主工作流继续保留
- 重点补工程化基座，而不是重写流程

## 四、参考网站层评估

### A 类：高价值灵感池

#### `Landing Love`

- Latest：高
- Best：中上

价值：

- 动效、英雄区、现代感展示效果参考强

边界：

- 更适合作为效果灵感池，不适合作为硬规范

#### `Landbook`

- Latest：高
- Best：中上

价值：

- 高级审美、站点级结构与风格方向参考强

边界：

- 更适合视觉方向，不适合作为工程真相源

#### `One Page Love`

- Latest：中上
- Best：中上

价值：

- 单页结构、精致营销感和轻量高质页面参考强

#### `Lapa Ninja`

- Latest：高
- Best：中上

价值：

- 数量大、类型广，适合作为视觉样式与行业风格参考

#### `SiteInspire`

- Latest：中上
- Best：中上

价值：

- 整站设计感和风格方向参考强

### B 类：高价值产品模式池

#### `Mobbin`

- Latest：高
- Best：高

价值：

- 在 APP 界面参考、交互流、真实产品模式层面价值很高
- 对“体验卓越、功能完善、交互流畅”帮助非常直接

边界：

- 更适合产品模式参考
- 不直接等于视觉规范真相源

### C 类：高价值增强参考，但不应做默认基线

#### `Awwwards`

- Latest：高
- Best：中

价值：

- 创意、品牌表达、先锋视觉语言强

边界：

- 容易把产品做得过于展览化
- 不适合作为默认产品基线

#### `Framer Gallery / Marketplace`

- Latest：高
- Best：中

价值：

- 模板与结构方向参考强

边界：

- 容易产生模板味
- 不应直接作为 APEX 的规范层

#### `Aceternity UI`

- Latest：高
- Best：中

价值：

- 炫酷组件、动效组件参考强

边界：

- 适合增强，不适合默认大盘基线

#### `21st`

- Latest：高
- Best：中上

价值：

- 组件和风格参考丰富，具备工具化潜力

边界：

- 更适合作为候选增强源
- 不适合作为唯一规范真相源

## 五、当前最缺的能力

当前 APEX 最缺的不是“网站数量”，而是更硬的开源工程级底座。

优先建议补充：

1. `Radix Primitives`
2. `Lucide`
3. `Motion`
4. `Storybook`
5. `axe-core`
6. 性能硬门标准源

## 六、候选补充项说明

### `Radix Primitives`

建议作用域：

- 约束增强
- 规范增强

价值：

- 强化可访问性 primitive 层
- 为 `shadcn-ui` 提供更稳的底层逻辑参考

### `Lucide`

建议作用域：

- 专项能力增强
- 规范增强

价值：

- 提供统一图标真相源

### `Motion`

建议作用域：

- 效果增强
- 规范增强

价值：

- 让动效从“灵感参考”升级为“工程实现标准”

### `Storybook`

建议作用域：

- 约束增强
- 规范增强

价值：

- 提供组件文档化
- 提供状态枚举
- 提供更强的视觉回归与组件级验证基础

### `axe-core`

建议作用域：

- 约束增强
- 规范增强

价值：

- 让 APEX 的可访问性 Gate 具备更强自动化支撑

## 七、最终判断

### 已经足够强的部分

- `design.md`
- `shadcn-ui`
- APEX 主工作流
- 浏览器与截图验证能力
- `Mobbin` 作为产品模式参考池

### 有价值但不应当作硬规范真相源的部分

- `Landing Love`
- `Landbook`
- `Lapa Ninja`
- `One Page Love`
- `SiteInspire`
- `Awwwards`
- `Framer Gallery`
- `Aceternity UI`
- `21st`

### 当前需要补充的部分

- 图标真相源
- 工程化动效真相源
- 组件文档化与可视化回归底座
- 无障碍自动检测底座
- 更硬的性能质量门

## 八、建议动作

当前建议先不直接改 adopted 规则，而是进入下一步：

1. 形成 `[APEX][Enhancement-Update]` 候选清单
2. 由用户确认是否纳入
3. 确认后再更新 `sources.yaml`
4. 再更新 `references/adopted/`

## 相关链接

- [continuous-update-policy.md](https://github.com/bigywave-gif/APEX/blob/main/references/external/continuous-update-policy.md)
- [sources.yaml](https://github.com/bigywave-gif/APEX/blob/main/references/external/sources.yaml)
- [adopted-design-rules.md](https://github.com/bigywave-gif/APEX/blob/main/references/adopted/adopted-design-rules.md)
