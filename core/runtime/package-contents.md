# 包内容清单

## 最小通用包

必须包含：

- `README.md`
- `INDEX.md`
- `PACKAGING.md`
- `manifest.yaml`
- `package.json`
- `system-docs/`
- `core/`
- `references/`
- `registry/`，其中必须包含 `registry/assets/online-sources.yaml` 与 `registry/assets/contract.md`
- `skills/`
- `connectors/`
- `scripts/apex-validate.mjs`
- `scripts/apex-paths.mjs`
- `scripts/install.mjs`
- `scripts/preflight.mjs`
- `scripts/portable-install-contract-test.mjs`
- `scripts/apex-run.mjs`
- `scripts/stitch-sync.mjs`
- `scripts/visual-reference-compiler.mjs`
- `scripts/visual-parity.mjs`
- `scripts/structure-contract.mjs`
- `scripts/strict-replica.mjs`
- `scripts/bundle-compiler.mjs`
- `scripts/asset-resolver.mjs`
- `scripts/asset-materializer.mjs`
- `scripts/runtime-materializer.mjs`
- `scripts/context-compiler.mjs`
- `scripts/verification-orchestrator.mjs`
- `scripts/apex-recover.mjs`
- `scripts/project-intake.mjs`
- `scripts/contract-recorder.mjs`
- `scripts/contract-verifier.mjs`
- `scripts/verification-planner.mjs`
- `scripts/quality-evidence.mjs`
- `scripts/browser-capture.mjs`
- `core/runtime/strict-replica.md`
- `core/templates/gate1-visual-output.example.json`
- `scripts/release-audit.mjs`
- `core/runtime/schemas/`

## 推荐附带

- `adapters/examples/`
- 至少一个匿名、可公开、可执行的跨用户安装测试夹具

## 项目专属内容

具体项目 Adapter、运行态和业务代码由项目自身保存，不进入 APEX 通用安装包。

## 不建议放入通用包的内容

- 当前项目业务代码
- 当前项目私有运行数据
- 当前项目非通用排障记忆
- 第三方素材文件副本、API Key、下载缓存和项目级 Visual Bundle lock
