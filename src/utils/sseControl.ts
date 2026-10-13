import type { RequestConfig } from '../types'

export interface SseControlObserver {
  initialId?: string
  initialRetry?: number
  onId?: (id: string) => void
  onRetry?: (milliseconds: number) => void
}

export const SSE_CONTROL = Symbol('npora.sseControl')

export function withSseControl<T extends object>(
  config: T,
  observer: SseControlObserver
): T {
  return { ...config, [SSE_CONTROL]: observer }
}

export function getSseControl(
  config: RequestConfig
): SseControlObserver | undefined {
  return (config as RequestConfig & {
    [SSE_CONTROL]?: SseControlObserver
  })[SSE_CONTROL]
}
