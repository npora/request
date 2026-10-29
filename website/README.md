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
