# APEX 系统索引

## APEX 3.0 核心入口

- 双轨状态机：`core/framework/state-machine.md`
- 3.0 总览：`README-3.0.md`
- 3.0 完整规范：`system-docs/apex-3.0-complete-specification.md`
- 3.0 迁移：`core/runtime/migration-3.0.md`
- 质量门槛：`core/runtime/quality-bar.md`
- 轨道：`core/framework/tracks.md`
- 授权：`core/framework/authorization.md`
- 可执行Gate：`core/framework/gates.md`
- 运行目录：`core/runtime/run-directory.md`
- Schema：`core/runtime/schemas/`
- Codex Router：`scripts/apex-router.mjs`
- 受控动作网关：`scripts/apex-action.mjs`
- 校验器：`scripts/apex-validate.mjs`
- 内部状态控制器：`scripts/apex-run.mjs`（仅 Router 调用）
- Stitch同步：`scripts/stitch-sync.mjs`
- Stitch严格复刻编排：`scripts/strict-replica.mjs`
- 结构合同导出：`scripts/structure-contract.mjs`
- 严格复刻规范：`core/runtime/strict-replica.md`
- 设计包编译：`scripts/bundle-compiler.mjs`
- 素材解析：`scripts/asset-resolver.mjs`
- 选中静态源码物化：`scripts/asset-materializer.mjs`
- 选中运行时包物化与审计：`scripts/runtime-materializer.mjs`
- 上下文索引：`scripts/context-compiler.mjs`
- 验证编排：`scripts/verification-orchestrator.mjs`
- Existing 基线采集：`scripts/baseline-collector.mjs`
- 恢复控制：`scripts/apex-recover.mjs`
- Stitch可编辑画布：`connectors/google-stitch/connector.md`

## 入口

