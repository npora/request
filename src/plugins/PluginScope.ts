import type {
  HookDisposer,
  HookOptions,
  PluginHooks
} from '../interceptors/PluginHooks'
import type {
  Interceptor,
  InterceptorManager,
  InterceptorOptions
} from '../interceptors'
import type { NporaResponse, RequestConfig } from '../types'
import type {
  PluginCleanup,
  PluginContext,
  PluginHookManager,
  PluginInterceptorManager
} from './Plugin'

interface PluginInterceptors {
  request: InterceptorManager<RequestConfig>
  response: InterceptorManager<NporaResponse>
  error: InterceptorManager<unknown>
}

export interface PluginScope {
  context: PluginContext

  addCleanup(cleanup: PluginCleanup): void

  cleanup(): void
}

/**
 * Create an isolated registration scope for one plugin.
 */
export function createPluginScope(
  interceptors: PluginInterceptors,
  hooks: PluginHooks,
  dispatch: PluginContext['dispatch'],
  priority = 0
): PluginScope {
  const cleanups: PluginCleanup[] = []

  const context: PluginContext = {
    interceptors: {
      request: createScopedInterceptor(
        interceptors.request,
        priority,
        cleanups
      ),
      response: createScopedInterceptor(
        interceptors.response,
        priority,
        cleanups
      ),
      error: createScopedInterceptor(
        interceptors.error,
        priority,
        cleanups
      )
    },
    hooks: createScopedHooks(hooks, priority, cleanups),
    dispatch
  }

  return {
    context,

    addCleanup(cleanup) {
      cleanups.push(once(cleanup))
    },

    cleanup() {
      let firstError: unknown

      for (const cleanup of [...cleanups].reverse()) {
        try {
          cleanup()
        } catch (error) {
          firstError ??= error
        }
      }

      cleanups.length = 0

      if (firstError !== undefined) {
        throw firstError
      }
    }
  }
}

function createScopedInterceptor<T>(
  manager: InterceptorManager<T>,
  pluginPriority: number,
  cleanups: PluginCleanup[]
): PluginInterceptorManager<T> {
  const ids = new Set<number>()

  cleanups.push(() => {
    for (const id of ids) {
      manager.eject(id)
    }

    ids.clear()
  })

  return {
    use(
      interceptor: Interceptor<T>,
      options: InterceptorOptions = {}
    ): number {
      const id = manager.use(interceptor, {
        priority: options.priority ?? pluginPriority
      })

      ids.add(id)

      return id
    },

    eject(id: number): void {
      manager.eject(id)
      ids.delete(id)
    }
  }
}

function createScopedHooks(
  hooks: PluginHooks,
  pluginPriority: number,
  cleanups: PluginCleanup[]
): PluginHookManager {
  return {
    onRequest(hook, options) {
      return trackHook(
        hooks.onRequest(hook, withPriority(options, pluginPriority)),
        cleanups
      )
    },

    onTransport(hook, options) {
      return trackHook(
        hooks.onTransport(hook, withPriority(options, pluginPriority)),
        cleanups
      )
    },

    onResponse(hook, options) {
      return trackHook(
        hooks.onResponse(hook, withPriority(options, pluginPriority)),
        cleanups
      )
    },

    onError(hook, options) {
      return trackHook(
        hooks.onError(hook, withPriority(options, pluginPriority)),
        cleanups
      )
    },

    onSettled(hook, options) {
      return trackHook(
        hooks.onSettled(hook, withPriority(options, pluginPriority)),
        cleanups
      )
    },

    onRetry(hook, options) {
      return trackHook(
        hooks.onRetry(hook, withPriority(options, pluginPriority)),
        cleanups
      )
    }
  }
}

function trackHook(
  dispose: HookDisposer,
  cleanups: PluginCleanup[]
): HookDisposer {
  const trackedDispose = once(dispose)

  cleanups.push(trackedDispose)

  return trackedDispose
}

function withPriority(
  options: HookOptions | undefined,
  pluginPriority: number
): HookOptions {
  return {
    ...options,
    priority: options?.priority ?? pluginPriority
  }
}

function once(cleanup: PluginCleanup): PluginCleanup {
  let active = true

  return () => {
    if (!active) {
      return
    }

    active = false
    cleanup()
  }
}
