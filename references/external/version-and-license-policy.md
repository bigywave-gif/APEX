# Version And License Policy

## 目的

定义 APEX 对外部规范、开源组件、skill 来源的版本与许可处理方式。

## 版本策略

- 外部来源默认不自动升级
- 升级前先检查：
  - 能力是否仍适配 APEX
  - 是否会影响 adopted 规则
  - 是否改变调用方式或语义边界
- 升级后必须同步更新：
  - `sources.yaml`
  - `adoption-boundaries.md`
  - `references/adopted/` 相关提炼文档

## 许可策略

- 外部来源进入 APEX 前，必须确认其可用于参考或集成
- 如果外部来源仅可学习参考，不能把原始内容直接内嵌为 APEX 正式规则
- 任何需要对外发布的系统包，都应单独保留来源与许可记录

## 发布策略

- APEX Core 对外打包时，默认只带：
  - 自有规则
  - 自有 adopted 规则
  - 外部来源清单与边界说明
- 默认不内嵌第三方受限原文
