# 插件与宿主能力清单

## 目的

记录 APEX 运行时可能依赖的插件、宿主工具和增强能力，并标注它们在“开源长期可用”目标下的角色。

## 分类原则

- `required-core`：没有它就无法执行 APEX 主流程
- `optional-host`：宿主增强能力，没有它仍可降级运行
- `release-blocked`：当前不可作为开源长期依赖对外承诺

## 当前能力清单

### 代码读取 / 编辑

- 类型：宿主基础能力
- 角色：`required-core`
- 说明：APEX 必须具备

### 文档读取

- 类型：宿主基础能力
- 角色：`required-core`
- 说明：APEX 必须具备

### 本地命令执行

- 类型：宿主基础能力
- 角色：`required-core`
- 说明：用于代码检查、重启与验证

### 浏览器控制

- 类型：插件 / 宿主增强
- 角色：`optional-host`
- 说明：有助于真实页面验收，但缺失时可降级

### 截图

- 类型：插件 / 宿主增强
- 角色：`optional-host`
- 说明：有助于视觉对照与验收

### 外部搜索

- 类型：插件 / 宿主增强
- 角色：`optional-host`
- 说明：用于补充官方规范和参考来源

### 图像生成

- 类型：插件 / 宿主增强
- 角色：`optional-host`
- 说明：仅在视觉方向、样例页或图像参考阶段启用

### Product Design 插件

- 类型：插件 / 宿主增强
- 角色：`optional-host`
- 说明：用于设计 brief 澄清、视觉方向探索、样例页构思、image-to-code / design QA 等设计执行增强；不能替代 APEX Core 的准入、Gate 与真实验收

### 组件文档化 / 状态展示

- 类型：开源工具 / 宿主增强
- 角色：`optional-host`
- 说明：优先参考 Storybook；没有它时必须提供等价组件状态清单或可视化文档

### 无障碍自动检测

- 类型：开源工具 / 宿主增强
- 角色：`optional-host`
- 说明：优先参考 axe-core；没有它时必须明确缺口并补人工检查

## 发布边界

若目标是“开源长期可用 APEX 包”，则：

- `required-core` 必须可在通用宿主中替代实现
- `optional-host` 不能写成硬依赖
- 所有插件能力都必须有降级说明

其中：

- `Product Design` 插件缺失时，必须退回 `google-design-md` + `impeccable` + `ui-ux-pro-max-skill` + `taste-skill` + 本地 adopted 规则继续执行

## 当前判定

- APEX 当前已经具备把插件能力降级为宿主增强的规则
- 但插件能力本身的开源可迁移性，仍依赖具体宿主环境
- 因此，插件能力当前不能被当成 APEX 对外发布时的长期开源硬承诺
