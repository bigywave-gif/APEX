# 受控领域与 API 契约登记

当 Delivery Contract 含 `backend` 或 `api-contract` capability 时，Gate 1 前必须通过已有的 `record_context` 授权和 `contract-recorder.mjs` 登记以下工件：

```text
record_context -> contract-recorder.mjs domain <run-dir> <domain-model-input.json>
record_context -> contract-recorder.mjs api <run-dir> <api-contract-input.json>
```

该记录器校验相应 Schema，并只将成功操作输出注册为 `state.artifacts.domainModel`、`state.artifacts.apiContract`。它不接受 Gate 1 后替换冻结契约；需要修改时必须走既有 Router 修订流程。没有 backend/API capability 时拒绝登记，避免把不适用的空契约写入工件链。

这两个命令复用既有 `record_context`，不增加用户确认或阶段。Gate 1 仍由 `apex-validate.mjs pre-gate1` 决定是否需要、以及是否允许通过。
