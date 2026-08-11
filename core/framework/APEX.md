# APEX 当前核心框架（以 manifest.version 为准）

APEX（Agentic Product EXperience）是一套面向真实产品的设计、实现与验证交付系统。它不把效果图、生成代码或单次对话当成最终真相，而是协调四类真相源：项目代码与接口、Site Contract、用户确认后的最新视觉画布、真实浏览器运行结果。

## 目标

- 新项目从产品定义、架构、设计系统、代表页证明到页面族扩展。
- 已有项目允许按确认效果图完整重构单页，同时保护功能和整站规范。
- Visual 阶段与 Implement 阶段消费同一素材身份、设计参数和版本冻结。
- Gate 由结构化产物和校验器执行，不只依赖文字提醒。
- 任务中断后按Checkpoint增量恢复，减少重复上下文和输出。

## 系统结构

1. Intake与轨道分流
2. 项目事实与基线
3. Site Contract与Functional Freeze
4. Visual与Stitch可编辑画布
5. Sync and Freeze与Visual Bundle编译
6. 可执行Gate与受控实现
7. Proof、整站回归与真实验收
8. Checkpoint、Context Compiler与经验沉淀

## 执行维度

- 轨道：`greenfield` / `existing`
- 范围：`lite` / `standard` / `full`
- 授权：`interactive` / `autonomous`

三者独立组合。详见 `state-machine.md`、`tracks.md`、`authorization.md`。

## 权威层级

1. 产品安全、权限、数据和功能事实。
2. Site Contract整站共同语言。
3. 页面族契约。
4. 用户确认并冻结的页面Visual Bundle。
5. 显式、限域、可审计的页面Override。

确认后的页面效果图可以拥有完整页面重构权，但不得静默破坏更高层事实；冲突必须在视觉确认前解决或形成明确Override。

## 实现前硬条件

任何Implementation Worker都必须验证 `.apex/runs/<run-id>/state.json`，并执行 `scripts/apex-validate.mjs gate2 <run-dir>`。失败时禁止修改业务前端代码。
