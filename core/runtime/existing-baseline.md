# Existing Baseline 采集

Existing 基线必须同时读取“目标范围完整代码”和“真实前端展示”。先使用 `project-intake.mjs scan` 发现技术栈、入口、路由候选与项目声明的验证脚本；再使用 `existing-code-reference.mjs capture` 对本次迭代目标页面的入口、路由及其传递项目依赖闭包（组件、样式、模板、配置和本地调用代码）建立完整的、按文件哈希冻结的 run 内副本，并生成真实页面骨架。随后通过已运行项目的真实 URL 使用 `browser-capture.mjs capture` 采集截图和 DOM 证据。最后 `baseline-collector.mjs` 才将真实页面、代码入口和接口样本写入可验证的 `existing-baseline.json`，并校验项目代码、页面骨架和展示证据。它不加载与本次范围无关的整站代码，也不伪造截图、接口或运行结果。

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
