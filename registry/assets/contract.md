# APEX 在线素材能力契约

## 目的

APEX 不把第三方素材复制进本地包，而是维护可审计、可替换、可由 skill / MCP / API / 包管理器 / 官方 CDN 调用的在线能力注册表。本契约保证 Stitch、其他视觉生成器与 Implement 消费同一素材身份和参数，而不是分别寻找“相似素材”。

## 基本原则

1. 在线优先：素材文件不作为 APEX Core 的长期副本。
2. 身份稳定：效果图和代码必须引用相同 `source + resourceId + version`。
3. 参数完整：颜色、尺寸、线宽、变体、布局、数据和动效参数不能只存在于截图。
4. 来源可审计：记录官方入口、许可证、调用方式、认证要求和使用限制。
5. 运行时适配：在线来源不能改变目标项目的真实技术栈；React-only 资源进入 Vanilla 项目时必须翻译或换用兼容来源。
6. 不静默替换：资源失效时走注册 fallback 并重新通过 Gate 2 / Gate 3 对比。
7. 不设全局强制库：注册表提供候选能力画像，不规定所有项目必须使用某个图标、组件、表格、图表或动效库。
8. 情境最优：每次根据目标页面和真实运行时重新选择，选择理由必须可解释、可复核。

## Visual Bundle 引用格式

```yaml
assetRef:
  kind: icon | component | table | chart | diagram | motion | photo | illustration | font | avatar | map | three_d
  source: lucide
  resourceId: triangle-alert
  version: upstream-current-at-lock
  resolver: npm | esm | rest-api | mcp | official-cdn | skill | manual-official
  parameters:
    size: 20
    strokeWidth: 1.75
    colorToken: status-warning
  runtimeTarget: vanilla-js
  licenseSnapshot: ISC
  fallback:
    source: phosphor
    resourceId: warning
```

`upstream-current-at-lock` 只允许用于 Visual 阶段探索；Gate 2 确认时必须把实际解析到的包版本、API 版本或资源修订写入 Bundle lock。

## 素材选择模型

候选来源不设置固定总排名。每次至少评估：

- 视觉匹配：是否符合已确认的图标语法、组件语言、图表表达和动效节奏
- 功能覆盖：是否覆盖目标状态、交互、数据规模和响应式要求
- 运行时适配：能否自然接入 Vanilla / React / Vue 等真实运行时
- 可访问性：键盘、语义、焦点、屏幕阅读器和 reduced-motion 支持
- 性能：包体、渲染器、资源加载、动画成本和大数据表现
- 可维护性：官方维护状态、版本稳定性、文档和迁移成本
- 许可与治理：许可证、API 条款、归属、商用和数据传输边界
- 可调用性：当前宿主是否有对应 skill、MCP、API、CLI 或包解析能力
- 设计到代码保真度：能否把资源 ID、参数和行为无损传给 Implement

选择结果必须记录 `candidatesConsidered`、`selectedBecause`、`rejectedBecause` 和 `selectionDate`。不允许因为某库在注册表中排在前面就自动采用。

候选池采用开放扩展模型，不是封闭白名单。若当前注册来源无法满足任务，必须继续从官方来源检索、完成许可证与依赖评估、增量登记后再选择；不得因为注册表暂时缺项而退化为随意生成或相似替代。

## 依赖完整性契约

每个进入 Gate 2 的 `assetRef` 必须同时生成 `dependencyLock`：

```yaml
dependencyLock:
  resolver: npm | esm | rest-api | mcp | official-cdn | skill | manual-official
  packageOrService: apache-echarts
  resolvedVersion: 6.x.y
  entrypoint: echarts/core
  requiredModules: [LineChart, GridComponent, TooltipComponent, SVGRenderer]
  peerDependencies: []
  styleDependencies: []
  runtimeRequirements: [browser-es2020]
  credentials: none
  networkPolicy: build-time-or-runtime
  license: Apache-2.0
  integrityOrRevision: recorded-at-resolution
  fallbackCompatibility: explicit
```

依赖完整不仅是写出包名，还必须包括：

- 已解析版本或 API 版本
- 实际入口、按需模块和 peer dependencies
- CSS、字体、图片、worker、WASM 等附属资源
- 认证、额度、归属、热链和网络策略
- 浏览器 / Node / 框架版本要求
- tree-shaking、renderer、插件和 adapter
- 许可证与条款快照
- 离线、限流、来源不可达时的显式回退兼容性

依赖解析不完整时阻止 Gate 2，但不因此强制改选某个固定库；应继续评估其他候选。

## 类别最低字段

### 图标

- icon family、资源名、outline / fill / weight
- viewBox、尺寸、线宽、颜色 token、无障碍标签
- 禁止使用 Unicode 字符代替已确认 SVG 图标

### 组件和表格

- registry item / component ID、框架、依赖、状态清单
- 列定义、排序、筛选、选择、分页、空态、加载态和响应式规则
- React 组件不得直接进入 Vanilla 运行时

### 图表和图示

- 库、图表类型、结构化 option / spec、数据 schema
- 轴、图例、tooltip、颜色通道、空态、尺寸、renderer
- 效果图中的示例数据必须与产品真实数据契约分离

### 动效

- target、trigger、duration、delay、easing、properties、interrupt behavior
- reduced-motion 行为、性能预算、React / Vanilla 实现路径
- 静态截图不能作为唯一动效定义

### 图片和插画

- 官方资源 ID、作者 / 归属、原始页面、下载 URL 使用规则、裁切焦点
- 不得把搜索结果页、临时签名 URL 或无许可图片作为稳定引用
- 涉及人物、学生或教育场景时必须检查隐私、肖像与合成内容风险

### 字体

- family、具体字重、style、subset、加载方式、fallback stack
- 禁止只写字体名称而不锁定实际字重和加载来源

### 头像、地图和 3D

- 头像必须锁定生成器版本、风格、seed、参数和具体风格许可证
- 地图渲染库、瓦片服务、地理数据和归属是四个独立依赖，不能只记录地图组件
- 3D 必须同时锁定引擎、loader、模型、纹理、环境贴图、许可证和 WebGL 性能预算

## Resolver 优先级

1. 已安装且经过认证的专用 MCP
2. 官方 API / 官方 registry
3. 官方 npm / ESM 包
4. 官方 CDN
5. 官方站点人工选择
6. 仅作灵感参考的 gallery（不得成为 Implement 依赖）

## Gate 规则

- Gate 2：所有视觉关键素材都有可解析 `assetRef`、完整 `dependencyLock` 和当次选择记录，并生成 Bundle lock。
- Implement：只能按 Bundle lock 解析，不得重新选型。
- Gate 3：核对资源身份、参数、实际渲染、响应式和交互；在线来源不可达时不得用占位素材假装通过。
