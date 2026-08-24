import { RequestError } from '../errors'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import { xhrRequest } from './xhrTransport'

export function uploadPlugin(): Plugin {
  return {
    name: 'upload',

    install(context) {
      context.interceptors.request.use(config => {
        const upload = resolveExtensionConfig(
          config,
          'upload'
        )

        if (!upload) {
          return config
        }

        return {
          ...config,
          method: config.method ?? 'POST',
          formData: upload.data
        }
      })

      context.hooks.onTransport(async requestContext => {
        if (requestContext.response) {
          return
        }

        const upload = resolveExtensionConfig(
          requestContext.config,
          'upload'
        )

        if (!upload?.onProgress) {
          return
        }

        if (typeof XMLHttpRequest === 'undefined') {
          throw new RequestError(
            'XMLHttpRequest is unavailable for upload progress',
            {
              code: 'CONFIG_ERROR',
              config: requestContext.config
            }
          )
        }

        requestContext.response = await xhrRequest(
          requestContext.config,
          {
            onUploadProgress: upload.onProgress,
            preserveRaw: requestContext.preserveRaw
          }
        )
      })
    }
  }
}
