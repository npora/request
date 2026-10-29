import { createClient } from '../src/core-entry.ts'
import { toFormErrors } from '../src/schema-errors.ts'
import { retryPlugin } from '../src/plugins/retryPlugin.ts'
import { circuitBreakerPlugin } from '../src/plugins/circuitBreakerPlugin.ts'
import { uploadPlugin } from '../src/plugins/uploadPlugin.ts'
import { downloadPlugin } from '../src/plugins/downloadPlugin.ts'
import { authPlugin } from '../src/plugins/authPlugin.ts'
import { concurrencyPlugin } from '../src/plugins/concurrencyPlugin.ts'
import { rateLimitPlugin } from '../src/plugins/rateLimitPlugin.ts'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

// A real Standard Schema implementation, with no CDN or validator dependency.
// Existing Zod/Valibot/ArkType schemas can be supplied through the same contract.
export const userSchema = {
  '~standard': { version: 1, vendor: 'npora-playground', validate(value) {
    const issues = []
    for (const [key, type] of [['id', 'number'], ['name', 'string'], ['email', 'string']]) {
      if (typeof value?.[key] !== type) issues.push({ path: [key], message: `Expected ${type}` })
    }
    return issues.length ? { issues } : { value }
  } }
}
export const recordSchema = {
  '~standard': { version: 1, vendor: 'npora-playground', validate(value) {
    return Number.isSafeInteger(value?.id) && typeof value?.action === 'string'
      ? { value } : { issues: [{ message: 'Expected an integer id and string action' }] }
  } }
}

const snippets = {
  get: `const api = createClient({ baseURL: '/api' })\n\ninterface User {\n  id: number\n  name: string\n  email: string\n}\n\nconst user = await api.get<User>('/user')\nconsole.log(user)`,
  schema: `// userSchema: Standard Schema V1\n// 支持 Zod、Valibot、ArkType\ntry {\n  await api.get('/schema', { schema: userSchema })\n} catch (error) {\n  if (isSchemaValidationError(error)) {\n    console.log(error.code) // SCHEMA_ERROR\n    console.log(toFormErrors(error.issues))\n  }\n}`,
  query: `const result = await api.query('/query', {\n  json: {\n    filter: { active: true, roles: ['developer'] },\n    sort: { field: 'name', order: 'asc' },\n    page: { offset: 0, limit: 10 }\n  }\n})\n// 请求体携带 JSON；真实 HTTP QUERY 方法\nconsole.log(result.filters)`,
  sse: `const events = await api.sse('/sse', {\n  signal: controller.signal,\n  onStateChange: state => console.log(state)\n})\n\nfor await (const event of events) {\n  const { text } = JSON.parse(event.data)\n  appendText(text)\n}\n// 每秒一条，3 条后正常关闭`,
  ndjson: `const records = await api.ndjson('/ndjson', {\n  itemSchema: recordSchema,\n  signal: controller.signal\n})\n\nfor await (const record of records) {\n  console.log(record.id, record.action)\n}\n// 每条独立解析与校验，不等待完整响应`,
  retry: `const api = createClient({ baseURL: '/api' })\n  .use(retryPlugin({\n    retries: 2,\n    delay: 350,\n    onRetry: ({ attempt, delay }) => {\n      console.log('retry', attempt, delay)\n    }\n  }))\n\nawait api.get('/retry', { query: { run: runId } })\n// 503 → 503 → 200`,
  timeout: `const api = createClient({\n  baseURL: '/api', timeout: 1000\n}).use(circuitBreakerPlugin({\n  failureThreshold: 2,\n  resetTimeout: 30000\n}))\n\n// 服务端等待 10 秒\n// 前两次：TIMEOUT_ERROR\n// 第三次：CIRCUIT_OPEN，不发网络请求`,
  transfer: `const api = createClient({ baseURL: '/api' })\n  .use(uploadPlugin()).use(downloadPlugin())\n\n// 1 MiB 文件，按 64 KiB 分片顺序发送\nfor (let start = 0; start < file.size; start += 65536) {\n  const data = new FormData()\n  data.append('file', file.slice(start, start + 65536))\n  await api.post('/upload', { extensions: {\n    upload: { data, onProgress: updatePart }\n  } })\n}\n\nconst blob = await api.get('/download', {\n  extensions: { download: {\n    onProgress: updateDownload\n  } }\n})`,
  auth: `// refreshApi 不安装 authPlugin，避免递归刷新\nconst api = refreshApi.extend().use(authPlugin({\n  storage: inMemoryTokenStorage,\n  async refreshToken() {\n    const session = await refreshApi.post('/refresh')\n    return session.accessToken\n  }\n}))\n\nawait Promise.all([api.get('/auth'), api.get('/auth')])\n// 401 → 共享一次刷新 → 自动重放原请求`,
  traffic: `const api = createClient({ baseURL: '/api' })\n  .use(concurrencyPlugin({ maxConcurrent: 2 }))\n  .use(rateLimitPlugin({\n    maxRequests: 4, interval: 1000\n  }))\n  .use(retryPlugin({ retries: 1 }))\n\nawait Promise.all(urls.map(url => api.get(url)))\n// 429: HTTP_ERROR；重试遵从 Retry-After\n// 本地队列拒绝: RATE_LIMIT`
}

