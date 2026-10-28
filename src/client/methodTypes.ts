import type { RequestConfig, SseReconnectOptions, SseStateObserver, StandardSchemaV1 } from '../types'

export type MethodConfig = Omit<RequestConfig, 'url' | 'method'>

export type SchemaMethodConfig<Schema extends StandardSchemaV1> = Omit<
  MethodConfig, 'schema'
> & { schema: Schema }

export type StreamingMethodConfig = Omit<
  RequestConfig, 'url' | 'method' | 'responseType' | 'schema'
>

export type SseMethodConfig = StreamingMethodConfig & {
  reconnect?: SseReconnectOptions
  /** Connection lifecycle notifications; observer failures are isolated. */
  onStateChange?: SseStateObserver
}

export type SseSchemaMethodConfig<Schema extends StandardSchemaV1> = Omit<
  SseMethodConfig, 'itemSchema'
> & { itemSchema: Schema }

export type ItemSchemaMethodConfig<Schema extends StandardSchemaV1> = Omit<
  StreamingMethodConfig, 'itemSchema'
> & { itemSchema: Schema }
