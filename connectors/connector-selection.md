# Connector Selection

## 目的

帮助新项目选择最接近的 connector，避免错误接入。

## 选择规则

### `generic-web-app`

适合：

- 页面形态较多
- 技术栈混合
- 暂时不想强绑定某一框架

### `react-saas`

适合：

- React 组件化系统
- 设计系统和业务组件边界清晰

### `vue-admin`

适合：

- Vue 管理后台
- 强表单、强配置、强后台治理页面

### `vanilla-js-app`

适合：

- 单入口
- 原生 DOM 驱动
- 没有现代组件框架

## 默认规则

- 不确定时，先选 `generic-web-app`
- 如果真实入口是 `index.html + app.js + styles.css` 这类结构，优先 `vanilla-js-app`
