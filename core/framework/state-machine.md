# APEX 双轨状态机

## 三个正交维度

- 轨道：`greenfield` 新项目 / `existing` 已有项目。
- 范围：`lite` / `standard` / `full`。
- 授权：`interactive` / `autonomous`。自主授权只减少等待，不得绕过 Gate 记录、功能删除确认、权限语义变化和破坏性操作授权。

## 公共入口

1. `APEX-01 INTENT`：编译用户短需求为 Intent Brief、默认假设、质量门槛与待确认项。
2. `APEX-02 CLASSIFY`：确定轨道、范围、授权、页面族和任务边界。
3. `APEX-03 PREFLIGHT`：验证 APEX、宿主、项目入口、在线素材注册表和必要工具。

新 Run 先完成产品需求和角色结论，再由设计师产出视觉方案。用户确认视觉方案后自动生成并展示可交互 Demo；用户确认 Demo 后才可选择 Stitch 或直接代码。Stitch 一致时自动封存，差异需要明确选择保留 Demo 直接落地或调整重确认。路线选择不得由“继续”推断。旧 Run 按创建时的确认模型恢复。

## Greenfield 轨道

4. `G-01 PRODUCT`：产品目标、角色、任务流、页面地图和数据实体。
5. `G-02 ARCHITECTURE`：技术栈、路由、状态、API、权限、组件与错误恢复。
6. `G-03 SITE_CONTRACT`：建立整站设计与产品契约。
7. `G-04 GATE_1`：校验产品、架构、范围、风险与验收边界，汇入视觉方案确认。
8. `G-05 VISUAL`：确认视觉方案，生成、展示并确认可交互 Demo。
9. `G-06 SYNC_FREEZE`：Demo 确认后选择 Stitch 或直接代码；前者验证候选与 Demo 一致并封存，后者冻结 Demo 和代码目标。
10. `G-07 COMPILE`：编译与所选路线一致的 Visual Bundle、Implementation Map、Data / Motion / Responsive Contract 和依赖锁。
11. `G-08 GATE_2`：机器校验后确认实现权限。
12. `G-09 PROOF_IMPLEMENT`：先实现代表页。
13. `G-10 PROOF_GATE`：真实浏览器证明设计可实现。
14. `G-11 EXPAND`：按页面族扩展。
15. `G-12 GATE_3`：视觉、功能、整站与运行时验收。
16. `G-13 MEMORY`：沉淀可复用规则。

## Existing 轨道

4. `E-01 BASELINE`：读取最新代码、运行时、真实页面、接口、状态、权限和计算样式，并生成可验证 Existing Baseline。
5. `E-02 CONSISTENCY`：消除代码、运行页面、数据和文档漂移。
6. `E-03 SITE_CONTRACT`：读取或提取整站契约，区分正式标准与历史遗留。
7. `E-04 FUNCTIONAL_FREEZE`：冻结必须保留、允许重排、允许调整、待确认删除和新增的功能链。
8. `E-05 IMPACT`：识别目标页、页面族、共享组件、CSS、API、角色和回归消费者。
9. `E-06 GATE_1`：校验改造范围、功能边界、整站约束和风险，汇入视觉方案确认。
10. `E-07 VISUAL`：在现有功能保护下确认视觉方案，生成、展示并确认可交互 Demo。
11. `E-08 SYNC_FREEZE`：Demo 确认后选择 Stitch 或直接代码；前者验证候选与 Demo 一致并封存，后者冻结 Demo 和代码目标。
12. `E-09 COMPILE`：编译与所选路线一致的 Visual Bundle、Page Delta / Rewrite、Implementation Map 和依赖锁。
13. `E-10 GATE_2`：机器校验后确认实现权限。
14. `E-11 IMPLEMENT`：按确认画布完整改造，禁止自行改版。
15. `E-12 PROOF_GATE`：验证目标页、真实功能与视觉一致性。
16. `E-13 REGRESSION`：验证页面族、共享消费者、整站 Shell、角色和响应式。
17. `E-14 GATE_3`：代码、运行时、页面、交互与整站验收。
18. `E-15 MEMORY`：沉淀可复用规则。

## 状态约束

- 状态真相源为 `.apex/runs/<run-id>/state.json`，结构见 `core/runtime/schemas/run-state.schema.json`。
- 新 Run 的产品方案及所选角色结论完成后才能生成视觉方案；Gate 1 在合并视觉方案确认时完成。
- 新 Run 未完成视觉方案与交互式 Demo 两次确认、路线选择、必要冻结、Visual Bundle 编译及机器 Gate 2，不得设置 implementationAllowed=true。Stitch 路线还须验证与已确认 Demo 的一致性；有差异时由用户作明确选择。
- Stitch、视觉描述、直接代码实施方案或 Site Contract 在确认后变化时，必须撤销 Gate 2 与实现权限，仅回退受影响阶段。
- 不再要求每一步向用户大段展示。完整轨迹进入运行产物；用户默认只看阶段、关键结论、风险、确认项和下一步。
- 恢复按有效 Checkpoint 继续，不得无条件从 APEX-01 重跑。
- 确认点的 `skip` 仅豁免当前人工确认：完整工件、哈希、机器 Gate 与后续确认仍为硬前置，
  且不会开放实施权限。`handoff` 才会进入 `handed-off` 生命周期：保存原阶段与原因、禁止
  下游动作、保留工件；`resume-handoff` 只能回到原确认点，不能改变 Gate、锁或实施权限。
