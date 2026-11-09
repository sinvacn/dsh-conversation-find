# dsh-conversation-find 实现细节

面向开发者：DOM 范围、快捷键分派、命中锚点、历史加载和测试。普通使用见 [README.zh.md](../README.zh.md)。

## 插件结构

- **Host 半**：`index.js` 只导出空的 `apply()`，让 Loader 有一个可激活的包；没有任何 Host 路由、索引或文件访问。
- **Client 半**：`client.js` 注册一个立即加载的浏览器模块，服务依赖只有 `locale`。所有 UI 和搜索状态都在浏览器里。
- **为什么单独成包**：会话查找属于主对话区域，不属于右栏文件面板；用户禁用 `dsh-file-pane` 时仍应可用。两个插件都监听 `Cmd/Ctrl+F`，但各自只在自己的 surface 命中时 preventDefault，因此可以共存。若以后要统一“按焦点分派查找”，应另做一个小的 find-router，而不是把两个 surface 塞进一个包。

## DOM 范围

- 会话根：`[data-conversation-content]`（同时带 `data-conversation-session` 和 `data-conversation-region="chat"`）。
- 滚动容器：`[data-conversation-scroll]`。
- 搜索根就是这个滚动容器，但 `textPiecesOf()` 会跳过：
  - `[data-composer-seat]`、`[data-conversation-region="composer"]` —— 输入框和 composer 控件；
  - `button` —— Load earlier、scroll-to-bottom、复制、展开等操作；
  - `[hidden]`、`[aria-hidden="true"]`、`[data-text-interaction-exclude]`、`script`、`style`。
- 文本节点按文档顺序拼成一条字符串，记录每段的 offset。这样 Markdown、行内代码、被语法高亮拆成多个 token 的代码块都能跨节点命中；匹配映射回 `Range` 后交给高亮层。

## 快捷键与焦点

- `window` 捕获阶段监听 `keydown`。
- `Mod+F` 时：
  - 焦点在查找条里：聚焦并全选输入框。
  - `resolveContent(target)` 依次看：目标元素是否在 `[data-conversation-content]` 内；是否在 composer seat 里；是否是可编辑元素；当前 selection 是否在会话里；最近一次 pointerdown 是否落在会话里。
  - 只有解析到会话内容才 `preventDefault()`；输入框、左右侧栏、设置面板等都不拦截。
- `F3` / `Shift+F3` 在查找条或会话正文里切换命中；`Escape` 只在查找条内关闭。
- 查找条本身的 `Enter` / `Shift+Enter` 也切换命中；按钮点击后重新聚焦输入框。

## 查找条

- 原生 DOM 构建，追加到 `document.body`，`position: fixed`，z-index 990。
- 位置由 `[data-conversation-content]` 的 `getBoundingClientRect()` 决定：右上角、最大 440px 宽、左右/上下夹在视口内。
- `ResizeObserver` 跟随会话区域尺寸；`resize` 事件兜底。
- 样式（包括 `::highlight` 规则）在安装时注入一个 `<style data-conversation-find-style>`，dispose 时移除。

## 匹配与高亮

- 普通文本先转义，再统一编译成带 `g`/`i`/`u` 的 RegExp；`ab` 使用 Unicode 词边界 lookaround。
- 每次搜索最多 2000 个命中，超出显示 `n/2000+`。
- 优先 `CSS.highlights` + `Highlight`：
  - 全部命中：`dsh-conversation-find`（priority 1）。
  - 当前命中：`dsh-conversation-find-current`（priority 2）。
  - 不支持时退化为选中当前命中。
- 当前命中按 `Range.getBoundingClientRect()` 滚动到滚动容器中间；代码块的横向滚动也会处理。

## 历史加载与当前命中

- 会话历史按窗口分页。`olderButtonOf(scroller)` 在 `[data-chat-flow]` 里找“Load earlier”控件：它位于 flow slot 之前，是一个只有单个按钮的直接子行；加载中按钮 disabled，结构不变。
- 存在该按钮时显示 **部分**。点击调用按钮的 `click()`，随后预览的 `MutationObserver` 重新搜索。
- 重新搜索时当前命中按 `Range.startContainer` + `startOffset` 保持；旧内容被 prepend 后节点身份不变，因此当前命中的索引会自动移动到新位置。找不到锚点时退回旧的字符串 offset，再不行就夹到合法范围。
- 新加载的内容被 prepend，匹配按文档顺序排列；用户可以继续用 `Shift+Enter`/↑ 走到更早的命中。

## 观察与生命周期

- `MutationObserver` 观察滚动容器，忽略 composer seat 内的变化：
  - 消息流式更新、历史 prepend、展开/收起都会重跑搜索（120 ms 防抖）。
  - 侧栏尺寸/位置变化只做 rAF 节流后的重新定位。
- 另外观察 `[data-conversation-content]` 的直接子节点和 `data-conversation-session` 属性，以及内容的父节点，用来在切 Session、切 View、面板销毁时关闭查找条。
- 会话内容不可见、Session id 变化、滚动容器消失时自动关闭。
- 插件 dispose 时移除两个全局监听、查找条、高亮和样式。

## 测试

```sh
node test/run.mjs
```

2/2 通过：普通文本转义、区分大小写、全字、正则和非法正则。

另外用 jsdom 做过一次性冒烟验证（不提交依赖）：纯文本/代码块命中、composer 排除、`Mod+F`、选中、命中计数、上下切换、`Escape`、**部分** 加载更早历史后的锚点保持、dispose 清理样式。真实 App 中的视觉和焦点行为需安装后刷新页面确认。
