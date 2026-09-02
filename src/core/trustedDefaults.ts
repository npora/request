import type { RequestConfig } from '../types'
import { hasOwnProperty } from '../utils/hasOwnProperty'

export interface TrustedDefaultsSnapshot {
  fetchOptions?: RequestConfig['fetchOptions']
  context?: RequestConfig['context']
  headers?: RequestConfig['headers']
  removeHeaders?: RequestConfig['removeHeaders']
  query?: RequestConfig['query']
  searchParams?: RequestConfig['searchParams']
  extensions?: RequestConfig['extensions']
  hasBodyConfig: boolean
}

const snapshots = new WeakMap<object, TrustedDefaultsSnapshot>()

export function trustDefaults(
  defaults: Partial<RequestConfig>
): Partial<RequestConfig> {
  snapshots.set(defaults, {
    fetchOptions: ownValue(defaults, 'fetchOptions'),
    context: ownValue(defaults, 'context'),
    headers: ownValue(defaults, 'headers'),
    removeHeaders: ownValue(defaults, 'removeHeaders'),
    query: ownValue(defaults, 'query'),
    searchParams: ownValue(defaults, 'searchParams'),
    extensions: ownValue(defaults, 'extensions'),
    hasBodyConfig:
      hasOwnProperty.call(defaults, 'body') ||
      hasOwnProperty.call(defaults, 'json') ||
      hasOwnProperty.call(defaults, 'form') ||
      hasOwnProperty.call(defaults, 'formData')
  })

  return defaults
}

export function getTrustedDefaults(
  defaults: Partial<RequestConfig>
): TrustedDefaultsSnapshot | undefined {
  return snapshots.get(defaults)
}

function ownValue<
  T extends object,
  K extends keyof T
>(value: T, key: K): T[K] | undefined {
  return hasOwnProperty.call(value, key)
    ? value[key]
    : undefined
}
