import type { Client } from '../client'
import type { LoggerOptions } from '../types'
import type { Plugin } from './Plugin'

export function loggerPlugin(defaultOptions: LoggerOptions = {}): Plugin {
  return {
    name: 'logger',

    install(client: Client) {
      client.interceptors.request.use(config => {
        const logger = config.logger ?? defaultOptions

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

      client.interceptors.response.use(response => {
        const logger = response.config.logger ?? defaultOptions

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

      client.interceptors.error.use(error => {
        console.error('[Npora Request]', {
          type: 'error',
          error
        })

        return error
      })
    }
  }
}
