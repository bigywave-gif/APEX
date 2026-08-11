# APEX Preflight

## 目的

定义 `Codex -> APEX` 正式执行前必须先完成的轻量检查。

本检查不是安装器，也不是项目级工作流本身。它只负责回答三件事：

1. 当前宿主是否已发现 `APEX`
2. 当前宿主是否具备运行 APEX 的最小能力
3. 当前宿主是否已安装 APEX 所声明的关键增强层能力

## 输入

- `manifest.yaml`
- `registry/required-capabilities.yaml`
- `registry/optional-capabilities.yaml`
- 当前宿主暴露出的 skill / plugin / tool 元信息
- `registry/assets/online-sources.yaml`（若任务可能进入 Visual）

## 输出

标准输出结构：

```text
APEX Preflight
host:
apex_root:
apex_version:
required:
optional:
missing:
next_action:
```

## 判定规则

### `ready`

- APEX 根目录可发现
- `manifest.yaml` 可读
- 必需能力全部满足

### `ready-with-risks`

- 必需能力满足
- 可选增强能力存在缺失

### `blocked`

满足以下任一项：

- APEX 根目录不可发现
- `manifest.yaml` 不可读
- 缺少必需 skill
- 缺少必需宿主工具能力

## 执行顺序

1. 检查 APEX 根目录是否存在
2. 检查 `manifest.yaml` 是否存在且入口有效
3. 加载必需能力清单
4. 读取宿主当前能力
5. 对比并输出判定
6. 若任务可能进入 Visual，检查在线素材注册表是否可读、类别是否完整、每个候选是否存在 resolver recipe
7. 若存在缺失项，先提示，再决定是否继续

## 强约束

- `Preflight` 不替代 APEX 主流程
- `Preflight` 不读取具体项目代码做产品判断
- `Preflight` 只检查宿主与 APEX 本体的可运行性
- `Preflight` 只验证在线素材注册表结构，不提前强制选择素材来源；实际依赖解析在 Visual 阶段按任务执行
