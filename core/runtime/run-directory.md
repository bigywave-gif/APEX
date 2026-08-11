# APEX 运行目录

每次任务使用项目内 `.apex/runs/<run-id>/`，不得把项目运行产物写入 APEX Core：

```text
state.json
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

严格复刻运行必须保存 Gate 1 同源视觉合同、Stitch 暂存 HTML/完整截图、自动结构合同、自动生成的 parity 输入，以及运行时 DOM/截图。Freeze 产物在 Seal 前为暂存证据，不是实现权威。
