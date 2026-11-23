# 可交互 UI 原型（前端 Demo）

APEX 的 Demo 是用户可以直接操作的前端原型。它用于审阅已确认方案的页面、任务流程和状态反馈；截图、视频、自动播放动画、只有跳转链接的展示页不能替代它。内部兼容保留 `runtime-demo.json` 与 `generate_visual` 等机器名称。

## 内容与交互

- 按当前确认范围实现导航、页签、筛选、表单、弹窗、详情及主要操作；只实现本次产品需要的交互，不额外添加无关角色或页面。
- 多角色需求须提供可切换的预览视角，并同步显示对应导航、内容和权限状态；单角色产品不强制添加角色切换。
- 每个主要操作有可观察的结果：列表、计数、详情、保存状态或校验信息确实变化。不能用所有按钮共用一个“操作成功”提示代替任务完成。
- 使用独立示例数据和本地状态；显示简洁的“交互预览 · 示例数据”提示，提供可用的重置入口。前端保存不意味着写入正式系统，不读取真实账号、密钥或生产数据库。
- 覆盖需求中适用的默认、加载、空、错误、无权限与成功状态；不适用项在方案中说明。沿用已冻结的来源与响应式合同，不新增 Demo 确认门。

## 可执行输入

`demo-source-input.json` 除已有源码和来源绑定，还必须提供 `interactionContract`。编译器将它保留到源码清单和沙箱清单；覆盖 `experience-strategy.json.functionalPlan` 的每项 `task`，至少包含一个主要任务和一条重置流程。每条流程从指定的本地路由开始，应安排独立、可重复的初始状态；持久化演示须通过自己的重置入口完成预置，不依赖人工清缓存。

```json
{
  "schemaVersion": "1.0",
  "kind": "interactive-ui-prototype",
  "dataMode": "mock",
  "notice": { "selector": "#demo-notice", "text": "示例数据" },
  "journeys": [
    {
      "id": "add-item", "kind": "task", "task": "添加项目", "route": "/",
      "steps": [{
        "action": "click", "selector": "#add-item",
        "before": { "selector": "#count", "property": "text", "equals": "0" },
        "after": { "selector": "#count", "property": "text", "equals": "1" }
      }]
    },
    {
      "id": "reset-demo", "kind": "reset", "task": "重置演示", "route": "/",
      "steps": [
        {
          "action": "click", "selector": "#add-item",
          "before": { "selector": "#count", "property": "text", "equals": "0" },
          "after": { "selector": "#count", "property": "text", "equals": "1" }
        },
        {
          "action": "click", "selector": "#reset-demo",
          "before": { "selector": "#count", "property": "text", "equals": "1" },
          "after": { "selector": "#count", "property": "text", "equals": "0" }
        }
      ]
    }
  ]
}
```

流程种类：`navigation / task / role / state / reset`。操作：`click / fill / selectOption / check / uncheck / press`，其中需要输入值的操作 `fill / selectOption / press` 使用字符串 `value`。观察支持 `text / value / visible / checked / attribute`；属性观察另带 `attribute` 名称。每步前后必须观察同一选择器和属性，预期值必须不同。流程 ID 只允许字母、数字、下划线和短横线，路由必须留在当前 Demo。

## 自动验收与展示

在现有 `generate_visual` 授权内执行源码编译、沙箱物化和启动。`browser-capture.mjs` 自动读取清单中的交互合同，在真实浏览器中逐步操作并断言，记录前后状态、最终截图、DOM 和失败原因；交互检查阻止向 Demo 以外的网络地址发出请求。Demo 证据和截图与正式页面验证分开保存。证据绑定合同哈希、沙箱清单哈希及全部已物化源文件，源码变化后必须重新采集。没有交互证据、空操作、失效按钮、错误结果或旧证据均不能冻结、登记为新 Demo。纯交互页面无需为了验收添加装饰动画；实际选择了动效时继续满足动效证据要求。

默认在聊天正文嵌入可直接使用的 Demo，支持页签、按钮、表单、状态反馈与重置。通过 `chatPreview.fragment` 指定自包含 HTML 片段，编译器从同一片段生成 HTTP 验收页；Router 校验哈希并返回 `presentation.contentReference`，宿主必须在本轮最终回复原样输出。不能用 localhost iframe、截图或链接代替聊天交互。仅宿主缺少能力或已选来源无法兼容片段时，说明具体原因并打开同一 Run 浏览器面板。保留来源锁、响应式要求和后续路线选择，不新增确认。

历史上已登记、已展示的旧 Run 保留原始回执以便审计；新生成或重新生成的 Demo 必须通过本合同。


## 聊天内交付合同

新生成 Demo 默认使用 `chatPreview`。宿主读取当前 visualize 技能的输出协议，并在现有 `generate_visual` 源码编译步骤中提供：

```json
{
  "entrypoint": "index.html",
  "chatPreview": { "fragment": "preview.html" },
  "files": [{ "path": "preview.html", "encoding": "utf8", "content": "实际完整的 HTML 片段" }]
}
```