export const scenarios = [
  { id: 'get', name: '标准数据获取', tag: 'GET / TYPES', description: '获取完整用户对象。TypeScript 泛型描述预期类型；运行时的数据检查交给下一场景。',
    async run(ctx) { const user = await ctx.api().get('/user'); check(user.id === 1 && user.profile.team === 'Npora', 'Unexpected user'); ctx.log(user) } },
  { id: 'schema', name: '运行时结构校验', tag: 'STANDARD SCHEMA', description: '服务端故意返回错误类型。真实校验器拦截响应，并将 issues 映射到具体表单字段。',
    async run(ctx) {
      try { await ctx.api().get('/schema', { schema: userSchema }) } catch (error) {
        if (error.code !== 'SCHEMA_ERROR') throw error
        ctx.log({ code: error.code, issues: error.issues, ...toFormErrors(error.issues) }); return
      }
      throw new Error('Expected SCHEMA_ERROR')
    } },
  { id: 'query', name: 'QUERY 内容查询', tag: 'HTTP QUERY / JSON', description: '用真正的 QUERY 动词发送嵌套筛选条件。GET 会被服务端以 405 拒绝；演示接口回显筛选体。',
    async run(ctx) {
      const filters = { filter: { active: true, roles: ['developer'] }, sort: { field: 'name', order: 'asc' }, page: { offset: 0, limit: 10 } }
      const result = await ctx.api().query('/query', { json: filters })
      check(result.method === 'QUERY' && result.filters.filter.active, 'QUERY body was lost'); ctx.log(result)
    } },
  { id: 'sse', name: 'SSE 实时事件流', tag: 'EVENT STREAM / LIVE', description: '每隔一秒到达一个事件，累计三条后关闭。连接状态与文本逐条更新，停止按钮会取消消费。',
    async run(ctx) {
      const events = await ctx.api().sse('/sse', { onStateChange: ctx.state })
      let text = '', count = 0
      for await (const event of events) { text += JSON.parse(event.data).text; ctx.log({ id: event.id, text }); count++ }
      check(count === 3, `Expected 3 events, got ${count}`)
    } },
  { id: 'ndjson', name: 'NDJSON 增量解析', tag: 'NDJSON / LAZY', description: '六条记录逐行抵达，逐条通过 itemSchema 校验。异步迭代器按消费速度读取数据。',
    async run(ctx) {
      let count = 0
      for await (const record of await ctx.api().ndjson('/ndjson', { itemSchema: recordSchema })) { ctx.log(record); count++ }
      check(count === 6, `Expected 6 records, got ${count}`)
    } },
  { id: 'retry', name: '故障自动重试', tag: 'RESILIENCE / RETRY', description: '同一次演示前两次返回 503，第三次成功。每次运行都有独立 run ID，计数保存在 Durable Object 中。',
    async run(ctx) {
      const api = ctx.api(retryPlugin({ retries: 2, delay: 350, onRetry: ({ attempt, delay }) => ctx.log({ retry: attempt, delay }) }))
      const result = await api.get('/retry', { query: { run: crypto.randomUUID() } })
      check(result.attempt === 3 && result.recovered, 'Expected success on third attempt'); ctx.log(result)
    } },
  { id: 'timeout', name: '超时与熔断保护', tag: 'TIMEOUT / CIRCUIT', description: '服务端延迟十秒，客户端一秒超时。连续两次失败打开熔断器，第三次立即拒绝，不再访问接口。',
    async run(ctx) {
      const api = ctx.api(circuitBreakerPlugin({ failureThreshold: 2, resetTimeout: 30000, onStateChange: event => ctx.log({ circuit: event.state }) }))
      for (const expected of ['TIMEOUT_ERROR', 'TIMEOUT_ERROR', 'CIRCUIT_OPEN']) {
        try { await api.get('/timeout', { timeout: 1000 }) } catch (error) {
          if (ctx.signal.aborted || error.code !== expected) throw error
          ctx.log({ code: error.code, expected: true }); continue
        }
        throw new Error(`Expected ${expected}`)
      }
    } },
  { id: 'transfer', name: '上传与下载进度', tag: 'TRANSFER / PROGRESS', description: '将 1 MiB 文件拆成 64 KiB FormData 分片，逐片确认，再下载 1 MiB Blob。整体进度由每片真实传输回调汇总。',
    async run(ctx) {
      const api = ctx.api(uploadPlugin(), downloadPlugin())
      const file = new Blob([new Uint8Array(1024 * 1024).fill(110)])
      const partSize = 64 * 1024
      let confirmed = 0, receivedBytes = 0
      for (let offset = 0; offset < file.size; offset += partSize) {
        const part = file.slice(offset, offset + partSize)
        const data = new FormData()
        data.append('file', part, `npora-demo-${offset / partSize + 1}.bin`)
        const upload = await ctx.upload(api, { data, onProgress: value => {
          // Each callback measures the current multipart request. Overall file
          // progress weights its ratio by this part's share of the whole file.
          const loaded = offset + part.size * (value.progress ?? 0)
          ctx.progress('upload', { loaded, total: file.size, progress: loaded / file.size })
        } })
        check(upload.bytes === part.size, 'Uploaded part byte count mismatch')
        confirmed += upload.bytes; receivedBytes += upload.receivedBytes
        ctx.log({ part: offset / partSize + 1, confirmedBytes: confirmed })
      }
      check(confirmed === file.size, 'Uploaded file byte count mismatch')
      ctx.log({ upload: { parts: file.size / partSize, bytes: confirmed, receivedBytes } })
      const blob = await api.get('/download', { extensions: { download: { onProgress: value => ctx.progress('download', value) } } })
      check(blob.size === 1024 * 1024, 'Downloaded byte count mismatch'); ctx.log({ download: { bytes: blob.size, type: blob.type } })
    } },
  { id: 'auth', name: '无感 Token 刷新', tag: 'AUTH / SINGLE FLIGHT', description: '两个请求携带过期凭证，收到 401 后共享一次刷新，再自动重放。Token 仅为演示凭证，保存在当前运行内存。',
    async run(ctx) {
      let token = 'expired-demo-token', refreshes = 0
      const refreshApi = ctx.api()
      const api = ctx.api(authPlugin({
        storage: { get: () => token, set: value => { token = value }, remove: () => { token = '' } },
        async refreshToken() { refreshes++; ctx.log('401 → 正在刷新凭证'); const session = await refreshApi.post('/refresh'); return session.accessToken }
      }))
      const results = await Promise.all([api.get('/auth'), api.get('/auth')])
      check(refreshes === 1 && results.every(value => value.authenticated), 'Expected one shared refresh')
      ctx.log({ refreshes, replayedRequests: results.length, user: results[0].name })
    } },
  { id: 'traffic', name: '并发与速率控制', tag: 'CONCURRENCY / RATE LIMIT', description: '观察真实 IP 限流，再通过独立 429 故障探针验证等待与恢复。继续展示并发排队、节流和本地 RATE_LIMIT 拒绝。',
    async run(ctx) {
      ctx.log('阶段 1 / 预热连接后并发 12 次请求，服务器每 IP 每秒允许 5 次')
      const direct = ctx.api()
      await Promise.all(Array.from({ length: 6 }, () => direct.get('/user')))
      const burst = await Promise.allSettled(Array.from({ length: 12 }, () => direct.get('/traffic')))
      const unexpected = burst.find(value => value.status === 'rejected' && value.reason.status !== 429)
      if (unexpected) throw unexpected.reason
      const rejected = burst.filter(value => value.status === 'rejected' && value.reason.status === 429)
      ctx.log({ serverRejections: rejected.length, observedStatus: rejected.length ? 429 : 200 })
      if (!rejected.length) ctx.log('本轮请求在服务器上未超过每秒 5 次，未触发 IP 限流。')
      ctx.log('阶段 2 / 独立 429 故障探针：retryPlugin 遵从 Retry-After，等待 5 秒恢复')
      const recovered = await ctx.api(retryPlugin({ retries: 1, onRetry: ({ delay }) => ctx.log({ retryDelay: delay }) })).get('/traffic-probe')
      check(recovered.accepted && recovered.probe, 'Expected 429 probe recovery')
      ctx.log('阶段 3 / 最多 2 个并发、每秒 4 次，排队完成 8 个请求')
      const concurrency = concurrencyPlugin({ maxConcurrent: 2 })
      const rate = rateLimitPlugin({ maxRequests: 4, interval: 1100 })
      const bounded = ctx.api(concurrency, rate, retryPlugin({ retries: 1,
        onRetry: ({ delay }) => ctx.log({ boundedRetryDelay: delay }) }))
      const requests = Array.from({ length: 8 }, () => bounded.get('/traffic'))
      ctx.log({ concurrency: concurrency.getState(location.origin), rate: rate.getState(location.origin) })
      check((await Promise.all(requests)).every(value => value.accepted), 'Bounded request failed')
      ctx.log('阶段 4 / 禁用本地排队，超额请求以 RATE_LIMIT 拒绝')
      // /user isolates this local guard demonstration from the server traffic window.
      const local = ctx.api(rateLimitPlugin({ maxRequests: 1, interval: 1000, maxQueue: 0 }))
      const results = await Promise.allSettled([local.get('/user'), local.get('/user')])
      check(results.some(value => value.status === 'rejected' && value.reason.code === 'RATE_LIMIT'), 'Expected local RATE_LIMIT')
      ctx.log({ code: 'RATE_LIMIT', source: 'client queue', boundedCompleted: 8 })
    } }
].map(scenario => ({ ...scenario, code: snippets[scenario.id] }))

