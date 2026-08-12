# APEX 系统文档总入口

## 目的

本目录提供 APEX 本体的一站式主文档入口。

目标不是替代 `core/`、`references/`、`skills/`、`connectors/`、`adapters/` 这些真相源，而是把最常用、最需要完整通读的系统级信息整理成直观主文档，避免阅读时在几十份底层文件之间来回跳转。

## 当前主文档清单

### 独立 PDF 白皮书

- [APEX-Product-Design-and-Technical-Architecture.pdf](../output/pdf/APEX-Product-Design-and-Technical-Architecture.pdf)

说明：

- 文件名保持稳定，不再携带历史 `3.0` 标识；具体发布版本以 PDF 封面、元数据及 `manifest.yaml` 为准。
- PDF 与产品、技术架构、部署文档在发布审计中同步生成和校验。

### APEX 当前完整规范（以 manifest.version 为准）

- [apex-3.0-complete-specification.md](apex-3.0-complete-specification.md)

说明：

- 面向产品、设计、前后端与测试团队，统一说明规范接入、三次确认、效果图与 Stitch 的双视觉真相源、工程追踪、质量证据和发布边界。
- 严格复刻采用 Gate 1 同源视觉合同、暂存 Freeze、自动结构合同、Seal 与效果图→Stitch→代码两段零差异 Gate；详细规范见 core/runtime/strict-replica.md。

### 产品文档

- [product-document.md](product-document.md)

说明：

- 说明 APEX 是什么、解决什么问题、适用于哪些任务、模式如何分级、边界与输出物是什么。

### 技术架构文档

- [technical-architecture.md](technical-architecture.md)

说明：

- 说明 APEX 的系统分层、调用链、状态机执行路径、更新边界、宿主关系和关键运行细节。
- 本文档包含架构图、流程图和细节说明。

### 部署与接入文档

- [deployment-and-integration.md](deployment-and-integration.md)

说明：

- 说明 APEX 如何打包、迁移、安装、接入新项目、选择 connector、创建 adapter、完成首轮验收。

## 不单列接口文档的原因

当前 APEX 是一套交付系统，不是一套对外开放的业务 API 服务，因此不单独维护“平台接口文档”。

现有对外契约能力主要体现在：

- 调用协议：[../core/runtime/invocation-spec.md](../core/runtime/invocation-spec.md)
- 恢复协议：[../core/runtime/recovery-spec.md](../core/runtime/recovery-spec.md)
- 准入规则：[../core/policies/admission-rules.md](../core/policies/admission-rules.md)

这些协议仍然是底层真相源，但由于它们属于核心运行规则，继续保留在 `core/` 中，不抽成单独“接口文档”类目。

## 推荐阅读顺序

### 首次理解 APEX

1. [product-document.md](product-document.md)
2. [technical-architecture.md](technical-architecture.md)
3. [deployment-and-integration.md](deployment-and-integration.md)

### 准备迁移到新项目

1. [deployment-and-integration.md](deployment-and-integration.md)
2. [../connectors/connector-selection.md](../connectors/connector-selection.md)
3. [../adapters/README.md](../adapters/README.md)

### 准备修改核心规则

1. [technical-architecture.md](technical-architecture.md)
2. [../core/framework/APEX.md](../core/framework/APEX.md)
3. [../core/framework/state-machine.md](../core/framework/state-machine.md)
4. [../core/framework/gates.md](../core/framework/gates.md)

## 文档层边界

本目录只做三件事：

1. 提供完整主文档入口
2. 提供可连续阅读的系统级说明
3. 减少来回跳转成本

本目录不做：

1. 重写核心状态机
2. 改写 Gate 语义
3. 覆盖底层真相源
4. 替代 `core/`、`references/`、`skills/`、`connectors/`、`adapters/`
