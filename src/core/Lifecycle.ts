import type { RequestContext } from './RequestContext'

export interface RetryDecision {
  retry: boolean
  delay?: number
}

export interface Lifecycle {
  beforeRequest?: (context: RequestContext<any>) => void | Promise<void>

  afterResponse?: (context: RequestContext<any>) => void | Promise<void>

  onError?: (context: RequestContext<any>) => void | Promise<void>

  resolveRetry?: (
    context: RequestContext<any>,
    attempt: number
  ) => RetryDecision | undefined | Promise<RetryDecision | undefined>
}
