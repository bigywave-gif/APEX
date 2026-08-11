# Skill Activation Matrix

## 目的

定义不同任务阶段该启用哪些 skill，避免全量乱开。

## Intent / Baseline 阶段

- 默认启用：
  - `design-director`
  - `google-design-md`
- 可选启用：
  - `ui-ux-pro-max-skill`（仅在页面视觉方向需要提案时）
  - `impeccable`（仅在 Existing 视觉审计时）

## Plan 阶段

- 默认启用：
  - `google-design-md`
  - `design-director`
- 按需启用：
  - `ui-ux-pro-max-skill`
  - `impeccable`
  - `taste-skill`
  - `doc-coauthoring`（仅当用户未确认而提出调整时：提取自由反馈中的保留/删除/修改偏好，更新未确认工件；不增加确认点）

## Visual 阶段

- 默认启用：
  - `google-design-md`
  - `design-director`
- 按需启用：
  - `impeccable`
  - `ui-ux-pro-max-skill`
  - `taste-skill`
  - `stitch-design`（高保真方向探索、同骨架变体、交互原型；仅在 Gate 1 后启用）
  - `better-icons`
  - `react-bits`
  - `motion-ai-kit`
  - `shadcn-ui-reference`

## Implement 阶段

- 默认启用：
  - `google-design-md`
  - `andrej-karpathy-skills`
- 按需启用：
  - `shadcn-ui-reference`

## Verify 阶段

- 默认启用：
  - `google-design-md`
  - `andrej-karpathy-skills`

## 强约束

- 未完成结构确认前，不启用动效类 skill
- 未形成项目事实包与 DESIGN.md 前，不启用 `stitch-design`
- `stitch-design` 输出不拥有 Gate 裁决权，也不得直接进入生产实现
- 未进入实现前，不把工程纪律 skill 当成主导视觉的能力
