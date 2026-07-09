import type { Client } from '../client'
import type { Plugin } from './Plugin'

export function downloadPlugin(): Plugin {
  return {
    name: 'download',

    install(client: Client) {
      client.interceptors.request.use(config => {
        if (!config.download) {
          return config
        }

        return {
          ...config,
          responseType: config.responseType ?? 'blob'
        }
      })
    }
  }
}
