import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

export function uploadPlugin(): Plugin {
  return {
    name: 'upload',

    install(context) {
      context.interceptors.request.use(config => {
        const upload = resolveExtensionConfig(
          config,
          'upload',
          config.upload
        )

        if (!upload) {
          return config
        }

        return {
          ...config,
          method: config.method ?? 'POST',
          formData: upload.data,
          upload: undefined
        }
      })
    }
  }
}
