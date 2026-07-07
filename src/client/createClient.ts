import type { RequestConfig } from '../types'
import { Client } from './Client'

/**
 * 创建 HTTP Client 实例。
 */
export function createClient(defaults: Partial<RequestConfig> = {}): Client {
  return new Client(defaults)
}