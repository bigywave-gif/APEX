# 安装与迁移

## 最小安装内容

必须带走：

- `README.md`、`INDEX.md`、`PACKAGING.md`
- `system-docs/`
- `core/`
- `references/`
- `skills/`
- `connectors/`
- `registry/`
- `runtime/`
- `scripts/`
- `adapters/examples/`
- `manifest.yaml`
- `package.json`

不得把私有项目 adapter、运行目录、截图、缓存、凭据或项目业务代码作为通用安装依赖。

## 标准安装

```bash
git clone https://github.com/bigywave-gif/APEX.git
cd APEX
npm run install:apex
npm run preflight
```

安装器只在当前用户的 `<CODEX_HOME>/apex/APEX` 为空时复制 Core，并发布全局 Bridge；不会覆盖已有 Core，不会自动安装第三方 Skill，也不会修改业务项目。若 Preflight 报告缺少外部 Skill，按 `registry/host-skill-dependencies.json` 中的精确来源显式安装，重启宿主后再次运行 Preflight。

## 验证与卸载

- `npm run status`：输出当前 Core、Bridge、工具与 Skill 的真实状态。
- `npm test`：执行跨用户安装合同与 Router 回归合同。
- 卸载前先确认 `<CODEX_HOME>/apex/APEX/.apex-install.json` 属于本次安装；随后人工移除该精确目录及 `<CODEX_HOME>/skills/apex/`。APEX 不提供自动递归删除命令。

## 新项目接入步骤

1. 完成标准安装与可执行 Preflight
2. 阅读 `system-docs/` 主文档
3. 阅读调用协议、准入规则、优先级模型与宿主能力治理
4. 选择最接近的 `connector`
5. 新建项目自己的 `adapter`
6. 映射产品真相源、设计真相源、代码入口、验收方式
7. 按统一调用协议使用

## 升级原则

- `core/` 升级优先保持向下兼容
- 项目侧 `adapter` 尽量薄，不复制 core 规则
- 第三方规范升级时，先更新 `references/external`，再更新 `references/adopted`
- 升级后必须重新发布 Bridge、执行 Preflight、跨用户安装合同和 Router 合同；失败时保留旧版本，不覆盖可用安装