- 系统说明：[README.md](https://github.com/bigywave-gif/APEX/blob/main/README.md)
- 系统清单：[manifest.yaml](https://github.com/bigywave-gif/APEX/blob/main/manifest.yaml)
- 系统文档总入口：[system-docs/README.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/README.md)

## 系统主文档

- 产品文档：[system-docs/product-document.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/product-document.md)
- 技术架构文档：[system-docs/technical-architecture.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/technical-architecture.md)
- 部署与接入文档：[system-docs/deployment-and-integration.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/deployment-and-integration.md)
- 3.0 完整规范：[system-docs/apex-3.0-complete-specification.md](https://github.com/bigywave-gif/APEX/blob/main/system-docs/apex-3.0-complete-specification.md)

## 核心框架

- 主框架：[core/framework/APEX.md](https://github.com/bigywave-gif/APEX/blob/main/core/framework/APEX.md)
- 状态机：[core/framework/state-machine.md](https://github.com/bigywave-gif/APEX/blob/main/core/framework/state-machine.md)
- 确认门：[core/framework/gates.md](https://github.com/bigywave-gif/APEX/blob/main/core/framework/gates.md)

## 运行时

- 调用协议：[core/runtime/invocation-spec.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/invocation-spec.md)
- Router 治理：[core/runtime/router-governance.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/router-governance.md)
- 严格复刻规范：[core/runtime/strict-replica.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/strict-replica.md)
- Preflight：[runtime/preflight.md](https://github.com/bigywave-gif/APEX/blob/main/runtime/preflight.md)
- Codex 发现协议：[runtime/codex-discovery.md](https://github.com/bigywave-gif/APEX/blob/main/runtime/codex-discovery.md)
- 恢复协议：[core/runtime/recovery-spec.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/recovery-spec.md)
- 审计规格：[core/runtime/apex-audit-spec.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/apex-audit-spec.md)
- token 策略：[core/runtime/token-policy.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/token-policy.md)
- Existing 基线采集：[core/runtime/existing-baseline.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/existing-baseline.md)
- 工具矩阵：[core/runtime/tooling-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/tooling-matrix.md)
- 宿主能力治理：[core/runtime/host-capability-governance.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/host-capability-governance.md)
- 插件与宿主能力清单：[core/runtime/plugin-capability-inventory.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/plugin-capability-inventory.md)
- 系统要求：[core/runtime/system-requirements.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/system-requirements.md)
- 安装迁移：[core/runtime/install-and-migration.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/install-and-migration.md)
- 发布检查：[core/runtime/release-checklist.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/release-checklist.md)
- 发布审查：[core/runtime/release-audit-v2.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/release-audit-v2.md)
- 发布说明：[core/runtime/release-notes.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/release-notes.md)
- 打包内容：[core/runtime/package-contents.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/package-contents.md)

## 策略

- 准入规则：[core/policies/admission-rules.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/admission-rules.md)
- 可访问性确认门：[core/policies/accessibility-gate.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/accessibility-gate.md)
- 失败分支：[core/policies/failure-branches.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/failure-branches.md)
- 确认门语义：[core/policies/gate-semantics.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/gate-semantics.md)
- 优先级模型：[core/policies/priority-model.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/priority-model.md)
- 阈值策略：[core/policies/thresholds.md](https://github.com/bigywave-gif/APEX/blob/main/core/policies/thresholds.md)

## 角色

- 准入角色：[core/roles/intake.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/intake.md)
- 主控角色：[core/roles/orchestrator.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/orchestrator.md)
- 基线核对角色：[core/roles/baseline-worker.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/baseline-worker.md)
- 一致性核对角色：[core/roles/consistency-worker.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/consistency-worker.md)
- 产品评估角色：[core/roles/product-audit-worker.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/product-audit-worker.md)
- 视觉评估角色：[core/roles/visual-audit-worker.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/visual-audit-worker.md)
- UX 评估角色：[core/roles/ux-audit-worker.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/ux-audit-worker.md)
- 风险评估角色：[core/roles/risk-audit-worker.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/risk-audit-worker.md)
- 实现角色：[core/roles/implementation-worker.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/implementation-worker.md)
- 验证角色：[core/roles/verification-worker.md](https://github.com/bigywave-gif/APEX/blob/main/core/roles/verification-worker.md)

## 模板

- 准入模板：[core/templates/intake-template.md](https://github.com/bigywave-gif/APEX/blob/main/core/templates/intake-template.md)
- 评估模板：[core/templates/audit-template.md](https://github.com/bigywave-gif/APEX/blob/main/core/templates/audit-template.md)
- 方案模板：[core/templates/plan-template.md](https://github.com/bigywave-gif/APEX/blob/main/core/templates/plan-template.md)
- 视觉模板：[core/templates/visual-template.md](https://github.com/bigywave-gif/APEX/blob/main/core/templates/visual-template.md)
- 实现模板：[core/templates/implement-template.md](https://github.com/bigywave-gif/APEX/blob/main/core/templates/implement-template.md)
- 验证模板：[core/templates/verify-template.md](https://github.com/bigywave-gif/APEX/blob/main/core/templates/verify-template.md)

## 第三方来源与采用

- 来源清单：[references/external/sources.yaml](https://github.com/bigywave-gif/APEX/blob/main/references/external/sources.yaml)
- 开源可用性准入：[references/external/open-source-eligibility-policy.md](https://github.com/bigywave-gif/APEX/blob/main/references/external/open-source-eligibility-policy.md)
- 持续更新策略：[references/external/continuous-update-policy.md](https://github.com/bigywave-gif/APEX/blob/main/references/external/continuous-update-policy.md)
- 采用边界：[references/external/adoption-boundaries.md](https://github.com/bigywave-gif/APEX/blob/main/references/external/adoption-boundaries.md)
- 版本与许可：[references/external/version-and-license-policy.md](https://github.com/bigywave-gif/APEX/blob/main/references/external/version-and-license-policy.md)
- 已采用规则：[references/adopted/adopted-design-rules.md](https://github.com/bigywave-gif/APEX/blob/main/references/adopted/adopted-design-rules.md)

## Registry

- 必需能力：[registry/required-capabilities.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/required-capabilities.yaml)
- 可选能力：[registry/optional-capabilities.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/optional-capabilities.yaml)
- 在线素材候选池：[registry/assets/online-sources.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/assets/online-sources.yaml)
- 在线素材引用与依赖契约：[registry/assets/contract.md](https://github.com/bigywave-gif/APEX/blob/main/registry/assets/contract.md)
- 宿主登记样例：[registry/registration-record.example.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/registration-record.example.yaml)
- 技能总览：[registry/skills/README.md](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/README.md)
- 技能清单：[registry/skills/manifest.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/manifest.yaml)
- 激活矩阵：[registry/skills/activation-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/activation-matrix.md)
- 冲突矩阵：[registry/skills/conflict-matrix.md](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/conflict-matrix.md)

## 接入层

- 接入模板选择：[connectors/connector-selection.md](https://github.com/bigywave-gif/APEX/blob/main/connectors/connector-selection.md)
- Generic Web 接入模板：[connectors/generic-web-app/connector.md](https://github.com/bigywave-gif/APEX/blob/main/connectors/generic-web-app/connector.md)
- React SaaS 接入模板：[connectors/react-saas/connector.md](https://github.com/bigywave-gif/APEX/blob/main/connectors/react-saas/connector.md)
- Vue Admin 接入模板：[connectors/vue-admin/connector.md](https://github.com/bigywave-gif/APEX/blob/main/connectors/vue-admin/connector.md)
- Vanilla JS 接入模板：[connectors/vanilla-js-app/connector.md](https://github.com/bigywave-gif/APEX/blob/main/connectors/vanilla-js-app/connector.md)
- Google Stitch Visual Connector：[connectors/google-stitch/connector.md](https://github.com/bigywave-gif/APEX/blob/main/connectors/google-stitch/connector.md)
- Generic SaaS 示例接入层：[adapters/examples/generic-saas/adapter.md](https://github.com/bigywave-gif/APEX/blob/main/adapters/examples/generic-saas/adapter.md)
