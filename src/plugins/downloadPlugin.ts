import type { Plugin } from './Plugin'

export function downloadPlugin(): Plugin {
  return {
    name: 'download',

    install(context) {
      context.interceptors.request.use(config => {
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
