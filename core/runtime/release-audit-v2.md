# APEX 当前版本发布审查（以 manifest.version 为准）

## 已验证

- manifest版本与44个以上入口可解析且文件存在。
- Greenfield / Existing双轨、范围和授权模型已进入Core。
- Gate 2不再等同于视觉方向确认，必须验证结构化冻结产物。
- Site Contract、Functional Freeze、Stitch Freeze、Visual Bundle、Implementation Map、Page Delta、Dependency Lock和Verification Bundle Schema及示例均可解析。
- `apex-run.mjs`可初始化运行、登记产物、通过Gate 1、确认视觉、开放Gate 2、生成Checkpoint和撤销Stitch确认。
- `apex-validate.mjs`正向接受完整Existing运行，反向拒绝确认后Stitch变化。
- `stitch-sync.mjs`已通过真实Stitch MCP认证与项目列表调用，支持最新Screen读取、内容哈希、冻结和变化撤销。
- `asset-resolver.mjs`已通过npm官方Registry真实解析测试，能锁定版本、许可证、integrity和Peer Dependencies。
- Bundle编译、Proof、八类验证、Gate 3、Checkpoint与恢复撤销已完成端到端正反测试。
- Connector支持Stitch可编辑画布、最新态同步、内容指纹冻结和局部撤销。
- Student System Adapter包含真实代码、运行时、页面族、重启和五层验收映射。

## 外部运行依赖

- Stitch真实同步依赖宿主配置有效的Stitch MCP凭据；不可用时走人工冻结降级，不得伪造同步成功。
- 浏览器、服务重启、API与页面族回归由项目Adapter提供，APEX Core只定义编排与产物契约。
- 第三方素材在使用时解析版本、许可证和附属依赖，不打包素材副本。

## 判定

当前 APEX Core 已达到可执行流程包状态。具体项目要宣称交付完成，仍必须为当次运行生成真实产物并通过项目 Adapter 的 Gate 3；安装了 Core 不等于任何页面已被验证。
