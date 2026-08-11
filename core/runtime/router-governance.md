# APEX Codex Router 治理

## 权威边界

APEX Bridge Skill 负责让 Codex 命中和进入 APEX；`apex-router.mjs` 是项目 run、
session、阶段、审批与动作授权的唯一代码化入口；`apex-action.mjs` 只执行已登记且
已经授权的 APEX 运行脚本。原有 Gate、Stitch、Existing、视觉、验证和质量脚本均保留，
由能力注册表声明并经 Router 分阶段调用。

## Session 隔离

- 新 Codex session 必须新建 run，禁止自动续接旧 run。
- 同一 session 只可恢复自己绑定的 run。
- 跨 session 接手不是默认行为；需要单独的显式交接协议和用户授权。
- 用户明确要求“重新执行 / 从头开始”时，必须使用 `restart` 在同一 session 创建全新 run。Router 必须先在旧 run 记录否决事件、清除该 session 的旧绑定并释放其旧 mutation lease，再绑定新 run；旧 run及其审计证据必须保留，但任何 Gate、用户输入、产品/交付契约、基线、功能冻结、视觉、Stitch、编译、实现与验证工件均不得继承，新 run 必须从入口阶段重新执行。
- 同一 session 在未完成 run 时收到第二次用户输入，必须先按语义路由：补充、澄清或同一任务的继续使用 `reinvoke ... continue`，保持当前 run；独立的新任务使用 `reinvoke ... new-task`，Router 清除旧 session 绑定与 lease 后创建并绑定新的干净 run，绝不继承旧任务的 Gate、用户输入或 APEX 中间产物。对既有任务的否决/重做仍使用 `restart`。
- 每次 Router 调用都先把 APEX 主目录 Bridge 自动发布到全局 Skill，再验证哈希同步并返回当前版本；发布失败即阻断。已打开 session 在下一次 Router 调用时自动重绑到当前版本与哈希，再进行状态返回、授权或阶段裁决；旧版本记录为 `previousBridge` 审计事实。不得把版本更新转嫁为用户“新开 session”“手动刷新”或显式交接的操作；所有可执行 Gate 与动作始终以自动刷新后的当前 Core 为准。

## 项目运行目录

所有任务中间产物位于 `<project-root>/.apex/`。APEX Core 根目录不得保存项目 run、
效果图、Stitch 画布、截图、用户资料、测试证据或缓存。项目级 mutation lease 用于
阻止不同 run 同时修改一个目标项目。

当项目是 Git 仓库且 Gate 2 已通过时，实施前可经 `prepare_workspace` 授权使用
`apex-workspace.mjs` 创建 `<project-root>/.apex/workspaces/<run-id>` 下的 detached
worktree。运行状态、确认、证据和交付契约仍只保存在原项目的 run 目录；worktree 只承载
该 run 的代码改动，不可替代 Router、Gate 或 mutation lease。

## 授权与失效

- Gate 1、视觉实施方案、Stitch 和实施确认必须使用 run 内的结构化审批回执；效果图生成只登记完整工件，不是审批回执。回执绑定项目、run、session、
  产物路径和 SHA-256。
- Router 授权回执绑定项目、run、session、动作、阶段、Gate 与 state hash，默认五分钟
  过期。
- 任意状态变更会改变 state hash 并使旧授权失效。
- 代码编辑、依赖安装、迁移与发布还必须取得项目 mutation lease。
- `apex-action.mjs` 为每个授权动作写入不可复用到其他命令的 operation receipt。相同授权、
  动作、脚本和参数的重试只返回已完成结果；参数不同、运行中或失败的 receipt 必须取得新授权，
  防止重复执行产生副作用。

## 取消、排队与人工复核

- `cancel` 将 run 标为 `cancelled`，释放其 mutation lease，并令旧授权因 state hash 变化而失效；
  它保留所有用户输入、交付物、审计和 Checkpoint。恢复工作应使用显式 `restart` 或新任务，而非
  将已取消 run 静默重新打开。
- Gate 2 后可通过 `queue-mutation` 进入项目级 FIFO mutation 队列，并由队首使用
  `claim-mutation` 取得 lease；排队不会放宽 Gate 或 lease 校验。
- 用户不接受确认候选时，使用 `review ... edited|rejected ...` 记录带哈希的复核回执，再由
  `restart` 或当前阶段的受控修改处理；不把“编辑/拒绝”误写成批准。
- `trajectory-evaluator.mjs` 作为 `verify` 动作生成事件轨迹证据，检查审批、Gate、授权和取消
  的先后关系，供流程回归验证使用。

## 宿主边界

Codex 通用 shell 或文件编辑工具不由本地 Skill 在平台层面拦截。APEX 正常调用路径必须
先请求 Router 授权，并优先使用 `apex-action.mjs` 执行 APEX 脚本；若宿主未来提供工具
代理，应将同一份 Router 校验挂到每个高风险工具之前。
