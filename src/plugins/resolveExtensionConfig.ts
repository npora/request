import type {
  RequestConfig,
  RequestExtensions
} from '../types'

/**
 * Resolve namespaced plugin configuration with a legacy field fallback.
 */
export function resolveExtensionConfig<
  Key extends keyof RequestExtensions
>(
  config: RequestConfig,
  key: Key,
  legacy?: RequestExtensions[Key]
): RequestExtensions[Key] | undefined {
  return config.extensions?.[key] ?? legacy
}
