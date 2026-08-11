# APEX 交付系统

## 定义

在本系统中，`APEX` 采用的正式展开名为：

`Agentic Product EXperience`

其中：

- `Agentic`：强调由 agent 驱动的结构化执行
- `Product`：强调面向真实产品与真实业务
- `EXperience`：强调前端、UI、视觉、UX 与真实体验交付

`APEX` 同时也是这套系统的总称；其完整名称为：

`APEX 用户意图驱动的全栈交付系统`

`APEX` 是一套通用的 Agentic Delivery System，不绑定某个具体业务项目。

它的目标不是提供一份静态方法论文档，而是提供一套可调用、可执行、可迁移、可验收的产品、设计、前端、后端、数据与体验交付系统。

系统由五部分组成：

1. `core/`
2. `references/`
3. `registry/`
4. `connectors/`
5. `adapters/`

为了降低阅读跳转成本，当前还补充了一层：

6. `system-docs/`

同时补充了一层宿主接入运行目录：

7. `runtime/`

以及可执行控制层：

8. `scripts/`

## 目录职责

### `core/`

放通用主框架、状态机、Gate、运行时规则、角色职责、模板和策略。

### `references/`

放第三方来源与 APEX 采用后的规则提炼。

补充说明：

- `external/`：来源信息、采用边界、版本与许可策略
- `adopted/`：APEX 真正采用后的本地规则

### `registry/`

放 APEX 对外部能力的声明与登记规则。

补充说明：

- `required-capabilities.yaml`：必需能力真相源
- `optional-capabilities.yaml`：可选增强能力真相源
- `registration-record.example.yaml`：宿主登记样例
- `skills/manifest.yaml`：外部 skill 声明真相源
- `skills/activation-matrix.md`：按阶段启用矩阵
- `skills/conflict-matrix.md`：冲突与优先级矩阵
- `skills/*.md`：skill 契约文件，仅用于声明与接入，不是 IDE 安装态本身
- `assets/online-sources.yaml`：不保存第三方源码副本的在线候选能力池；它不是仅供视觉参考：被选中的组件、图标、样式或动效必须以精确版本在 `visual-sandbox` 或项目运行时实际加载，并在 Gate 2 后安装或生成到项目；按任务动态择优，不设置全局强制库
- `assets/contract.md`：Visual Bundle 素材身份、完整依赖锁、许可证和失败回退契约

### `connectors/`

放通用项目类型的接入模板，例如 `generic-web-app`、`react-saas`。

### `adapters/`

放具体项目的接入层。项目只作为 APEX 的使用方，不是宿主。

补充说明：

- `README.md`：adapter 目录职责
- `examples/`：通用示例接入层

### `system-docs/`

放 APEX 本体的一站式主文档入口。

补充说明：

- 提供产品主文档
- 提供技术架构主文档
- 提供部署与接入主文档
- 不替代 `core/` 真相源，只降低阅读成本

### `runtime/`

放宿主发现、Preflight 与桥接协议。

补充说明：

- `preflight.md`：正式运行前的宿主检查规则
- `codex-discovery.md`：Codex 如何发现并调用 APEX
- `host-bridges/`：桥接宿主能力的最小包装层

### `scripts/`

放运行状态控制器和Gate校验器。`apex-run.mjs`负责合法状态变更与Checkpoint，`apex-validate.mjs`负责Schema、锁关系和实现权限验证。

## 使用方式

当 `Codex` 已发现本地 APEX 包后，调用 APEX 时，建议使用统一入口：

```text
[APEX]
任务：
范围：
目标：
阶段要求：
约束：
```

或：

```text
[APEX-Lite]
[APEX-Standard]
[APEX-Full]
```

系统收到后必须先返回标准入口声明，再进入状态机。

## 系统主文档入口

如果希望直观完整地查看 APEX 本体内容，优先阅读：

1. [system-docs/README.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/README.md)
2. [system-docs/product-document.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/product-document.md)
3. [system-docs/technical-architecture.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/technical-architecture.md)
4. [system-docs/deployment-and-integration.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/deployment-and-integration.md)

## APEX 当前系统调用链（v4.15.0）

APEX 先编译用户短需求为 Intent Brief 和 Delivery Contract，再按 `Greenfield / Existing` 分轨，并组合 `Lite / Standard / Full` 范围和 `Interactive / Autonomous` 授权。新项目先建立产品、技术、数据和 Site Contract；已有项目先核对真实基线、冻结功能和影响范围。

两条轨道在 Visual 阶段汇合：先完成需求拆解、视觉效果描述和视觉实施方案确认，随后立即生成并登记严格运行时效果图。效果图是工件而非第二次人工确认；工件齐全后，用户才明确选择进入 Stitch 或直接代码：Stitch 路线再经过独立的 Stitch 生成、严格保真和 Stitch 确认后 Seal；直接代码路线以已登记效果图、代码目标和实施方案作为冻结基线。两条路线都必须通过 Gate 2 才能实施；实现后均以真实浏览器、功能/API、页面族与整站回归证据通过 Gate 3，不能以“直接代码”为由跳过确认或验收。

