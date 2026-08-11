# APEX Bridge Skill Contract

## 目的

定义安装到 `Codex` 宿主 skill 目录中的桥接 skill 应如何把任务导入 APEX。

## 桥接 skill 的职责

- 在用户显式提到 `APEX` 或命中 APEX 类任务时触发
- 先读取外部 `APEX` 根目录
- 先执行 `Preflight`
- 再进入 `invocation-spec.md` 定义的正式入口

## 桥接 skill 不负责

- 复制 APEX Core
- 维护 APEX 真相源
- 替代 APEX 状态机

## 桥接 skill 的最小读取顺序

1. `<CODEX_HOME>/apex/APEX/manifest.yaml`
2. 执行 `node <CODEX_HOME>/apex/APEX/scripts/preflight.mjs`
3. `<CODEX_HOME>/apex/APEX/runtime/preflight.md`
4. `<CODEX_HOME>/apex/APEX/core/runtime/invocation-spec.md`

`CODEX_HOME` 未设置时等于当前用户的 `$HOME/.codex`，所以默认路径仍为 `~/.codex/apex/APEX`。解析后的目录是唯一 APEX 根目录；桥接 skill 禁止回退到工作区副本、项目内副本或其他候选目录。

所有 APEX 核心代码、文档、Schema、Skill 和正式输出只允许在该主目录内创建或调整。临时渲染、下载缓存和工作区副本不是正式交付位置。
