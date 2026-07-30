import type {
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
