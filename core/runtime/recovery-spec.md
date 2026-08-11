# APEX Checkpoint 恢复协议

## 运行真相源

恢复只读取 `.apex/runs/<run-id>/state.json`、`context-index.json`、`decisions.json`、产物哈希与 `checkpoints/`。对话摘要不是唯一恢复依据。

## Checkpoint 内容

- 阶段与Gate状态
- 输入文件路径和内容哈希
- Site Contract、Functional Freeze、Stitch Freeze与Visual Bundle哈希
- 用户决策与授权范围
- 已完成验证和未完成项
- 下一合法状态

## 恢复算法

1. 验证运行状态Schema。
2. 验证最近Checkpoint引用的产物仍存在。
3. 比较代码、Site Contract、Stitch Freeze和关键输入哈希。
4. 未变化阶段直接复用；变化时只撤销受影响阶段及下游Gate。
5. 进入实现前重新执行Gate 2机器校验。

恢复时默认只向用户输出当前阶段、已保留Gate、被撤销内容、原因和下一步。禁止无条件回到入口重做全部分析。
