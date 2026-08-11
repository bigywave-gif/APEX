# 宿主能力治理

## 目的

定义 APEX 接入任意宿主环境时，关于 skill、工具、插件 / 宿主能力、connector、adapter 的最小治理要求。

本文件解决的问题不是“怎么跑流程”，而是“这套流程接入新环境时，哪些能力必须存在、哪些能力只能按条件启用、哪些约束必须先被宿主承诺”。

## 必读范围

新项目或新宿主接入 APEX 时，至少同时阅读：

1. [apex/README.md](https://github.com/bigywave-gif/APEX/blob/main/README.md)
2. [apex/core/runtime/invocation-spec.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/invocation-spec.md)
3. [apex/core/policies/admission-rules.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/admission-rules.md)
4. [apex/core/policies/priority-model.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/priority-model.md)
5. [apex/core/runtime/tooling-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/tooling-matrix.md)
6. 本文件

## 宿主必须提供的基础能力

### 代码能力

- 可读取目标项目代码
- 可编辑目标项目代码
- 可定位真实前端入口与真实运行时入口

### 文档能力

- 可读取项目产品真相源
- 可读取项目设计真相源
- 可读取项目运行与验收规则

### 验证能力

- 至少具备静态验证能力
- 最好具备页面或运行态验证能力
- 若缺少浏览器、截图或运行时验证能力，必须显式降级说明

## Skill 治理

- Skill 只能作为 APEX 的增强层，不能替代状态机、确认门和最终裁决
- Skill 是否启用，以 [apex/registry/skills/manifest.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/manifest.yaml) 与 [apex/registry/skills/activation-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/activation-matrix.md) 为准
- 未完成结构确认前，不启用审美强化和动效强化类 skill
- 未进入实现前，不让工程纪律类 skill 主导视觉判断

## 工具 / 插件 / 宿主能力治理

这里的“插件”统一指宿主环境暴露的可调用能力，例如：

- 浏览器控制
- 截图
- 搜索
- 本地命令执行
- 外部文档访问

治理原则：

- 插件 / 工具只解决能力问题，不负责流程裁决
- 任何插件能力都不能绕过 APEX 准入、步骤锁和确认门
- 插件不可用时，必须显式走降级策略，不能假装已验收
- 是否需要某类插件能力，以 [apex/core/runtime/tooling-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/tooling-matrix.md) 为准

## Connector 治理

- Connector 决定“项目类型接入方式”，不决定 APEX 主流程
- 选择错误的 connector，会导致页面家族和代码入口映射错误
- 若不确定，先使用更保守的 connector，再补充 adapter

## Adapter 治理

- Adapter 只负责项目投影
- Adapter 必须描述：产品真相源、设计真相源、代码入口、页面家族、验收映射
- Adapter 不允许复制 APEX 通用流程

## 最低接入检查

新宿主接入 APEX 前，至少确认：

1. 是否能稳定命中 APEX 准入
2. 是否能输出标准入口声明
3. 是否能读取项目真相源
4. 是否能执行代码基线核对
5. 是否能执行一致性核对
6. 是否具备至少一种可用验证方式
7. 是否能按条件启用 skill，而不是全开

## 禁止状态

- 只有 APEX 目录，但宿主没有准入规则入口
- 只有 skill 清单，但没有调用顺序和冲突治理
- 只有工具能力，但没有降级策略
- 只有 adapter，但没有产品 / 设计 / 代码真相源映射
- 只有流程文档，但没有宿主能力说明
