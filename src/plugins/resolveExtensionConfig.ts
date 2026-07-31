import type {
  RequestConfig,
  RequestExtensions
} from '../types'

/**
 * Resolve namespaced plugin configuration.
 */
export function resolveExtensionConfig<
  Key extends keyof RequestExtensions
>(
  config: RequestConfig,
  key: Key
): RequestExtensions[Key] | undefined {
  return config.extensions?.[key]
}
