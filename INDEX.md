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

- 系统说明：[README.md](README.md)
- 系统清单：[manifest.yaml](manifest.yaml)
- 系统文档总入口：[system-docs/README.md](system-docs/README.md)

## 系统主文档

- 产品文档：[system-docs/product-document.md](system-docs/product-document.md)
- 技术架构文档：[system-docs/technical-architecture.md](system-docs/technical-architecture.md)
- 部署与接入文档：[system-docs/deployment-and-integration.md](system-docs/deployment-and-integration.md)
- 3.0 完整规范：[system-docs/apex-3.0-complete-specification.md](system-docs/apex-3.0-complete-specification.md)

## 核心框架

- 主框架：[core/framework/APEX.md](core/framework/APEX.md)
- 状态机：[core/framework/state-machine.md](core/framework/state-machine.md)
- 确认门：[core/framework/gates.md](core/framework/gates.md)

## 运行时

- 调用协议：[core/runtime/invocation-spec.md](core/runtime/invocation-spec.md)
- Router 治理：[core/runtime/router-governance.md](core/runtime/router-governance.md)
- 严格复刻规范：[core/runtime/strict-replica.md](core/runtime/strict-replica.md)
- Preflight：[runtime/preflight.md](runtime/preflight.md)
- Codex 发现协议：[runtime/codex-discovery.md](runtime/codex-discovery.md)
- 恢复协议：[core/runtime/recovery-spec.md](core/runtime/recovery-spec.md)
- 审计规格：[core/runtime/apex-audit-spec.md](core/runtime/apex-audit-spec.md)
- token 策略：[core/runtime/token-policy.md](core/runtime/token-policy.md)
- Existing 基线采集：[core/runtime/existing-baseline.md](core/runtime/existing-baseline.md)
- 工具矩阵：[core/runtime/tooling-matrix.md](core/runtime/tooling-matrix.md)
- 宿主能力治理：[core/runtime/host-capability-governance.md](core/runtime/host-capability-governance.md)
- 插件与宿主能力清单：[core/runtime/plugin-capability-inventory.md](core/runtime/plugin-capability-inventory.md)
- 系统要求：[core/runtime/system-requirements.md](core/runtime/system-requirements.md)
- 安装迁移：[core/runtime/install-and-migration.md](core/runtime/install-and-migration.md)
- 发布检查：[core/runtime/release-checklist.md](core/runtime/release-checklist.md)
- 发布审查：[core/runtime/release-audit-v2.md](core/runtime/release-audit-v2.md)
- 发布说明：[core/runtime/release-notes.md](core/runtime/release-notes.md)
- 打包内容：[core/runtime/package-contents.md](core/runtime/package-contents.md)

## 策略

- 准入规则：[core/policies/admission-rules.md](core/policies/admission-rules.md)
- 可访问性确认门：[core/policies/accessibility-gate.md](core/policies/accessibility-gate.md)
- 失败分支：[core/policies/failure-branches.md](core/policies/failure-branches.md)
- 确认门语义：[core/policies/gate-semantics.md](core/policies/gate-semantics.md)
- 优先级模型：[core/policies/priority-model.md](core/policies/priority-model.md)
- 阈值策略：[core/policies/thresholds.md](core/policies/thresholds.md)

## 角色

- 准入角色：[core/roles/intake.md](core/roles/intake.md)
- 主控角色：[core/roles/orchestrator.md](core/roles/orchestrator.md)
- 基线核对角色：[core/roles/baseline-worker.md](core/roles/baseline-worker.md)
- 一致性核对角色：[core/roles/consistency-worker.md](core/roles/consistency-worker.md)
- 产品评估角色：[core/roles/product-audit-worker.md](core/roles/product-audit-worker.md)
- 视觉评估角色：[core/roles/visual-audit-worker.md](core/roles/visual-audit-worker.md)
- UX 评估角色：[core/roles/ux-audit-worker.md](core/roles/ux-audit-worker.md)
- 风险评估角色：[core/roles/risk-audit-worker.md](core/roles/risk-audit-worker.md)
- 实现角色：[core/roles/implementation-worker.md](core/roles/implementation-worker.md)
- 验证角色：[core/roles/verification-worker.md](core/roles/verification-worker.md)

## 模板

- 准入模板：[core/templates/intake-template.md](core/templates/intake-template.md)
- 评估模板：[core/templates/audit-template.md](core/templates/audit-template.md)
- 方案模板：[core/templates/plan-template.md](core/templates/plan-template.md)
- 视觉模板：[core/templates/visual-template.md](core/templates/visual-template.md)
- 实现模板：[core/templates/implement-template.md](core/templates/implement-template.md)
- 验证模板：[core/templates/verify-template.md](core/templates/verify-template.md)

## 第三方来源与采用

- 来源清单：[references/external/sources.yaml](references/external/sources.yaml)
- 开源可用性准入：[references/external/open-source-eligibility-policy.md](references/external/open-source-eligibility-policy.md)
- 持续更新策略：[references/external/continuous-update-policy.md](references/external/continuous-update-policy.md)
- 采用边界：[references/external/adoption-boundaries.md](references/external/adoption-boundaries.md)
- 版本与许可：[references/external/version-and-license-policy.md](references/external/version-and-license-policy.md)
- 已采用规则：[references/adopted/adopted-design-rules.md](references/adopted/adopted-design-rules.md)

## Registry

- 必需能力：[registry/required-capabilities.yaml](registry/required-capabilities.yaml)
- 可选能力：[registry/optional-capabilities.yaml](registry/optional-capabilities.yaml)
- 在线素材候选池：[registry/assets/online-sources.yaml](registry/assets/online-sources.yaml)
- 在线素材引用与依赖契约：[registry/assets/contract.md](registry/assets/contract.md)
- 宿主登记样例：[registry/registration-record.example.yaml](registry/registration-record.example.yaml)
- 技能总览：[registry/skills/README.md](registry/skills/README.md)
- 技能清单：[registry/skills/manifest.yaml](registry/skills/manifest.yaml)
- 激活矩阵：[registry/skills/activation-matrix.md](registry/skills/activation-matrix.md)
- 冲突矩阵：[registry/skills/conflict-matrix.md](registry/skills/conflict-matrix.md)

## 接入层

- 接入模板选择：[connectors/connector-selection.md](connectors/connector-selection.md)
- Generic Web 接入模板：[connectors/generic-web-app/connector.md](connectors/generic-web-app/connector.md)
- React SaaS 接入模板：[connectors/react-saas/connector.md](connectors/react-saas/connector.md)
- Vue Admin 接入模板：[connectors/vue-admin/connector.md](connectors/vue-admin/connector.md)
- Vanilla JS 接入模板：[connectors/vanilla-js-app/connector.md](connectors/vanilla-js-app/connector.md)
- Google Stitch Visual Connector：[connectors/google-stitch/connector.md](connectors/google-stitch/connector.md)
- Generic SaaS 示例接入层：[adapters/examples/generic-saas/adapter.md](adapters/examples/generic-saas/adapter.md)
