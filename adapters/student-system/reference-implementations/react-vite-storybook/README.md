# Student System React / Vite / Storybook 参考实现

本目录保存从 Student System 项目迁出的历史组件化探索代码，供 APEX 在需要评估 React、HeroUI、Radix、Framer Motion、Tailwind 或 Storybook 时参考。

## 使用边界

- 本目录不是 Student System 的生产入口，也不是 APEX Core 的运行时依赖。
- 不得从本目录直接启动或部署 Student System。
- 真实项目事实始终以 Student System 当前的 `index.html + public/app.js + public/edu-renderer.js + public/styles.css` 为准。
- 使用任何参考代码前，必须先通过 APEX 的运行时适配和依赖解析门。
- React-only 组件不得直接进入 Vanilla JavaScript 项目；应转换为当前运行时可维护的实现。

## 内容

- `react-stack/`：历史 React 页面、组件、状态和样例代码。
- `config/`：Vite、Storybook、Tailwind、PostCSS、TypeScript 与组件工具配置。

## 恢复来源

原始路径清单与迁移记录保存在 Student System 的交付文档中。迁入日期：2026-07-14。
