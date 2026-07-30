import type {
  Client,
  Plugin,
  RequestConfig,
  RetryOptions
} from '@npora/request'

interface MetricsOptions {
  enabled?: boolean

  sampleRate?: number
}

declare module '@npora/request' {
  interface RequestExtensions {
    metrics?: MetricsOptions
  }
}

const retry: RetryOptions = {
  retries: 2,
  delay: 100
}

const config: RequestConfig = {
  url: '/user',
  extensions: {
    retry,
    cache: {
      enabled: true
    },
    metrics: {
      enabled: true,
      sampleRate: 0.5
    }
  }
}

void config

const plugin: Plugin = {
  name: 'metrics',
  priority: 10,
  requires: ['logger'],
  conflicts: ['legacy-metrics'],

  install({ hooks }) {
    hooks.onRequest(() => {})

    return () => {}
  }
}

declare const client: Client

client.use(plugin)
client.unuse(plugin.name)

const installed: boolean = client.hasPlugin(plugin.name)
const extended: Client = client.extend({
  baseURL: '/v2',
  headers: {
    'x-client': 'extended'
  }
})
const headData: Promise<void> = client.head('/health')
const optionsData: Promise<{ allowed: boolean }> = client.options<{
  allowed: boolean
}>('/resource')

void installed
void extended
void headData
void optionsData
