# APEX 可执行确认门

## Gate 0：准入门

必须验证 APEX 根目录、manifest、宿主工具、项目入口、在线素材注册表和运行目录可用。

## Gate 1：需求、基线与改造边界门

Greenfield 必须具备 Product Brief、页面地图、技术架构草案和 Site Contract；Existing 必须具备真实基线、Site Contract、Functional Freeze 与影响范围。Gate 1 通过前不得输出可进入实现的正式视觉方案。

## Gate 2：可执行设计冻结门

Gate 2 不是“风格方向同意”，必须同时满足：

1. 用户确认范围明确到项目、Screen、状态和视口。
2. 已在确认动作后重新读取 Stitch 最新屏幕、HTML、截图与设计系统。
3. `stitch-freeze.json` 含内容指纹，且当前远端未发生确认后变化。
4. Site Contract 已锁定版本与哈希。
5. Existing 任务的 Functional Freeze 完整，功能删除均有独立授权。
6. Visual Bundle 包含布局、组件、数据、素材、图表、图示、动效、交互、响应式、实现映射与验收契约。
7. 所有视觉关键素材都有可解析 `assetRef` 和完整 `dependencyLock`。
8. 可实现性、事实一致性、可访问性与运行时适配校验通过。
9. `scripts/apex-validate.mjs gate2 <run-dir>` 返回成功。

只有全部通过才允许将 `implementationAllowed` 设置为 `true`。

## Proof Gate：代表页证明门

适用于所有 Greenfield，以及包含整页重构、页面族、共享组件、复杂图表或复杂动效的 Existing 任务。必须在真实浏览器验证视觉、数据、功能、响应式、动效、性能与控制台状态。

## Gate 3：真实交付门

必须同时通过：

- 代码层：调用链、DOM、共享依赖、样式覆盖和改动范围。
- 运行时层：新代码已被真实服务加载，接口返回正确。
- 页面层：与冻结 Stitch 画布和 Visual Bundle 对比通过。
- 交互层：关键操作、刷新、路由、权限和状态恢复通过。
- 整站层：页面族、共享组件消费者、Shell、角色和响应式无回归。
- 记录层：Verification Bundle 完整，未完成项不得包装成成功。

## 变化后的撤销规则

- 文案或数据映射变化：局部重新编译与验证。
- 视觉细节变化：撤销对应 Screen 的视觉确认。
- 布局、交互、素材或动效变化：撤销对应 Screen 的 Gate 2。
- Site Contract、共享组件、权限或功能语义变化：撤销所有受影响页面的 Gate 2，并重新计算影响范围。
