import type { ClientOptions } from '../types'
import { Client } from './Client'

/**
 * Create an HTTP client instance.
 */
export function createClient(options: ClientOptions = {}): Client {
  return new Client(options)
}
