import { describe, expect, it, vi } from 'vitest'
import type { CacheEntry, CacheStore } from '../src'
import {
  MemoryCacheStore,
  TieredCacheStore
} from '../src'

function createEntry(data: unknown): CacheEntry {
  return {
    data,
    expiresAt: Infinity,
    status: 200,
    statusText: 'OK',
    headers: []
  }
}

function createStore(
  overrides: Partial<CacheStore> = {}
): CacheStore {
  return {
    get() {
      return undefined
    },
    set() {},
    delete() {},
    clear() {},
    ...overrides
  }
}

function createBroadcastPair(): {
  channels: [BroadcastChannel, BroadcastChannel]
  messages: unknown[]
} {
  const listeners = [
    new Set<(event: MessageEvent<unknown>) => void>(),
    new Set<(event: MessageEvent<unknown>) => void>()
  ]
  const messages: unknown[] = []
  const createChannel = (index: number) => ({
    addEventListener(
      _type: string,
      listener: (event: MessageEvent<unknown>) => void
    ) {
      listeners[index]?.add(listener)
    },
    removeEventListener(
      _type: string,
      listener: (event: MessageEvent<unknown>) => void
    ) {
      listeners[index]?.delete(listener)
    },
    postMessage(message: unknown) {
      messages.push(message)
      queueMicrotask(() => {
        for (const listener of listeners[1 - index] ?? []) {
          listener({ data: structuredClone(message) } as MessageEvent)
        }
      })
    }
  }) as unknown as BroadcastChannel

  return {
    channels: [createChannel(0), createChannel(1)],
    messages
  }
}

