import type { Client } from '../client'

/**
 * Npora Request 插件。
 */
export interface Plugin {
  /**
   * 插件名称。
   */
  name: string

  /**
   * 插件安装函数。
   */
  install: (client: Client) => void
}
