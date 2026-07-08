import type { Lifecycle } from '../core'

/**
 * 插件安装上下文。
 */
export interface PluginSetupContext {
  /**
   * 注册生命周期。
   */
  addLifecycle: (lifecycle: Lifecycle) => void
}

/**
 * Npora Request 插件。
 */
export interface Plugin extends Lifecycle {
  /**
   * 插件名称。
   */
  name: string

  /**
   * 插件初始化函数。
   */
  setup?: (context: PluginSetupContext) => void
}
