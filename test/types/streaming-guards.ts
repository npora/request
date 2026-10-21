import { createClient, type RequestConfig } from '../../dist/core.js'
const config: Partial<RequestConfig> = {
  streamIdleTimeout: 1000, maxStreamLineSize: 65536, maxSseEventSize: 1048576
}
const api = createClient(config)
void api.sse('/events', { streamIdleTimeout: 0, maxSseEventSize: Infinity })
void api.ndjson('/records', { maxStreamLineSize: 100 })
// @ts-expect-error timeout requires milliseconds as a number
void api.ndjson('/records', { streamIdleTimeout: '1000' })
// @ts-expect-error size requires bytes as a number
void api.sse('/events', { maxSseEventSize: '1000' })
