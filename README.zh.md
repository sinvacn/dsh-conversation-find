# dsh-conversation-find

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.1-4c6ef5)](https://github.com/deepseek-ai/deepseek-harness)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的对话窗口加一个 VS Code 风格的查找条：按 `Cmd+F` / `Ctrl+F` 搜索已加载的对话内容，高亮所有命中，并在命中之间跳转，不离开会话。

[English](README.md) | 中文

## 功能

- **会话内查找**：查找条浮在对话上方，搜索可见的消息正文、Markdown、代码块和已展开的工具详情；输入框、消息操作按钮和工具栏文案不会进入结果。
- **高亮与跳转**：用 CSS Custom Highlight API 高亮全部命中，当前命中颜色更深；`Enter` / `Shift+Enter`、上下箭头或 `F3` / `Shift+F3` 在命中之间循环移动。
- **区分大小写 / 全字 / 正则**：`Aa`、`ab`、`.*` 切换匹配方式，显示实时命中数；非法正则输入框会标红。
- **选中预填**：对话里有单行短选中时，打开查找条会自动填入。
- **加载更早历史**：加载窗口里还有更早消息时，查找条显示 **部分** 按钮；点击加载下一页历史并自动更新结果。新内容插到前面时，当前命中通过 DOM 锚点保持住。
- **按焦点判断**：在输入框、左右侧栏和其他面板里按 `Cmd/Ctrl+F` 不会被拦截，仍由浏览器处理。它和文件预览的查找条可以共存，因为各自只处理自己的区域。

对话历史是分页加载的。在点击 **部分** 把剩余页加载进来之前，只搜索当前已加载的内容。

## 安装

基于 DSH `0.2.2-rc.1`。

```sh
dsh plugin --profile desktop add github:sinvacn/dsh-conversation-find
```

也可以直接在对话里让 agent 安装：

> 帮我安装 dsh-conversation-find 插件：`dsh plugin --profile desktop add github:sinvacn/dsh-conversation-find`

本地开发时，用插件管理器安装包目录即可。插件是纯客户端的，安装后**刷新页面**生效，不需要重启桌面 App，也没有 Host 路由。

## 使用

1. 点击对话正文，或在消息里选中文本。
2. macOS 按 `Cmd+F`，Windows/Linux 按 `Ctrl+F`。
3. 输入关键词；`Aa`、`ab`、`.*` 切换区分大小写、全字匹配和正则。
4. 用 `Enter` / `Shift+Enter` 或上下箭头切换命中；`Escape` 关闭并清除高亮。
5. 如果显示 **部分**，点击加载更早一页历史，新页里的命中会自动加入当前搜索。

## 已知限制

- 只搜索已加载、已渲染的对话内容。更早的历史需要点 **部分** 加载；收起的工具详情和隐藏行不参与搜索。
- 尚未渲染的命中在对应历史页加载出来之前无法滚动定位。
- 不包含输入框草稿和其他面板；对话之外仍使用浏览器自带的查找。
- 不提供替换功能。

## License

[MIT](LICENSE)
