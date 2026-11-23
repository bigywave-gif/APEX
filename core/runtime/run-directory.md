# APEX 运行目录

每次任务使用项目内 `.apex/runs/<run-id>/`，不得把项目运行产物写入 APEX Core：

```text
state.json
run-ledger.sqlite
context-index.json
decisions.json
intent-brief.json
delivery-contract.json
existing-baseline.json
domain-model.json
api-contract.json
data-contract.json
site-contract.json
functional-freeze.json
gate1-visual-output.json
visual-reference.json
stitch-parity-evidence.json
stitch-freeze.json
implementation-parity-evidence.json
evidence/stitch/screens/<screen-id>/
evidence/contracts/
evidence/parity/
evidence/browser/
visual-bundle.json
implementation-map.json
page-delta.json
change-scope.json
dependency-lock.json
verification-bundle.json
checkpoints/
```

Router 初始化时还会创建项目级 `.apex/project.json`（项目身份）、run 内
`events.ndjson`（调用审计）、`artifacts/`、`approvals/`、`evidence/` 和
`locks/`。确认点跳过决策写入 `decisions/skip-<checkpoint>-<decision-id>.json`，
不会覆盖既有工件或批准回执。这些均为目标项目运行产物；`~/.codex/apex/APEX` 只能
保存 APEX Core、Schema、脚本、Skill、规范和系统自身正式输出。

文件路径必须写入 `state.json.artifacts`。敏感数据、API Key、真实用户数据和第三方素材副本不得进入运行目录或版本库。

`run-ledger.sqlite` 是状态快照、事件、Checkpoint、Agent Job、Token 用量、trace 与产物谱系的耐久真相源；`state.json` 是兼容性投影。每次受控动作的输入与输出均登记 SHA-256，并以 `artifact_edges` 记录依赖。`apex-reconcile.mjs status <run-dir>` 一旦发现状态投影损坏、文件缺失、哈希漂移、断裂谱系、运行中 Job 或死信 Job，就返回 `repair-required`；必须先使用已登记的恢复流程处理，禁止越过问题继续下一个 Gate。

严格复刻运行必须保存 Gate 1 同源视觉合同、Stitch 暂存 HTML/完整截图、自动结构合同、自动生成的 parity 输入，以及运行时 DOM/截图。Freeze 产物在 Seal 前为暂存证据，不是实现权威。

用户终止当前 Run 时，Router 会先持久化取消状态并隔离活跃 Agent 任务，然后停止其已登记的 Run-local Demo 服务并验证 PID 归属，再删除当前
Run 中除 `state.json`、`run-ledger.sqlite`、`run-ledger.sqlite-wal`、`run-ledger.sqlite-shm`、`events.ndjson` 和 `cancellation-receipt.json` 以外的所有内容；回执只保存
回收范围、服务停止结果和被隔离任务；外部 Agent 是否实际中断须另行确认。该操作不遍历其它 Run，不会停掉项目正式服务，也不回滚已落地的正式代码。
