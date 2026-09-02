# 资源治理晾晒大屏 Design QA

- source visual: `/Users/fredyw/.codex/generated_images/019f5b93-fe00-7b02-bd42-69b7cb55fc63/exec-52ec7776-2777-4763-abe0-957692e1a9cd.png`
- implementation screenshot: `/Users/fredyw/code/student-system/output/resource-governance-wallboard/implementation.png`
- comparison evidence: `/Users/fredyw/code/student-system/output/resource-governance-wallboard/design-comparison.png`
- viewport: `1920 × 1080`
- tested state: live demo at `http://127.0.0.1:4317/`

## 全屏对照

参考图与浏览器实装截图已在同一张横向对照图中检查。页面保持了同一信息骨架：顶部标题与周期、中部闲置结论/证据环/重点业务、底部两个 TOP10 榜单。中央环形证据未被压扁，左右留白、分隔线和两列榜单的视觉节奏与参考方向一致。

## 局部检查

重点检查了此前反馈的中央资源证据区与榜单区，因此无需额外裁剪局部图：在 1920 × 1080 全屏证据中，中央证据环、左右数值标签、利用率指标以及两张完整 TOP10 均可按原始尺寸清晰判断。

## 功能与运行时验证

- 倒计时实时递减。
- 两个榜单的高亮行按 4.2 秒周期滚动，变化标记同步更新。
- 两个榜单均完整展示前 10，治理评分统一显示为整数加“分”，未使用进度条。
- 1920 × 1080 和 1366 × 768 均无横向或纵向溢出；大屏按等比缩放完整展示。
- 重新开启浏览器会话后检查控制台：0 errors，0 warnings。
- 生产构建通过；ECharts 产生体积提示，但不影响当前单页大屏运行。

## 对照迭代记录

1. 初次浏览器验收发现 4173 端口同时存在学生系统与 Vite 服务，页面命中错误进程。
2. 改用独立的 4317 端口后重新采集实装截图，确认目标页面与现有学生系统完全隔离。
3. 补充内联 favicon，消除浏览器 404 控制台错误。
4. 完成参考图与实装图同输入对照，视觉层级与核心构图通过。

final result: passed
