# Playwright

## 定位

Playwright 是 APEX 在运行态页面、交互流程和浏览器行为验收阶段使用的可选增强 skill。

## 唯一安装位置

`~/.codex/skills/playwright/SKILL.md`

APEX 只登记并调用该全局 skill，不在 APEX 包、适配器或目标项目内维护 Playwright skill 副本。

## 使用边界

- 用于真实浏览器导航、表单操作、截图、DOM 状态和交互流程验证。
- 不能替代 APEX Gate、运行时重启、接口检查或人工确认门。
- 浏览器二进制可作为只读共享工具安装；但每次 APEX 调用产生的 daemon 会话、浏览器 profile、截图和调试日志必须隔离到当前项目 `.apex/runs/<run-id>/`。不得依赖或写入用户级 `~/Library/Caches/ms-playwright/daemon`，以避免权限错误和跨项目会话污染。
- Playwright npm 包只在确有独立脚本运行需求的环境中按清单安装，不作为 Student System 平台依赖。
