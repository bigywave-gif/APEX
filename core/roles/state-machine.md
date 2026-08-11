# APEX 双轨状态机

## 三个正交维度

- 轨道：`greenfield` 新项目 / `existing` 已有项目。
- 范围：`lite` / `standard` / `full`。
- 授权：`interactive` / `autonomous`。自主授权只减少等待，不得绕过 Gate 记录、功能删除确认、权限语义变化和破坏性操作授权。

## 公共入口

1. `APEX-01 INTENT`：编译用户短需求为 Intent Brief、默认假设、质量门槛与待确认项。
2. `APEX-02 CLASSIFY`：确定轨道、范围、授权、页面族和任务边界。
3. `APEX-03 PREFLIGHT`：验证 APEX、宿主、项目入口、在线素材注册表和必要工具。

## Greenfield 轨道

4. `G-01 PRODUCT`：产品目标、角色、任务流、页面地图和数据实体。
5. `G-02 ARCHITECTURE`：技术栈、路由、状态、API、权限、组件与错误恢复。
6. `G-03 SITE_CONTRACT`：建立整站设计与产品契约。
7. `G-04 GATE_1`：确认产品、架构、范围、风险与验收边界。
8. `G-05 VISUAL`：生成代表页和必要状态；可调用 Stitch。
9. `G-06 SYNC_FREEZE`：读取用户确认的最新画布，冻结 Screen 集合与内容指纹。
10. `G-07 COMPILE`：编译 Visual Bundle、Implementation Map、Data / Motion / Responsive Contract 和依赖锁。
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
10. `E-07 VISUAL`：在 Site Contract 和功能保护下允许完整重构目标页面；可调用 Stitch。
11. `E-08 SYNC_FREEZE`：读取用户编辑后的最新画布并冻结。
12. `E-09 COMPILE`：编译 Visual Bundle、Page Delta / Rewrite、Implementation Map 和依赖锁。
13. `E-10 GATE_2`：机器校验后确认实现权限。
14. `E-11 IMPLEMENT`：按确认画布完整改造，禁止自行改版。
15. `E-12 PROOF_GATE`：验证目标页、真实功能与视觉一致性。
16. `E-13 REGRESSION`：验证页面族、共享消费者、整站 Shell、角色和响应式。
17. `E-14 GATE_3`：代码、运行时、页面、交互与整站验收。
18. `E-15 MEMORY`：沉淀可复用规则。

## 状态约束

- 状态真相源为 `.apex/runs/<run-id>/state.json`，结构见 `core/runtime/schemas/run-state.schema.json`。
- 未通过 Gate 1，不得生成供确认的正式视觉方案。
- 未完成最新态同步、Visual Bundle 编译和 Gate 2，不得设置 `implementationAllowed=true`。
- Stitch 或 Site Contract 在确认后变化时，必须撤销 Gate 2 与实现权限，仅回退受影响阶段。
- 不再要求每一步向用户大段展示。完整轨迹进入运行产物；用户默认只看阶段、关键结论、风险、确认项和下一步。
- 恢复按有效 Checkpoint 继续，不得无条件从 APEX-01 重跑。
