# APEX 实现模板

实现开始前必须执行：

```bash
node <APEX_ROOT>/scripts/apex-validate.mjs gate2 .apex/runs/<run-id>
```

实现只能消费已冻结的 Site Contract、Functional Freeze、Stitch Freeze、Visual Bundle、Implementation Map 与 Dependency Lock。允许按确认效果图完整重构目标页面，但不得自行改变确认布局、删除未授权功能、替换素材或修改整站契约。

来源失效、画布变化、Site Contract变化、不可实现或功能冲突时，撤销受影响范围的 Gate 2 并回到对应阶段；禁止用近似实现静默代替。