运行状态和产物位于目标项目 `.apex/runs/<run-id>/`；Checkpoint和内容哈希支持增量恢复，不再因中断无条件重跑全部流程。

## 系统边界

APEX 是“通用交付系统”，不是：

- 某个单项目的产品文档
- 某个页面的静态设计稿集合
- 某个技能仓库的镜像副本
- 某个前端框架专属脚手架

APEX 负责：

- 定义交付主流程
- 定义技能接入与调用顺序
- 定义项目接入层结构
- 定义验收门与恢复机制

项目自身负责：

- 提供真实代码真相源
- 提供真实页面和业务目标
- 提供项目 adapter
- 提供运行、构建、验收与发布环境

## 迁移原则

如果要把 APEX 迁移给其他项目或其他人使用：

1. 把整个 `APEX` 目录复制到宿主固定发现目录
2. 让目标项目保留自己的产品、代码和部署文档
3. 新建目标项目自己的 `adapter`
4. 使用最接近的 `connector`
5. 由宿主先发现 `manifest.yaml`，再由 APEX 读取项目

## 开源使用边界

如果目标是把 APEX 作为“开源且可长期使用的系统包”对外迁移，还必须额外满足：

1. 关键规范、组件语言、工具来源具备公开来源与许可证
2. 宿主本地 skill 不能作为硬依赖
3. 插件 / 宿主能力必须有降级策略
4. 采用状态以 [references/external/sources.yaml](https://github.com/bigywave-gif/APEX/blob/main/references/external/sources.yaml) 与 [references/external/open-source-eligibility-policy.md](https://github.com/bigywave-gif/APEX/blob/main/references/external/open-source-eligibility-policy.md) 为准

## 持续更新能力

APEX 支持在使用中持续补充外部能力池，但遵循：

- 先检查本地，再检查外部
- 同时判断 `最新` 与 `最优`
- 不自动替换现有能力池
- 如发现值得纳入的新开源能力，应提示用户是否更新与补充

补充边界：

- 持续更新只允许作用于增强层
- 不允许影响核心工作流、状态机、Gate 与项目 adapter 真相源
- 更新目标仅限专项能力增强、效果增强、约束增强、规范增强
- 用户确认前只能提示，不能替换默认能力池
- 外部更新检查默认后台执行
- 更新检查结果返回不应阻塞当前主任务

规则真相源见：

- [references/external/continuous-update-policy.md](https://github.com/bigywave-gif/APEX/blob/main/references/external/continuous-update-policy.md)

## 当前接入实例

公开仓库提供通用 SaaS 接入示例：

- [adapters/examples/generic-saas/adapter.md](https://github.com/bigywave-gif/APEX/blob/main/adapters/examples/generic-saas/adapter.md)

具体业务项目的 Adapter 与参考实现不进入通用公开包，应由使用方在自己的私有项目中维护。

## 关键文件

- [INDEX.md](https://github.com/bigywave-gif/APEX/blob/main/INDEX.md)
- [PACKAGING.md](https://github.com/bigywave-gif/APEX/blob/main/PACKAGING.md)
- [manifest.yaml](https://github.com/bigywave-gif/APEX/blob/main/manifest.yaml)
- [core/framework/APEX.md](https://github.com/bigywave-gif/APEX/blob/main/core/framework/APEX.md)
- [core/framework/state-machine.md](https://github.com/bigywave-gif/APEX/blob/main/core/framework/state-machine.md)
- [core/framework/gates.md](https://github.com/bigywave-gif/APEX/blob/main/core/framework/gates.md)
- [core/runtime/invocation-spec.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/invocation-spec.md)
- [core/policies/admission-rules.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/admission-rules.md)
- [core/policies/priority-model.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/priority-model.md)
- [core/policies/accessibility-gate.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/accessibility-gate.md)
- [core/runtime/apex-audit-spec.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/apex-audit-spec.md)
- [core/runtime/token-policy.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/token-policy.md)
- [core/runtime/tooling-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/tooling-matrix.md)
- [core/runtime/host-capability-governance.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/host-capability-governance.md)
- [core/runtime/system-requirements.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/system-requirements.md)
- [runtime/preflight.md](https://github.com/bigywave-gif/APEX/blob/main/runtime/preflight.md)
- [runtime/codex-discovery.md](https://github.com/bigywave-gif/APEX/blob/main/runtime/codex-discovery.md)
- [registry/required-capabilities.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/required-capabilities.yaml)
- [registry/optional-capabilities.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/optional-capabilities.yaml)
- [registry/skills/manifest.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/manifest.yaml)
- [registry/skills/activation-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/activation-matrix.md)
- [registry/skills/conflict-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/conflict-matrix.md)
