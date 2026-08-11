# Skill Conflict Matrix

## 目的

说明不同 skill 在什么条件下会冲突，应该如何路由。

## 冲突规则

### 结构未确认时

禁止优先启用：

- `taste-skill`
- `react-bits`
- `motion-ai-kit`

原因：

- 它们偏审美和动效增强，不应覆盖结构判断

### 未进入实现时

不应让以下 skill 主导：

- `andrej-karpathy-skills`

原因：

- 它负责工程纪律，不负责视觉方向裁决

### 组件语言未确认时

`shadcn-ui-reference` 只能作为参考，不应推动技术栈迁移。

## 路由优先级

1. `impeccable`
2. `ui-ux-pro-max-skill`
3. `taste-skill`
4. `better-icons`
5. `react-bits / motion-ai-kit`
6. `shadcn-ui-reference`
7. `andrej-karpathy-skills`
