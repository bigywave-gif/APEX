# APEX 打包指南

## 目的

说明如何把当前 `apex/` 目录作为一套通用系统包迁移到其他项目。

## 最小打包范围

必须包含：

- `README.md`
- `INDEX.md`
- `manifest.yaml`
- `system-docs/`
- `core/`
- `runtime/`
- `registry/`
- `references/`
- `connectors/`

可选包含：

- `adapters/examples/`

## 打包建议

### 对外发布通用包

建议包含：

- `system-docs/`
- `core/`
- `runtime/`
- `registry/`
- `references/`
- `connectors/`
- `adapters/examples/`

建议不默认包含：

- 与当前项目强绑定的私有接入层

### 项目内迁移包

具体业务项目的 Adapter 与参考实现只能在获得相应项目授权后随项目私有迁移，不进入 APEX 通用公开包。

## 接入新项目步骤

1. 复制 `apex/`
2. 阅读 [README.md](https://github.com/bigywave-gif/APEX/blob/main/README.md) 与 [INDEX.md](https://github.com/bigywave-gif/APEX/blob/main/INDEX.md)
3. 选择合适的 connector
4. 基于 `adapters/examples/` 新建项目 adapter
5. 映射产品、设计、代码入口、验收链路

## 发布前检查

发布前至少完成：

1. 运行 [release-checklist.md](https://github.com/bigywave-gif/APEX/blob/main/core/runtime/release-checklist.md)
2. 检查第三方来源与 adopted 规则是否一致
3. 检查 manifest 是否覆盖当前入口
4. 检查 examples 是否仍可用

## 推荐发布结构

对外或跨项目迁移时，推荐保留如下结构：

```text
apex/
  README.md
  INDEX.md
  PACKAGING.md
  manifest.yaml
  system-docs/
  core/
  runtime/
  registry/
  references/
  connectors/
  adapters/
```

其中：

- `adapters/examples/` 适合一起发布
- 具体业务项目 Adapter 默认排除，仅随已授权的项目私有迁移

## 不应混入通用包的内容

以下内容不应被打进 APEX 通用包：

- 任意具体项目的业务代码
- 任意项目运行数据、缓存、日志
- 任意项目私有部署凭据
- 仅对单项目有效的临时排障记录

## 迁移后的首轮校验

目标项目接入后，至少要补四件事：

1. 选择或新建正确的 `connector`
2. 新建项目 `adapter`
3. 更新项目入口文档，指向 `apex/README.md`
4. 用一条真实需求跑完 `APEX -> Gate 1 -> Gate 2 -> Gate 3`
