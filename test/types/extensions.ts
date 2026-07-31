import type {
  Client,
  DownloadPluginOptions,
  Plugin,
  RequestConfig,
  RetryOptions,
  UploadProgress
} from '@npora/request'
import { downloadPlugin } from '@npora/request'

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

type LegacyExtensionKey =
  | 'auth'
  | 'cache'
  | 'download'
  | 'logger'
  | 'retry'
  | 'upload'

type HasNoLegacyExtensionKeys =
  Extract<keyof RequestConfig, LegacyExtensionKey> extends never
    ? true
    : false

const hasNoLegacyExtensionKeys: HasNoLegacyExtensionKeys = true

void hasNoLegacyExtensionKeys

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

const downloadOptions: DownloadPluginOptions = {
  transport: 'xhr'
}

client.use(downloadPlugin(downloadOptions))

const uploadProgress = (progress: UploadProgress) => {
  return progress.progress
}

void uploadProgress
