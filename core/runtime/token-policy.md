# APEX Context Compiler 与 Token 策略

## 单一上下文索引

`.apex/runs/<run-id>/context-index.json` 记录事实来源、摘要、哈希、所属阶段和失效条件。未变化内容引用摘要与路径，不重复全文加载。

## 按阶段装载

- Intake：需求、项目入口、轨道判定资料。
- Baseline：目标页面、运行入口、API、状态、权限和必要项目文档。
- Visual：Site Contract、页面事实、Functional Freeze及当前需要的素材类别。
- Implement：已确认Visual Bundle、Implementation Map、目标代码与关联消费者。
- Verify：验收契约、改动文件、目标页、关联页面和运行命令。

不得在每轮加载全部代码、全部历史记忆、全部Skill说明或完整素材候选池。在线素材按类别和任务检索，只把入选项与比较摘要写入Bundle。

## 预算与降级边界

- 每个阶段开始前只装载完成该阶段 Gate 所需的最小证据集；新增上下文必须说明其所属阶段、来源和必要性。
- 预算紧张时，先复用 `context-index.json`、已确认契约、内容哈希和 Checkpoint；其次缩小当前待解决问题；不得跳过准入、Gate、严格 1:1 校验、真实验收或恢复记录。

## 执行 I/O 快路径

普通状态查询、自动串行阶段与未改变的 Existing 基线重试必须优先读取 `state.json`、`context-index.json`、`operations-index.json` 与 `source-integrity-index.json`，不得因轮询而重扫整个项目或遍历全部 operation receipt。`source-integrity-index.json` 只能以路径、文件指纹和上次已验证 SHA-256 复用不可变代码快照；它不构成 Gate 证据。Gate 1、Gate 2、Gate 3、运行时 Demo 登记和实施授权仍必须重新计算其规定范围的完整 SHA-256，缓存失效、缺失或旧版 receipt 时必须退回权威校验，不能以文件时间戳或索引替代。
- 需要扩大上下文、重跑上游阶段或进行大范围探索时，应先形成明确范围与预期产物；无法在既定预算内保证质量时，Router 应返回 `blocked` 或要求重新定界，而不是输出未经验证的结论。
- 禁止为了压缩 token 而重复粘贴完整历史、无差别扫描整个代码库、并行生成多个无验收路径的方案，或把用户提供的事实替换为推测。

## 输出策略

完整审计写入运行产物；用户默认只看到阶段、关键结论、风险、确认项和下一步。旧规则“每一步必须大段显示”被本策略取代。

## 增量与失效

摘要必须绑定内容哈希。代码、Site Contract、Stitch或用户决策变化时，仅失效依赖该输入的摘要和下游产物。Token不足或任务中断时使用Checkpoint恢复，不重新复述整个框架。
