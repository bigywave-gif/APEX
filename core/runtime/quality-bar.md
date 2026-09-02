# APEX 当前质量门槛（以 manifest.version 为准）

`delivery-contract.json` 是每次运行的质量真相源。它不定义单一审美，而是定义可检验底线和用户确认的项目基线。

## 默认底线

- 可用性：以已定义用户任务的有效性、效率和满意度验收。
- 无障碍：WCAG 2.2 AA，除非用户明确了不同合规目标。
- 性能：LCP ≤ 2500ms、INP ≤ 200ms、CLS ≤ 0.1；在适用的部署环境按 75 分位验证。
- 动效：不以动画作为关键信息的唯一表达，支持 reduced-motion，不阻塞高频任务；每条动效必须证明其由声明的真实事件触发，并让用户更易理解一个明确的前后状态变化。
- 视觉：以批准的效果图、冻结的 Stitch 画布、Site Contract 与适用的可选 `DESIGN.md` 为基线，而非模型主观评分。

## 需求触发

- 图表需求必须产生完整 chart specification，包含真实数据、目标、异常、预测和验收。
- 动效需求必须产生完整 motion specification，包含目的、触发、任务、前后状态、信息收益、时序、性能和降级；不能证明任务价值的装饰性动效不得交付。
- Existing 必须产生可验证的真实基线。
- 后端/API 必须产生领域、接口和契约验证产物。

## 受控专业角色链（目标规范）

当 APEX 启用专业角色链后，产品、视觉、设计、前端和测试角色的结论只能作为可追溯的结构化 advisory，并必须被既有事实、来源锁、Gate 与运行时证据验证。角色名称、模型自述或主观质量分不构成质量结论。

- 产品专业度必须能追溯到用户任务、范围、数据/API 事实、验收和风险。
- 视觉专业度必须能追溯到设计 Token、候选取舍、真实组件/图标/图表/动效来源及运行时表现。
- 设计标准化必须复用 Existing `styleBaseline` 或 Greenfield 标准 Token，并通过 `DESIGN.md`、组件和响应式合同约束。
- 前端一致性必须由 Visual Source Manifest、Visual Bundle、Implementation Map、最小依赖物化、`data-apex-source` 与 Gate 2/3 证据共同证明。
- 角色适配器须经场景评测和反证审查；无原始证据的结论只能标记为 `unverified`。

完整规则见 [受控专业角色链治理](agency-role-chain-governance.md)。
