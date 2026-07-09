import type { Client } from '../client'
import type { Plugin } from './Plugin'

export function uploadPlugin(): Plugin {
  return {
    name: 'upload',

    install(client: Client) {
      client.interceptors.request.use(config => {
        if (!config.upload) {
          return config
        }

        return {
          ...config,
          method: config.method ?? 'POST',
          formData: config.upload.data,
          upload: undefined
        }
      })
    }
  }
}
