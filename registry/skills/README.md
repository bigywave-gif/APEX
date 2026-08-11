# APEX Skills Layer

本目录描述 APEX 在执行时可调用的 skill 层，不等于这些 skill 必须全部同时启用。

原则：

- 先结构，后审美，最后动效
- skill 不能替代 APEX 状态机
- skill 只能在被路由命中时启用
- 若目标是“开源长期可用 APEX 包”，则 skill 默认视为可选增强，不得在未确认公开源码与许可前列为硬依赖

当前技能真相源：

- [manifest.yaml](https://github.com/bigywave-gif/APEX/blob/main/registry/skills/manifest.yaml)

当前默认设计契约 skill：

- `google-design-md`
  - 角色：官方 `DESIGN.md` 协议包装层
  - 定位：设计契约基线，不替代 APEX Core
  - 用途：把 `google-labs-code/design.md` 的规范正式接入 APEX 的 Audit / Visual / Implement / Verify 链路

补充说明：

- 当前 APEX 已采用一批更稳定的开源增强层底座，见：
  - [../references/adopted/adopted-design-rules.md](https://github.com/bigywave-gif/APEX/blob/main/references/adopted/adopted-design-rules.md)
  - [../references/external/source-review-records.md](https://github.com/bigywave-gif/APEX/blob/main/references/external/source-review-records.md)
- 这意味着 skill 层不再单独承担全部设计、图标、动效、无障碍和组件文档化职责
- skill 负责执行强化，增强层底座负责提供更稳定的规范参考
