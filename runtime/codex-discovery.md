# Codex Discovery Contract

## 目的

定义 `Codex` 如何把 `APEX` 识别为一个可调用的本地应用包。

## 发现方式

使用当前用户的 Codex 主目录发现：

```text
`<CODEX_HOME>/apex/APEX`
```

当且仅当以下条件同时满足时，视为 `Codex` 已发现 APEX：

1. `<CODEX_HOME>/apex/APEX/manifest.yaml` 存在
2. `manifest.yaml` 中声明的关键入口可读
3. `core/`、`runtime/`、`registry/`、`references/` 结构完整

`CODEX_HOME` 未设置时等于 `$HOME/.codex`。解析后的目录是所有新建、继续和恢复 session 的唯一 APEX 根目录；工作区中的 `APEX/` 副本只能作为迁移源或只读镜像，不能作为运行根、规则真相源或升级目标。

所有 APEX 核心代码、文档、Schema、Skill 和正式输出均必须在该主目录内创建或更新。当前终端工作目录不构成 APEX 写入授权；工作区或其他副本不得接收 APEX 核心变更。

## Codex 读取顺序

1. `manifest.yaml`
2. 执行 `scripts/preflight.mjs`
3. `runtime/preflight.md`
4. `core/runtime/invocation-spec.md`
5. `registry/host-skill-dependencies.json`
6. `registry/required-capabilities.yaml`
7. `registry/optional-capabilities.yaml`

## 路由语义

Codex 命中以下任务时，应优先进入由 `manifest.yaml` 的 `version` 标识的当前 APEX Core：

- 用户显式输入 `APEX`
- 前端 / UI / 视觉 / UX / 产品级整改
- 页面家族统一
- 设计系统收敛
- 需要先审计再实现的产品级前端改造

## 不应做的事

- 不应把项目直接当成 APEX 主入口
- 不应先读项目 adapter 再决定 APEX 是否存在
- 不应把外部 skill 目录当成 APEX 本体
