import type { RequestConfig } from '../types'
import { Client } from './Client'

/**
 * Create HTTP client.
 */
export function createClient(defaults: Partial<RequestConfig> = {}): Client {
  return new Client(defaults)
}
