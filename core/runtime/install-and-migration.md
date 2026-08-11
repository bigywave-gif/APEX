# 安装与迁移

## 最小安装内容

必须带走：

- `system-docs/`
- `core/`
- `references/`
- `skills/`
- `connectors/`
- `manifest.yaml`

## 新项目接入步骤

1. 复制 `apex/`
2. 先阅读 `system-docs/` 主文档
3. 再阅读调用协议、准入规则、优先级模型与宿主能力治理
4. 选择最接近的 `connector`
5. 新建项目自己的 `adapter`
6. 映射产品真相源、设计真相源、代码入口、验收方式
7. 按统一调用协议使用

## 升级原则

- `core/` 升级优先保持向下兼容
- 项目侧 `adapter` 尽量薄，不复制 core 规则
- 第三方规范升级时，先更新 `references/external`，再更新 `references/adopted`