async function flushBroadcast(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createLockManager(): {
  locks: LockManager
  names: string[]
} {
  const active = new Set<string>()
  const tails = new Map<string, Promise<void>>()
  const names: string[] = []
  const request = (
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => unknown
  ): Promise<unknown> => {
    names.push(name)

    if (options.ifAvailable && active.has(name)) {
      return Promise.resolve(callback(null))
    }

    const previous = tails.get(name) ?? Promise.resolve()
    const operation = previous.then(async () => {
      active.add(name)

      try {
        return await callback({
          mode: 'exclusive',
          name
        })
      } finally {
        active.delete(name)
      }
    })
    const tail = operation.then(() => {}, () => {})

    tails.set(name, tail)
    void tail.finally(() => {
      if (tails.get(name) === tail) {
        tails.delete(name)
      }
    })
    return operation
  }

  return {
    locks: { request } as unknown as LockManager,
    names
  }
}

describe('TieredCacheStore', () => {
  it('should return primary hits synchronously', () => {
    const entry = createEntry({ source: 'primary' })
    const primary = createStore({ get: vi.fn(() => entry) })
    const secondary = createStore({ get: vi.fn() })
    const store = new TieredCacheStore({ primary, secondary })

    expect(store.get('key')).toBe(entry)
    expect(secondary.get).not.toHaveBeenCalled()
  })

  it('should promote secondary hits into memory', async () => {
    const primary = new MemoryCacheStore()
    const entry = createEntry({ source: 'secondary' })
    const secondary = createStore({
      get: vi.fn(() => Promise.resolve(entry))
    })
    const store = new TieredCacheStore({ primary, secondary })

    await expect(store.get('key')).resolves.toBe(entry)
    expect(store.get('key')).toBe(entry)
    expect(secondary.get).toHaveBeenCalledTimes(1)
  })

  it('should finish the secondary write before the primary write', async () => {
    let finishSecondary!: () => void
    const calls: string[] = []
    const primary = createStore({
      set: vi.fn(() => {
        calls.push('primary')
      })
    })
    const secondary = createStore({
      set: vi.fn(() => new Promise<void>(resolve => {
        finishSecondary = () => {
          calls.push('secondary')
          resolve()
        }
      }))
    })
    const store = new TieredCacheStore({ primary, secondary })
    const write = store.set('key', createEntry(true))

    expect(primary.set).not.toHaveBeenCalled()
    finishSecondary()
    await write

    expect(calls).toEqual(['secondary', 'primary'])
  })

  it('should not write the primary when the secondary write fails', async () => {
    const primary = createStore({ set: vi.fn() })
    const secondary = createStore({
      set: vi.fn(() => Promise.reject(new Error('persistent failure')))
    })
    const store = new TieredCacheStore({ primary, secondary })

    await expect(store.set('key', createEntry(true))).rejects.toThrow(
      'persistent failure'
    )
    expect(primary.set).not.toHaveBeenCalled()
  })

  it('should recover other primaries after a partial write failure', async () => {
    const secondary = new MemoryCacheStore()
    const { channels } = createBroadcastPair()
    const remote = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary,
      broadcast: { channel: channels[1] }
    })

    secondary.set('key', createEntry('old'))
    expect(remote.get('key')?.data).toBe('old')

    const failing = new TieredCacheStore({
      primary: createStore({
        set() {
          throw new Error('primary write failure')
        }
      }),
      secondary,
      broadcast: { channel: channels[0] }
    })

    expect(() => failing.set('key', createEntry('new'))).toThrow(
      'primary write failure'
    )
    await flushBroadcast()

    expect(remote.get('key')?.data).toBe('new')
  })

  it('should isolate promotion failures from secondary hits', async () => {
    const entry = createEntry(true)
    const primary = createStore({
      set: vi.fn(() => Promise.reject(new Error('promotion failure')))
    })
    const secondary = createStore({ get: vi.fn(() => entry) })
    const store = new TieredCacheStore({ primary, secondary })

    await expect(store.get('key')).resolves.toBe(entry)
  })

  it('should attempt deletion in both tiers before reporting failure', () => {
    const primary = createStore({
      delete: vi.fn(() => {
        throw new Error('primary failure')
      })
    })
    const secondary = createStore({ delete: vi.fn() })
    const store = new TieredCacheStore({ primary, secondary })

    expect(() => store.delete('key')).toThrow('primary failure')
    expect(secondary.delete).toHaveBeenCalledWith('key')
  })

  it('should clear both tiers when one asynchronous clear fails', async () => {
    const primary = createStore({
      clear: vi.fn(() => Promise.reject(new Error('primary clear failure')))
    })
    const secondary = createStore({ clear: vi.fn() })
    const store = new TieredCacheStore({ primary, secondary })

    await expect(store.clear()).rejects.toThrow('primary clear failure')
    expect(secondary.clear).toHaveBeenCalledTimes(1)
  })

  it('should invalidate tags in both tiers', async () => {
    const primary = createStore({ invalidateTags: vi.fn(() => 1) })
    const secondary = createStore({
      invalidateTags: vi.fn(() => Promise.resolve(2))
    })
    const store = new TieredCacheStore({ primary, secondary })

    await expect(store.invalidateTags(['users'])).resolves.toBe(2)
    expect(primary.invalidateTags).toHaveBeenCalledWith(['users'])
    expect(secondary.invalidateTags).toHaveBeenCalledWith(['users'])
  })

  it('should require tag invalidation support in both tiers', () => {
    const store = new TieredCacheStore({
      primary: createStore(),
      secondary: createStore({ invalidateTags: vi.fn(() => 0) })
    })

    expect(() => store.invalidateTags(['users'])).toThrow(
      /both tiered cache stores/i
    )
  })

  it('should reject using the same store for both tiers', () => {
    const cache = createStore()

    expect(() => new TieredCacheStore({
      primary: cache,
      secondary: cache
    })).toThrow(/distinct primary and secondary/i)
  })

  it('should invalidate another context primary after a write', async () => {
    const secondary = new MemoryCacheStore()
    const { channels, messages } = createBroadcastPair()
    const first = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary,
      broadcast: { channel: channels[0] }
    })
    const second = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary,
      broadcast: { channel: channels[1] }
    })
    const key = 'authorization:Bearer super-secret'

    first.set(key, createEntry({ version: 1, secret: 'response-secret' }))
    await flushBroadcast()
    expect(second.get(key)?.data).toEqual({
      version: 1,
      secret: 'response-secret'
    })

    first.set(key, createEntry({ version: 2 }))
    await flushBroadcast()

    expect(second.get(key)?.data).toEqual({ version: 2 })
    expect(JSON.stringify(messages)).not.toContain('super-secret')
    expect(JSON.stringify(messages)).not.toContain('response-secret')
  })

  it('should clear a remote primary after tag invalidation', async () => {
    const secondary = new MemoryCacheStore()
    const { channels } = createBroadcastPair()
    const first = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary,
      broadcast: { channel: channels[0] }
    })
    const second = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary,
      broadcast: { channel: channels[1] }
    })
    const entry = { ...createEntry(true), tags: ['users'] }

    first.set('tagged', entry)
    await flushBroadcast()
    expect(second.get('tagged')).toBe(entry)

    first.invalidateTags(['users'])
    await flushBroadcast()

    expect(second.get('tagged')).toBeUndefined()
  })

  it('should stop cross-context invalidation after disposal', async () => {
    const secondary = new MemoryCacheStore()
    const { channels } = createBroadcastPair()
    const first = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary,
      broadcast: { channel: channels[0] }
    })
    const second = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary,
      broadcast: { channel: channels[1] }
    })

    first.set('key', createEntry('old'))
    await flushBroadcast()
    expect(second.get('key')?.data).toBe('old')
    second.dispose()

    first.set('key', createEntry('new'))
    await flushBroadcast()

    expect(second.get('key')?.data).toBe('old')
  })

  it('should validate the cross-context tracking bound', () => {
    const { channels } = createBroadcastPair()

    expect(() => new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary: new MemoryCacheStore(),
      broadcast: {
        channel: channels[0],
        maxTrackedKeys: 0
      }
    })).toThrow(/maxTrackedKeys/)
  })

  it('should serialize refresh leases and evict a contended primary', async () => {
    const { locks } = createLockManager()
    const stalePrimary = createStore({
      delete: vi.fn()
    })
    const first = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary: new MemoryCacheStore(),
      coordination: { locks, namespace: 'application' }
    })
    const second = new TieredCacheStore({
      primary: stalePrimary,
      secondary: new MemoryCacheStore(),
      coordination: { locks, namespace: 'application' }
    })
    const firstLease = await first.acquireRefreshLease!('private-key')
    const secondLeasePromise = second.acquireRefreshLease!('private-key')
    let secondAcquired = false

    void secondLeasePromise.then(() => {
      secondAcquired = true
    })
    await flushBroadcast()
    expect(secondAcquired).toBe(false)

    firstLease.release()
    const secondLease = await secondLeasePromise

    expect(firstLease.contended).toBe(false)
    expect(secondLease.contended).toBe(true)
    expect(stalePrimary.delete).toHaveBeenCalledWith('private-key')
    secondLease.release()
  })

  it('should not expose cache keys in refresh lock names', async () => {
    const { locks, names } = createLockManager()
    const store = new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary: new MemoryCacheStore(),
      coordination: { locks, namespace: 'safe-app' }
    })
    const lease = await store.acquireRefreshLease!('Bearer super-secret')

    expect(names[0]).toMatch(/^safe-app:[a-z0-9]+$/)
    expect(names.join(' ')).not.toContain('super-secret')
    lease.release()
  })

  it('should validate the refresh lock namespace', () => {
    const { locks } = createLockManager()

    expect(() => new TieredCacheStore({
      primary: new MemoryCacheStore(),
      secondary: new MemoryCacheStore(),
      coordination: { locks, namespace: '' }
    })).toThrow(/namespace/)
  })
})
