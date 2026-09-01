import type { Adapter } from './adapter'
import type { RequestConfig } from './config'

/**
 * Client creation options.
 */
export interface ClientOptions
  extends Partial<Omit<
    RequestConfig,
    'url' | 'method' | 'schema' | 'itemSchema'
  >> {
  /**
   * Request adapter.
   *
   * @default FetchAdapter
   */
  adapter?: Adapter
}
