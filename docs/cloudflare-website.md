# Cloudflare Pages 官网与实时测试控制台

官网目标地址为 **https://npora.pages.dev**，对应现有 Pages 项目 `npora`。
官网打包当前仓库源码，版本标记自动读取根 `package.json`，不从 CDN 加载另一个版本。
官网、Mock 接口和测试独立于库的 npm 发布流程。

## 按现有 Pages 项目部署

Cloudflare 控制台截图使用的是 Pages。保留 GitHub 仓库 `npora/request`、生产分支 `main`，
到 Pages 项目的 Settings → Builds & deployments 设置：

| 配置项 | 值 |
| --- | --- |
| Framework preset | None |
| Root directory | `website` |
| Build command | `npm ci --ignore-scripts && npm run build` |
| Build output directory | `dist` |
| Node.js 构建环境变量 | `NODE_VERSION=24` |
| 跳过自动依赖安装 | `SKIP_DEPENDENCY_INSTALL=1` |

构建命令明确安装 `website/package-lock.json` 中的独立依赖，再执行构建。
跳过 Pages 的自动安装，避免它检测到仓库根目录的 pnpm 而安装错误的工具链，参见
[Pages 构建镜像说明](https://developers.cloudflare.com/pages/configuration/build-image/#skip-dependency-install)。
不要将输出目录保留为 `.`，否则源文件、部署配置和后端代码会进入静态上传范围。
也不要使用 `../.artifacts/...`：当前 Pages Git 构建会拒绝根目录之外的输出路径。
公开静态产物保存在被 Git 忽略的 `website/dist/`，其他测试报告和运行时状态保存在根 `.artifacts/`。
`build.mjs` 只复制明确允许的静态文件；API 由 Functions 单独编译。
仓库根目录与 `website` 各自有独立工具链，官网依赖不进入 npm 包。

首次发布完整功能前，需要部署一次状态 Worker，然后重新部署 Pages：

```sh
# 在仓库根目录；Node.js 24
npm ci --prefix website --ignore-scripts
npm --prefix website exec -- wrangler login
npm --prefix website run deploy:state
```

部署命令创建名为 `npora-request-demo-state` 的 Worker 和 SQLite-backed Durable Object 类 `DemoState`。
不启用该 Worker 的公开 workers.dev 地址；官网通过 `DEMO_STATE` 绑定访问。
同一 Cloudflare 账号下，`website/wrangler.jsonc` 已声明 Pages 的
`DEMO_STATE → DemoState@npora-request-demo-state` 绑定。
请先部署状态 Worker，再触发 Pages 的 Retry deployment，确保命名空间已经存在。

如果使用 Dashboard 管理绑定，在 Pages 项目 Settings → Bindings → Add → Durable Object 中选择：

| 项 | 值 |
| --- | --- |
| Variable name | `DEMO_STATE` |
| Worker | `npora-request-demo-state` |
| Class | `DemoState` |

生产和预览都需要相应绑定；绑定修改后重新部署。
采用 Wrangler 配置时，以仓库中的配置为准，避免 Dashboard 与代码配置互相覆盖。
Pages 本身不能创建 Durable Object 类，所以状态 Worker 是单独的首次部署步骤。
这符合 [Pages Durable Object 绑定文档](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects)。

没有 Cloudflare 登录态时，GitHub 上传、构建和本地测试仍可完成，但线上状态 Worker 的创建需要账号授权。
仅打开官网静态页面或上传空白文件不代表后端绑定已就绪。

## 目录与同源路由

```text
website/
  index.html                 官网与控制台结构
  style.css                  桌面和手机布局
  app.js                     场景切换、运行、取消、日志与进度
  scenarios.js               使用真实请求库的 10 个场景
  build.mjs                  静态文件白名单与浏览器打包
  functions/
    api.js                   /api 的 JSON 404
    api/user.js              API 实现与状态类
    api/[[path]].js           /api/* 统一路由
  state/
    worker.mjs               导出状态类
    wrangler.jsonc           状态 Worker 与 SQLite 类迁移
  wrangler.jsonc             Pages 输出目录与外部 DO 绑定
  _routes.json               只让 /api 和 /api/* 进入 Functions
  _headers                   静态资源 CSP 与缓存策略
  test/                      workerd 接口契约与浏览器回归
```

浏览器使用当前 `location.origin` 下的 `/api/*`，本地、预览域名、自定义域名均无需修改 API 地址。
同源演示不开放任意跨域调用。未知 API 返回 JSON 404，错误方法返回 405 和 `Allow`。
静态 404 不回退到主页。后端路径、Wrangler 配置和依赖目录不属于发布资产。

这使用 [Pages Functions 文件路由](https://developers.cloudflare.com/pages/functions/routing/)，
不是 Workers 对 `functions/` 的自动扫描。以后若迁移至 Workers Static Assets，需要显式 Worker 入口，
参见 [Worker script 路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)。

## 接口与演示行为

| 场景 | 方法与路径 | 预期结果 |
| --- | --- | --- |
| 数据获取 | `GET /api/user` | 完整用户 JSON，含数字 id、name、email 与 profile |
| Schema | `GET /api/schema` | 返回字符串 id 和 null email，客户端真实抛出 `SCHEMA_ERROR` |
| QUERY | `QUERY /api/query` | 解析并回显嵌套 JSON 筛选对象；演示数据集固定为一个用户，GET 为 405 |
| SSE | `GET /api/sse` | 每秒一条，共三条，带 id/event/data，然后关闭 |
| NDJSON | `GET /api/ndjson` | 每 250ms 一条，共六条；逐条校验 id/action |
| Retry | `GET /api/retry?run=<uuid>` | 同一 session/run 的前两次为 503，第三次为 200 |
| Timeout / 熔断 | `GET /api/timeout` | 10 秒后响应；客户端 1 秒超时两次，第三次 `CIRCUIT_OPEN` |
| Upload | `POST /api/upload` | 接收 FormData 的 file；控制台将 1 MiB 文件拆成 16 个 64 KiB 分片，逐片核对接收字节数 |
| Download | `GET /api/download` | 16 个 64 KiB 块，每 100ms 一块，共 1 MiB |
| Auth | `GET /api/auth`、`POST /api/refresh` | 过期凭证 401；刷新后重放，两个并发请求共享一次刷新 |
| Traffic | `GET /api/traffic` | 每 IP 滚动一秒最多五次，超限返回 429，冷却五秒并携带 `Retry-After: 5` |
| 部署探针 | `GET /api/health` | 验证 Pages 能实际调用状态 Worker，连接成功时返回 `ready: true` |

状态接口要求 `x-demo-session` 为 1–64 个字母、数字或连字符。
控制台每次运行创建随机 session；Retry 同时使用独立 run ID。
Retry 与 Auth 隔离各次演示。每个 session 只保留最近 run 的重试计数；
切换 run 会重置该计数，避免建立不断增长的 run Map。
Traffic 使用 Cloudflare 注入的 `CF-Connecting-IP`，不能通过更换 session 绕过 IP 限流。
本地没有该头时使用统一 local key。
首次部署后访问 `/api/health`，确认状态服务就绪；页面可访问不能单独证明 DO 已连接。
共享出口 IP 的多个访客会共享限流窗口，因此繁忙时可能需要等待再次测试。

DO 的事务防止并发计数丢失；SQLite 保留跨实例重启的计数与凭证状态。
每个对象只保存有界状态，15 分钟无请求后用 alarm 删除保存内容。
不把模块级 Map 当作跨实例一致性保证。Token 为公开演示凭证，仅在当前运行内存使用，
此接口不实现真实身份认证，也不返回真实用户资料。

## 正确理解控制台

- 泛型只提供 TypeScript 类型；Schema 场景使用一个无依赖的 Standard Schema V1 校验器，
  与 Zod、Valibot、ArkType 的兼容接口相同。`toFormErrors(error.issues)` 返回
  `formErrors` 和 `fieldErrors`，保留同一字段的全部消息。
- SSE 的 `onStateChange` 显示连接生命周期，异步迭代器负责增量消费和背压。
  此端点正常结束三条事件，不自动制造重连；连接状态不等同于 UI 打字机队列。
- 上传按 64 KiB 顺序分片，每片使用库的 XHR upload 回调，包含 multipart 请求体开销。
  面板以分片占文件的比例汇总整体进度，字节展示是对应的文件进度估算，最终使用服务端确认总数核对。
  不额外伪造进度计时器；分片发送是官网示例的应用逻辑，并非 uploadPlugin 自动分片。
  服务端按块有界读取并在完成后确认字节数；不宣称普通 HTTP 上传会持续反向推送接收进度。
  文件不落盘、不长期保留；请求体（含 multipart 开销）上限 2 MiB。
- 下载使用 Cloudflare `FixedLengthStream`，使浏览器获得可靠的总字节数。
  仅对任意流设置 `Content-Length` 不能保证 Workers 保留该头，参见
  [FixedLengthStream 文档](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/#fixedlengthstream)。
- 服务器 429 对应 `HTTP_ERROR` 与 `status: 429`；本地速率队列拒绝才是 `RATE_LIMIT`。
  `rateLimitPlugin` 可分享服务器冷却期；重试当前失败请求需要 `retryPlugin`，
  它默认遵从 `Retry-After`。控制台依次展示服务器拒绝、五秒等待、排队完成和本地拒绝。
  突发前用六个轻量 GET 预热连接，再并发十二次访问限流接口，减少握手延迟把请求分散到多个窗口。
  服务器按实际到达时间计数；排队阶段也组合重试，以处理网络延迟变化造成的偶发 429。
- 请求记录中的耗时测量到响应头或传输失败；XHR 上传测量到完整响应。
  面板总耗时还包含响应体消费。SSE、NDJSON、Download 的头部耗时通常很短。
- 停止按钮取消活动请求和流消费；页面离开也发出取消。服务端的 10 秒延迟有固定上限，
  运行时未及时传播连接取消时，服务端仍可能等到该上限后结束。

## 本地开发与验证

```sh
npm ci --prefix website --ignore-scripts
pnpm website:build
pnpm website:dev
```

打开 `http://127.0.0.1:8787`。开发脚本先启动 8788 端口的状态 Worker，
再启动 Pages，自动连接本地 DO 绑定。静态产物在 `website/dist/`，状态与报告在 `.artifacts/website/`，
Wrangler 元数据 `.wrangler/` 被忽略。保留兼容日期 `2026-07-30` 作为已测试的运行时基线。

```sh
# 独立 workerd：接口、流、边界、并发事务和重启持久化
pnpm test:website
# Pages Functions 编译与状态 Worker dry-run，不发布线上
npm --prefix website run check
# 首次安装浏览器（仓库根依赖需要先 pnpm install --frozen-lockfile）
pnpm exec playwright install chromium firefox webkit
# Chromium、Firefox、WebKit 与手机视口的端到端场景
pnpm test:website:browser
```

不要同时运行多组 Wrangler 开发服务器或官网浏览器测试，它们会争用端口和本地服务注册信息。
接口测试用临时隔离存储；结束后清理。官网 CI 运行构建、接口、浏览器与依赖审计。
`pnpm clean` 清理 `.artifacts/` 和 `website/dist/` 后，需重新执行构建才能预览。

本地无需 npm 发版。网站源码和独立 lockfile 推送到 GitHub 后，由 Pages 的 Git 集成构建部署。
