import type { LoggerOptions } from '../types'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

export function loggerPlugin(defaultOptions: LoggerOptions = {}): Plugin {
  return {
    name: 'logger',

    install(context) {
      context.interceptors.request.use(config => {
        const logger =
          resolveExtensionConfig(
            config,
            'logger',
            config.logger
          ) ?? defaultOptions

        if (logger.enabled === false) {
          return config
        }

        console.log('[Npora Request]', {
          type: 'request',
          method: config.method ?? 'GET',
          url: config.url
        })

        return config
      })

      context.interceptors.response.use(response => {
        const logger =
          resolveExtensionConfig(
            response.config,
            'logger',
            response.config.logger
          ) ?? defaultOptions

        if (logger.enabled === false) {
          return response
        }

        console.log('[Npora Request]', {
          type: 'response',
          method: response.config.method ?? 'GET',
          url: response.config.url,
          status: response.status
        })

        return response
      })

      context.interceptors.error.use(error => {
        console.error('[Npora Request]', {
          type: 'error',
          error
        })

        return error
      })
    }
  }
}
