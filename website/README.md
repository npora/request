# Npora Request website

官网：https://npora.pages.dev

源码主页是 `index.html`，前端场景在 `scenarios.js`，交互在 `app.js`，
Mock API 在 `functions/api/user.js`。这是 **Cloudflare Pages + Functions** 项目。

从仓库根目录执行：

```sh
npm ci --prefix website --ignore-scripts
pnpm website:build
pnpm website:dev
```

打开 `http://127.0.0.1:8787`。开发脚本同时启动 Pages 与状态 Worker，
无需 Cloudflare 登录。状态保存在被 Git 忽略的 `.artifacts/website/`。

完整部署、绑定、接口与验证步骤见 [Cloudflare 官网部署指南](../docs/cloudflare-website.md)。
官网开发不改变 npm 包版本，也不需要发布 npm。

## Languages

The homepage defaults to English. The navigation selector also offers Simplified
Chinese (`zh-CN`). A manual selection is stored in `localStorage`; when storage
is blocked, switching still works for the current page. Browser language does
not override the English default.

`translations.js` contains the English and Chinese copy; `i18n.js` applies it to
the page, accessibility labels, title, description, scenario descriptions and
code comments. Switching preserves running requests, results and progress.
Raw API data, error codes, HTTP methods and stream state identifiers are not
translated. Add both language values for new copy, and mark static text with
`data-i18n` (or the corresponding attribute marker).

Run `pnpm test:website:browser` from the repository root to cover both languages,
persistence, blocked storage and switching while an SSE stream is running on
desktop and mobile browsers. This website-only change does not require an npm
package release.

## Homepage and recording preview

The homepage uses a responsive light layout, a dark code console and a shared
green accent. The original ten request scenarios remain available. The recording
section runs one real `/api/user` request through the current source version of
`MockAdapter` and displays `exportMocks()` output for copying. It does not evaluate
the generated script, persist files, or load third-party resources. Its controller
is aborted on page exit, and language changes preserve the generated fixture.

`recording.js` owns this preview. `style.css` includes mobile layouts and a
reduced-motion override. The browser suite exercises the ten scenarios, both
languages, fixture generation and responsive layout.
