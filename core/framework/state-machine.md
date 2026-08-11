# APEX 双轨状态机

## 三个正交维度

- 轨道：`greenfield` 新项目 / `existing` 已有项目。
- 范围：`lite` / `standard` / `full`。
- 授权：`interactive` / `autonomous`。自主授权只减少等待，不得绕过 Gate 记录、功能删除确认、权限语义变化和破坏性操作授权。

## 公共入口

1. `APEX-01 INTENT`：编译用户短需求为 Intent Brief、默认假设、质量门槛与待确认项。
2. `APEX-02 CLASSIFY`：确定轨道、范围、授权、页面族和任务边界。
3. `APEX-03 PREFLIGHT`：验证 APEX、宿主、项目入口、在线素材注册表和必要工具。

在两个轨道进入正式视觉前，均须先完成需求分析拆解与视觉效果描述。Gate 1 与视觉实施方案确认通过后，Router 必须直接授权生成严格运行时效果图；效果图是可审阅工件而非第二个人工确认。生成工件完整登记后，用户才选择进入 Stitch 或直接代码。Stitch 是路线选择后的独立后续流，另有自己的确认；路线选择不能由“继续”推断，也不减少任何 Gate。

## Greenfield 轨道

4. `G-01 PRODUCT`：产品目标、角色、任务流、页面地图和数据实体。
5. `G-02 ARCHITECTURE`：技术栈、路由、状态、API、权限、组件与错误恢复。
6. `G-03 SITE_CONTRACT`：建立整站设计与产品契约。
7. `G-04 GATE_1`：确认产品、架构、范围、风险与验收边界。
8. `G-05 VISUAL`：展示需求拆解、视觉效果描述和视觉实施方案；方案确认后直接生成并登记严格运行时效果图。
9. `G-06 SYNC_FREEZE`：效果图工件登记后，用户选择进入独立的 Stitch 生成与 Stitch 确认，或直接代码；前者确认后暂存并 Seal 最新 Stitch 画布、HTML、完整截图与内容指纹，后者冻结效果图、代码目标和直接代码实施方案。
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
9. `E-06 GATE_1`：确认改造范围、功能边界、整站约束和风险。
10. `E-07 VISUAL`：在 Site Contract 和功能保护下展示需求拆解、视觉效果描述和视觉实施方案；方案确认后直接生成并登记严格运行时效果图。
11. `E-08 SYNC_FREEZE`：效果图工件登记后，用户选择进入独立的 Stitch 生成与 Stitch 确认，或直接代码；前者确认后暂存并 Seal 用户编辑后的最新 Stitch 画布、HTML 与完整截图，后者冻结效果图、代码目标和直接代码实施方案。
12. `E-09 COMPILE`：编译与所选路线一致的 Visual Bundle、Page Delta / Rewrite、Implementation Map 和依赖锁。
13. `E-10 GATE_2`：机器校验后确认实现权限。
14. `E-11 IMPLEMENT`：按确认画布完整改造，禁止自行改版。
15. `E-12 PROOF_GATE`：验证目标页、真实功能与视觉一致性。
16. `E-13 REGRESSION`：验证页面族、共享消费者、整站 Shell、角色和响应式。
17. `E-14 GATE_3`：代码、运行时、页面、交互与整站验收。
18. `E-15 MEMORY`：沉淀可复用规则。

## 状态约束

- 状态真相源为 `.apex/runs/<run-id>/state.json`，结构见 `core/runtime/schemas/run-state.schema.json`。
- 未通过 Gate 1，不得生成供确认的正式视觉方案。
- 未完成全部共同确认、严格运行时效果图登记、所选后续路线的必要冻结、Visual Bundle 编译和 Gate 2，不得设置 implementationAllowed=true。所有路线必须依次完成视觉实施方案确认与效果图生成；Stitch 路线还必须完成 Stitch 确认、严格效果图→Stitch 校验与 Seal，直接代码路线还必须完成直接代码实施方案确认。
- Stitch、视觉描述、直接代码实施方案或 Site Contract 在确认后变化时，必须撤销 Gate 2 与实现权限，仅回退受影响阶段。
- 不再要求每一步向用户大段展示。完整轨迹进入运行产物；用户默认只看阶段、关键结论、风险、确认项和下一步。
- 恢复按有效 Checkpoint 继续，不得无条件从 APEX-01 重跑。
- 确认点的 `skip` 仅豁免当前人工确认：完整工件、哈希、机器 Gate 与后续确认仍为硬前置，
  且不会开放实施权限。`handoff` 才会进入 `handed-off` 生命周期：保存原阶段与原因、禁止
  下游动作、保留工件；`resume-handoff` 只能回到原确认点，不能改变 Gate、锁或实施权限。
