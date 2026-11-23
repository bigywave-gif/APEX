# Skill Conflict Matrix

## 目的

说明不同 skill 在什么条件下会冲突，应该如何路由。

## 冲突规则

### 结构未确认时

视觉任务仍须加载 `taste-skill`，用于场景适用的审美判断；它不得替代产品结构判断。

结构未明确时，禁止启用 `react-bits` 和 `motion-ai-kit` 作为主导动效能力。产品结构形成后，按任务与真实功能需要选择动效。

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
