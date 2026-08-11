# APEX 可执行确认门

## Gate 0：准入门

必须验证 APEX 根目录、manifest、宿主工具、项目入口、在线素材注册表和运行目录可用。

## Gate 1：需求、基线与改造边界门

Greenfield 必须具备 Product Brief、页面地图、技术架构草案和 Site Contract；Existing 必须具备真实基线、Site Contract、Functional Freeze 与影响范围。Gate 1 通过前不得输出可进入实现的正式视觉方案。

## Gate 2：可执行设计冻结门

Gate 2 不是“风格方向同意”，必须同时满足：

1. 用户确认范围明确到项目、Screen、状态和视口。
2. 已在确认动作后暂存 Stitch 最新屏幕、HTML、明确标识的完整截图与设计系统；暂存不自动授予实现权威。
3. Gate 1 视觉合同与效果图同源，包含中文内容、布局节点、组件、token 与图表参数合同；自动结构合同与严格证据已证明 Stitch 截图零像素匹配，且 DOM 标记、表格、节点顺序、图表编码、组件和 token 均匹配。
4. strict-replica Stitch 阶段已通过并 Seal；stitch-freeze.json 含内容指纹，且当前远端未发生确认后变化。
5. Site Contract 已锁定版本与哈希。
6. Existing 任务的 Functional Freeze 完整，功能删除均有独立授权。
7. Visual Bundle 包含布局、组件、数据、素材、图表、图示、动效、交互、响应式、实现映射与验收契约。
8. 所有视觉关键素材都有可解析 `assetRef` 和完整 `dependencyLock`。
9. 若视觉实施方案选择 3D/WebGL，Three/Babylon 等运行时、精确版本、模型/纹理/环境资源、渲染器、性能预算、静态降级与 reduced-motion 均已冻结并进入 dependency lock。
10. 可实现性、事实一致性、可访问性与运行时适配校验通过。
11. 响应式合同已覆盖 mobile、tablet、desktop，且 Visual Bundle 的合同 ID 与已确认视觉方案一致。
10. `scripts/apex-validate.mjs gate2 <run-dir>` 返回成功。

只有全部通过才允许将 `implementationAllowed` 设置为 `true`。

## Proof Gate：代表页证明门

适用于所有 APEX 交付。必须在真实浏览器验证视觉、数据、功能、响应式、动效、性能与控制台状态；自动浏览器采集必须保存运行时 DOM 与截图；implementation-parity-evidence.json 必须证明运行代码截图零像素匹配冻结 Stitch 截图，或在用户明确跳过整个 Stitch 阶段时零像素匹配已确认效果图，且自动结构合同和 token/图表/组件标记一致。

## Gate 3：真实交付门

必须同时通过：

- 代码层：调用链、DOM、共享依赖、样式覆盖和改动范围。
- 运行时层：新代码已被真实服务加载，接口返回正确。
- 页面层：与冻结 Stitch 画布和 Visual Bundle 对比通过。
- 响应式层：mobile、tablet、desktop 的每个宽度区间均有最小/中间/最大真实截图，且绑定同一响应式合同，无未声明的横向溢出、裁切、重叠、文字不可读或比例漂移。
- 3D 层（适用时）：每个冻结场景均有实际 renderer 截图、性能、静态降级及 reduced-motion 运行证据；仅有设计稿或库声明不能通过。
- 交互层：关键操作、刷新、路由、权限和状态恢复通过。
- 整站层：页面族、共享组件消费者、Shell、角色和响应式无回归。
- 记录层：Verification Bundle 完整，未完成项不得包装成成功。

## 变化后的撤销规则

- 文案或数据映射变化：局部重新编译与验证。
- 视觉细节变化：撤销对应 Screen 的视觉确认。
- 布局、交互、素材或动效变化：撤销对应 Screen 的 Gate 2。
- Site Contract、共享组件、权限或功能语义变化：撤销所有受影响页面的 Gate 2，并重新计算影响范围。

## 用户跳过确认点

用户可在任一等待确认的 Gate 1、效果图、Stitch 或实施冻结点使用 `skip` 跳过当前的
人工确认并进入下一阶段。Router 必须登记决策 ID、原因、必需工件哈希和影响；只能在
该点的完整工件与校验已经存在时执行。它不放行任何机器 Gate、严格保真校验、后续确认或
实现权限，尤其不得绕过 Gate 2 或将未验证结果称为严格 1:1 交付。

`skip stitch` 仅豁免确认，不替代 Stitch 产物。用户明确要求跳过整个 Stitch 步骤时，
`skip-stage stitch` 以已确认效果图作为直接实施基线；该例外不跳过来源追溯、实施确认、
Gate 2 或 Gate 3。

用户若要暂停/交接而非继续，使用 `handoff`；此时 run 进入 `handed-off`，下游动作关闭，
可用 `resume-handoff` 回到原确认点。
