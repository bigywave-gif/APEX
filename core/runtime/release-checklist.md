# 发布检查清单

## 目的

用于检查当前 APEX 系统是否达到可对外迁移或可对外分发状态。

## 核心检查项

### 结构

- `manifest.yaml` 已更新
- `core/` 主框架完整
- `references/` 已区分 external 与 adopted
- `skills/` 已包含 APEX 自有且可再分发的宿主桥接；外部 Skill 必须在 `registry/host-skill-dependencies.json` 登记来源、许可、版本和安装命令
- `connectors/` 至少覆盖通用 web、框架化 SaaS、原生应用
- `registry/assets/` 已包含在线候选池与引用 / 依赖契约

### 元数据

- 外部来源具备来源信息
- 外部来源具备版本状态
- 外部来源具备许可状态
- 外部来源具备 packaging 边界
- 外部来源具备 `oss_readiness` 状态
- 外部来源具备 latest / best 评审模板
- 外部来源具备持续更新策略
- 在线素材类别完整，候选不带全局强制选型
- 每个在线候选存在官方入口与 resolver recipe，并明确标记 `executable`、`host-provided` 或 `metadata-only`；非 executable 来源不得被 Resolver 假装执行
- Visual 阶段要求生成完整 dependency lock
- Greenfield / Existing 双轨已定义
- Interactive / Autonomous 授权边界已定义
- Site Contract、Functional Freeze、Stitch Freeze、Visual Bundle、Implementation Map、Page Delta 与 Verification Bundle Schema 均可解析
- Stitch 用户编辑、确认后最新态同步、内容指纹冻结与确认后变化撤销已定义

### 执行

- 准入规则已存在
- 可访问性确认门已存在
- Gate 语义已存在
- 阈值策略已存在
- 恢复协议已存在
- 审计规格已存在
- 工具矩阵已存在
- 宿主能力治理已存在
- 插件与宿主能力清单已存在
- Gate 2 校验器可执行，缺失冻结产物时必须失败
- Checkpoint 恢复不得无条件从入口重跑
- Context Compiler 按阶段装载而不是重复加载全部上下文
- `scripts/preflight.mjs` 在干净当前用户目录中可执行
- `scripts/portable-install-contract-test.mjs` 证明无维护者绝对路径、Bridge 可发布且 Preflight 状态可解释

### 接入

- 至少一个匿名通用 adapter 和一个可公开运行的安装/接入夹具；私有真实项目 adapter 不属于发布条件
- 至少一个通用示例 adapter
- connector 选择说明已存在

### 发布边界

- 默认不内嵌受限第三方原文
- 仅打包自有规则与 adopted 规则
- 对外文档明确说明项目接入方式
- 若目标为“开源长期可用系统包”，所有必备能力必须达到 `oss-ready`，否则不视为发布级完成
- 不把第三方素材副本、凭据或项目锁文件打入 APEX Core

## 判定

- 以上任一核心项缺失，不视为发布级完成
