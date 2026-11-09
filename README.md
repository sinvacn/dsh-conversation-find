# dsh-conversation-find

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.1-4c6ef5)](https://github.com/deepseek-ai/deepseek-harness)

A VS Code-style find bar for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) conversation window: press `Cmd+F` / `Ctrl+F` to search the loaded transcript, highlight every match, and jump between them without leaving the conversation.

中文见 [README.zh.md](README.zh.md).

## Features

- **Find in the conversation** — the bar opens over the transcript and searches visible message text, Markdown, code blocks, and expanded tool details. The composer, message actions, and toolbar labels are excluded.
- **Highlight and navigate** — all matches are highlighted with the CSS Custom Highlight API and the current match uses a stronger colour. `Enter` / `Shift+Enter`, the arrow buttons, or `F3` / `Shift+F3` move through matches and wrap at the ends.
- **Case / whole word / regex** — `Aa`, `ab`, and `.*` switch matching modes, with a live match count and an invalid-regex state.
- **Selection prefill** — a short single-line selection in the conversation becomes the initial query.
- **Earlier history** — when the loaded window still has earlier turns, a **Partial** button appears. Clicking it loads the next older page from the conversation and the results update automatically. The current match is kept by DOM anchor while older content is prepended.
- **Surface-aware shortcut** — `Cmd/Ctrl+F` in the composer, sidebars, or other panels is left to the browser; only the conversation transcript is claimed. It coexists with the file preview's find bar because each plugin only handles its own surface.

The conversation's history is paged. Until **Partial** loads the remaining pages, only the currently loaded turns are searched.

## Install

Built against DSH `0.2.2-rc.1`.

```sh
dsh plugin --profile desktop add github:sinvacn/dsh-conversation-find
```

Or ask the agent in chat:

> Install the dsh-conversation-find plugin: `dsh plugin --profile desktop add github:sinvacn/dsh-conversation-find`

For local development, install the package directory through the plugin manager. The plugin is client-only; after installation, **refresh the page**. No desktop restart or Host route is needed.

## Use

1. Click into the conversation transcript or select text in a message.
2. Press `Cmd+F` on macOS or `Ctrl+F` on Windows/Linux.
3. Type a query. `Aa`, `ab`, and `.*` switch case sensitivity, whole-word matching, and regex mode.
4. Use `Enter` / `Shift+Enter` or ↑ / ↓ to step through matches. `Escape` closes the bar and clears the highlights.
5. If **Partial** is visible, click it to load an earlier page of history; matches in that page are added to the active search.

## Limitations

- Only loaded, rendered conversation content is searched. Earlier history must be loaded with **Partial**, and collapsed tool details or hidden rows are not part of the search.
- A match that is not rendered yet cannot be scrolled to until its history page is loaded.
- The bar does not include the composer draft or other panels; browser find remains available outside the conversation.
- No replace action.

## License

[MIT](LICENSE)