export function createScenarioContext({ signal, log, state, progress, network }) {
  // Per-run session prevents a second tab from rotating this run's auth token.
  const session = crypto.randomUUID()
  const api = (...plugins) => {
    const client = createClient({
      baseURL: `${location.origin}/api`, signal, totalTimeout: 20000,
      headers: { 'x-demo-session': session },
      async fetch(input, init) {
        const start = performance.now()
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
        const url = new URL(input instanceof Request ? input.url : String(input))
        try {
          const response = await fetch(input, init)
          network({ method, path: url.pathname, status: response.status, ms: performance.now() - start })
          return response
        } catch (error) {
          network({ method, path: url.pathname, status: '中断/失败', ms: performance.now() - start }); throw error
        }
      }
    })
    for (const plugin of plugins) client.use(plugin)
    return client
  }
  return { api, signal, log, state, progress,
    async upload(client, upload) {
      // The library uses XHR for upload progress, outside the Fetch observer.
      const start = performance.now()
      try {
        const result = await client.post('/upload', { extensions: { upload } })
        network({ method: 'POST', path: '/api/upload', status: 200, ms: performance.now() - start }); return result
      } catch (error) {
        network({ method: 'POST', path: '/api/upload', status: error.status ?? '中断/失败', ms: performance.now() - start }); throw error
      }
    }
  }
}
