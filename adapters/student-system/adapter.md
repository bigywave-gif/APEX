# Student System Adapter

Student System 是 APEX Existing 轨道的真实接入实例；只有完全独立的新产品任务才进入 Greenfield。

## 真相源

- 项目规则：`/Users/fredyw/code/student-system/AGENTS.md`
- 产品：`/Users/fredyw/code/student-system/PRODUCT.md`
- 设计：`/Users/fredyw/code/student-system/DESIGN.md`
- 前端项目投影：`/Users/fredyw/code/student-system/docs/domains/frontend/design-capability-architecture.md`
- 布局规范：`/Users/fredyw/code/student-system/docs/standards/frontend-layout-standardization.md`
- 设计系统采用：`/Users/fredyw/code/student-system/docs/standards/design-system-adoption.md`
- 运行记忆：`/Users/fredyw/code/student-system/docs/operations/agent-operational-memory.md`

## 运行时映射

- HTML入口：`index.html`
- 前端逻辑：`public/app.js`
- 教学渲染：`public/edu-renderer.js`
- 样式：`public/styles.css`
- 后端与API：`server.js`
- 学习链：`src/learningEngine.js`、`src/modelClient.js`、`src/agentClient.js`、`src/claudeCodeClient.js`
- 持久化：`data/student.json`
- 重启：`npm run restart:platform`

## 页面家族

- Workbench：首页、作业诊断
- Reading / Review：分析报告、知识巩固
- Focused Practice：习题训练
- Master Detail：历史错题
- Visualization：成长报告
- Management：权限管理、模型设置

每次运行必须在 `context-index.json` 记录目标路由、DOM / render函数、API、角色、数据状态、共享CSS和关联页面；不能只登记文件名。

## Existing 强制产物

- Site Contract：从 DESIGN.md、稳定代表页、共享样式和计算样式提取并版本化。
- Functional Freeze：功能到DOM、事件、API、状态、权限、刷新恢复和回归测试的完整映射。
- Page Delta：允许 `full-rewrite`，但必须声明保留、重排、删除、新增、Override和受影响消费者。
- Verification Bundle：覆盖目标页、页面族、Shell、共享消费者、角色和响应式。

## 真实验收

运行时代码修改后必须重启服务。Gate 3至少检查：

1. 代码：调用链、DOM、最终CSS覆盖和共享helper。
2. 运行时：新进程、健康检查、真实接口。
3. 页面：冻结Stitch画布、DOM骨架、计算样式、图标、表格、图表、动效和响应式。
4. 交互：刷新、路由、切页、展开、筛选、登录恢复、关键按钮。
5. 整站：同页面族、共享组件和CSS消费者无回归。

未完成真实浏览器验收时不得把静态检查标记为Gate 3通过。
