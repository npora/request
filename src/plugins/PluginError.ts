export type PluginErrorCode =
  | 'MISSING_DEPENDENCY'
  | 'PLUGIN_CONFLICT'
  | 'DEPENDENCY_IN_USE'

export interface PluginErrorOptions {
  code: PluginErrorCode

  plugin: string

  relatedPlugin: string
}

/**
 * Stable error thrown for invalid plugin lifecycle operations.
 */
export class PluginError extends Error {
  readonly code: PluginErrorCode

  readonly plugin: string

  readonly relatedPlugin: string

  constructor(message: string, options: PluginErrorOptions) {
    super(message)

    this.name = 'PluginError'
    this.code = options.code
    this.plugin = options.plugin
    this.relatedPlugin = options.relatedPlugin

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
