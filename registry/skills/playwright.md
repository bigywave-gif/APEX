# Playwright

## 定位

Playwright 是 APEX 在运行态页面、交互流程和浏览器行为验收阶段使用的可选增强 skill。

## 唯一安装位置

`~/.codex/skills/playwright/SKILL.md`

APEX 只登记并调用该全局 skill，不在 APEX 包、适配器或目标项目内维护 Playwright skill 副本。

## 使用边界

- 用于真实浏览器导航、表单操作、截图、DOM 状态和交互流程验证。
- 不能替代 APEX Gate、运行时重启、接口检查或人工确认门。
- 浏览器缓存、会话目录、截图和调试日志不能写入目标项目源码目录；应进入宿主临时目录或任务产物目录。
- Playwright npm 包只在确有独立脚本运行需求的环境中按清单安装，不作为宿主业务项目的默认平台依赖。
