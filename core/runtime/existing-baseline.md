# Existing Baseline 采集

Existing 基线必须同时读取“目标范围完整代码”和“真实前端展示”。先使用 `project-intake.mjs scan` 发现技术栈、入口、路由候选与项目声明的验证脚本；再使用 `existing-code-reference.mjs capture` 对本次迭代目标页面的入口、路由及其传递项目依赖闭包（组件、样式、模板、配置和本地调用代码）建立完整的、按文件哈希冻结的 run 内副本，并生成真实页面骨架。随后通过已运行项目的真实 URL 使用 `browser-capture.mjs capture` 采集截图和 DOM 证据。最后 `baseline-collector.mjs` 才将真实页面、代码入口和接口样本写入可验证的 `existing-baseline.json`，并校验项目代码、页面骨架和展示证据。它不加载与本次范围无关的整站代码，也不伪造截图、接口或运行结果。

扫描默认限制为 12000 个源文件、80 个入口和 160 个路由候选。`scanCoverage` 分别记录计数、限制及是否截断；源文件截断时，入口和路由计数仅为已扫描部分的下界。出现截断时宿主按 Router 指令以新授权调用 `project-intake.mjs expand <run-dir> <project-root>`，脚本将截断项限制加倍并重扫，直至完整。各限制最高为 1000000，达到上限仍截断则保留未验证状态，不能通过 Gate 1。选项 JSON 只接受 `maxSourceFiles`、`maxEntrypoints`、`maxRoutes`，作为 scan 命令最后一个参数传入，不新增用户确认。历史清单未记录此字段时维持原协议，不能据此宣称历史扫描完整。

发现阶段排除 `.worktrees` 和具有 `pyvenv.cfg` 标记的 Python 虚拟环境，并在清单的 `ignoredPaths` 中记录；`complete` 仅表示这些排除规则以内的扫描没有截断，不证明被排除内容已纳入项目。明确位于其他 worktree 的任务应以该 worktree 自身作为项目根目录。

目标代码引用解析相对静态导入、根 `tsconfig.json` 中声明的简单路径别名、常见 `.js` 到 TypeScript 源文件的映射、根 package 声明的单层 workspace 导出，以及根目录或 `public` 中的 HTML 脚本和样式；相关配置文件纳入冻结，变更时重建缓存。该静态解析不证明任意动态导入、嵌套配置继承、所有构建器别名或非常规 workspace 导出已覆盖；产品和前端角色须结合实际构建配置及运行页面核对，发现缺口时扩大目标引用并重采，不能仅凭 `complete` 宣称所有依赖均已验证。

HTML 和 CSS 中可静态定位的本地图片、媒体、字体等资源也纳入快照；根路径按目标入口所属应用及项目的 `public` 目录寻找。无法在本地定位的资源写入 `unresolvedResources`，可能是运行时资源或缺失文件，须结合实际页面核查，不能视为已验证；候选文件之后出现时 Router、浏览器基线采集和 Gate 校验会识别快照失效并要求重采，不能复用旧索引。Gate 2 后仅已获批准的实施目标按既有变更闭包处理。

新冻结的 Existing 基线在 `codeReference.resourceCoverage` 显示未定位数量及 `unverified`、`no-unresolved-detected` 或历史数据 `not-recorded`。Router 和 Gate 校验该状态与源码清单一致；`no-unresolved-detected` 只表示静态扫描未发现待核查项，不证明视觉素材均已加载或正确。产品、设计和前端角色应读取引用清单并针对本次范围核查，状态本身不增加用户确认。

这两个脚本均只能使用 `collect_existing_baseline` 授权，经 Action Gateway 运行：

```text
node scripts/apex-router.mjs authorize <project-root> <run-id> <session-id> collect_existing_baseline
node scripts/apex-action.mjs run <project-root> <run-id> <session-id> <authorization-ref> collect_existing_baseline project-intake.mjs scan <run-dir> <project-root>
node scripts/apex-action.mjs run <project-root> <run-id> <session-id> <new-authorization-ref> collect_existing_baseline existing-code-reference.mjs capture <run-dir> <project-root> <baseline-input.json>
node scripts/apex-action.mjs run <project-root> <run-id> <session-id> <new-authorization-ref> collect_existing_baseline browser-capture.mjs capture <run-dir> <running-base-url> <browser-spec.json>
node scripts/apex-action.mjs run <project-root> <run-id> <session-id> <new-authorization-ref> collect_existing_baseline baseline-collector.mjs capture <run-dir> <baseline-input.json> [project-root]
```

每个会修改 run state 的调用都会使前一授权失效，因此每一步必须重新取得授权。完整快照存放在 `<run-dir>/code-reference/files/`，页面骨架存放在 `page-skeleton.json`；效果图的每个布局节点必须映射到真实骨架节点，并同时绑定二者哈希。源代码变更、快照不完整、骨架映射不全或视觉输入未绑定哈希时，不得生成正式效果图。

在 Gate 1 前，APEX 还必须基于客户需求和上述三类真实来源生成 `experience-strategy.json`：场景、主要用户、目标、信息架构、数据表达、前端功能拆解、视觉方向与反模式，并绑定代码树、骨架和展示证据哈希。任一引用或策略绑定缺失，Gate 1 无法通过，因而不得生成正式效果图。