以上只说明增量字段；`schemaVersion: "3.0"`、完整 `interactionContract` 和覆盖已选来源的 `sourceBindings` 仍必需。`sourceBindings.files` 指向实际片段；`index.html` 由编译器生成，不可手写第二套 UI。`chatPreview.mode` 只在全屏桌面应用需要展开宽度时填写 `wide`，紧凑窗口和移动界面省略。

- 片段小于 1 MiB，不含 doctype、html、head、body 或 iframe。使用唯一根 ID，所有产品样式和 DOM 操作限定在根下；保持 320px 至聊天宽度可用，不用固定视口高度或页面内滚动模拟聊天框。
- CSS、JavaScript 和已选资源必须内联或预先打包；禁止依赖本地相对资源、网络 API、运行时模块导入、宿主工具类或宿主图标全局。已锁定的来源与版本继续保留，不能为了内嵌擅自改为另一套组件。必须依赖不兼容运行时的产品可走明确说明原因的浏览器回退。
- 页签、表单、弹窗和路由均在片段内切换；所有交互 journey 使用 `/`，同一片段包装成 HTTP 页面后接受现有真实浏览器验收。包装页用 CSP 限制资源及连接；静态扫描只是兼容性诊断，不是安全沙箱。连接策略依据 [MDN connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)。
- 可检测 `window.openai.widgetState`、`setWidgetState` 和 `openai:set_globals` 保存/恢复非敏感示例状态，缺少宿主能力时使用内存状态。回写处理 Promise 拒绝；不在加载和恢复事件中重复保存。保存不等于向模型发送指令，也不意味着写入生产系统。
- `visual-sandbox-files.json` 保存片段声明与文件哈希，`runtime-demo.json.chatPreview` 保存经过同源校验的片段路径、哈希和宽度。片段或包装页变化后旧交互证据、展示回执失效，必须沿原流程重新生成和验收。

展示命令沿用原有授权：

```text
present-runtime-demo <project-root> <run-id> <session-id> <authorization-ref> <presentation-id> [chat-inline|browser-panel] [fallback-reason]
```

有片段时默认 `chat-inline`；返回 `presentation.contentReference`，宿主在本轮最终回复将它原样放在独立一行，并展示原有路线决策。其形式为 `visualize{"path":"当前 Run 下片段的绝对路径"}`。这不是 Markdown 链接，不在 commentary 输出，不用 URL iframe。宿主只能引用可读取的持久文件；片段留在当前 Run，不移入 Library，不复制成第二份正式产物。

回执记录片段哈希与 `deliveryEvidence: prepared-for-host-final-response`，仅证明内容已准备输出，不伪称客户端已渲染、用户已点击或已接受 Demo。没有客户端 ACK 的宿主不能制造此类证据；实际最终回复仍必须包含引用，即使已有提前排队的直接代码意图。

宿主无内嵌能力时，先实际打开同 Run HTTP Demo，再以 `browser-panel` 和具体 `fallback-reason` 登记。历史或包运行时 Demo 没有片段时仍兼容旧命令，Router 明确返回浏览器模式；不能冒称已内嵌。回退继续执行相同来源锁、交互验收与路线选择，不增加确认。


## 正式页面功能验证

在 `verify` 阶段，浏览器规格中的 `formalJourneys` 使用与上方 `journeys` 相同的 `id`、`task`、`route`、`steps` 和前后观察格式。任务名称必须覆盖已确认 Demo 的产品交互任务；仅供预览恢复示例数据的重置流程不强加给正式产品，若产品方案本身要求重置则仍须验证。正式页面可使用自己的选择器和测试数据。每个操作必须产生可观察的状态变化，不能把点击成功当成功能通过。

`browser-capture.mjs` 在目标正式应用上执行这些操作，并记录每条流程的状态、截图和 DOM；操作由实际浏览器执行，可能改变目标应用的数据，因此应使用可控测试环境、可重置的测试数据和项目允许的验证范围。正式验证允许应用自身正常网络行为，不继承 Demo 的网络隔离假设。 如浏览器规格配置了认证，正式交互会话先使用指定环境变量完成登录，并检查登录前后的地址属于应用来源；认证失败时不执行任务。

状态矩阵的每项业务交互以对应流程 ID 和 `evidence/runtime/browser/formal-<id>.json` 为证据；`stability-evidence.mjs` 与 Gate 3 验证任务覆盖、实际状态变化、截图和 DOM 哈希，以及同一次成功浏览器采集的受控回执。保护区域的 `protected:<node>` 仍使用其独立的视觉回归证据。旧确认模型保留原验证规则。

正式交互 trace 的每一步同时记录操作目标、被观察的选择器、属性和实际前后值，以便产品角色对照产品方案与已确认 Demo 复核操作和结果是否属于该任务。缺少观察目标或属性的旧 trace 不能用于新的两次确认验收，应在当前正式页面重新采集。任务名称匹配和状态发生变化只能证明执行记录，不能自动证明业务语义正确；产品角色必须结合运行证据检查真实行为、数据及失败场景，发现无关变化时应要求修复并重新验证。


正式页面验收逐项覆盖已确认 Demo 的每个路由与实际视口组合。同一路由的桌面端和移动端是独立证据，分别关联截图、DOM 和页面级还原结果；缺失或变更的证据不能视为通过。
