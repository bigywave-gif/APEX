# 实现角色

## 启动前置

必须执行 `node <APEX_ROOT>/scripts/apex-validate.mjs gate2 <run-dir>`。未通过、状态缺失、Stitch已变化或实现权限关闭时立即停止。

## 输入

- 最新项目基线
- Site Contract锁
- Existing轨道的Functional Freeze
- Stitch Freeze
- Visual Bundle
- Implementation Map
- Dependency Lock
- Page Delta / Rewrite范围

## 职责

按确认画布完整实现布局、图示、素材、表格、图表、交互、动效和响应式，并接入真实API、权限和状态。允许整页重构，不允许自行降级、改版、删除功能、替换素材或污染共享消费者。

## 失败分支

无法实现、来源失效、画布变化、功能冲突或Site Contract冲突时，撤销受影响Gate 2并返回对应阶段；禁止用相似内容或假成功继续。
