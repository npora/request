import type { Plugin } from '../src'
import { createClient } from '../src'

const requestIdPlugin: Plugin = {
  name: 'request-id',
  priority: 10,

  install({ interceptors }) {
    interceptors.request.use(config => {
      const headers = new Headers(config.headers)

      headers.set('x-request-id', crypto.randomUUID())

      return {
        ...config,
        headers
      }
    })
  }
}

const request = createClient({
  baseURL: 'https://api.example.com'
}).use(requestIdPlugin)

await request.get('/health')
