import { describe, expect, it, vi } from 'vitest'

const retryModuleUrl = new URL(
  './package/registry-retry.mjs',
  import.meta.url
)
const {
  isRegistryPropagationFailure,
  retryRegistryInstall
} = await import(retryModuleUrl.href)

describe('registry install retry', () => {
  it('retries npm metadata propagation failures with configured delays', async () => {
    const install = vi.fn()
      .mockReturnValueOnce(failure('ETARGET'))
      .mockReturnValueOnce(failure('E404'))
      .mockReturnValue(success())
    const wait = vi.fn().mockResolvedValue(undefined)
    const onRetry = vi.fn()

    await expect(retryRegistryInstall(install, {
      delays: [10, 20],
      wait,
      onRetry
    })).resolves.toEqual(success())
    expect(install).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toEqual([[10], [20]])
    expect(onRetry.mock.calls).toEqual([
      [{ attempt: 2, delay: 10, maximumAttempts: 3 }],
      [{ attempt: 3, delay: 20, maximumAttempts: 3 }]
    ])
  })

  it('does not retry installation or package execution failures', async () => {
    const result = failure('EACCES')
    const install = vi.fn().mockReturnValue(result)
    const wait = vi.fn()

    await expect(retryRegistryInstall(install, {
      delays: [10, 20],
      wait
    })).resolves.toBe(result)
    expect(install).toHaveBeenCalledOnce()
    expect(wait).not.toHaveBeenCalled()
  })

  it('returns the final registry failure after exhausting retries', async () => {
    const result = failure('ETARGET')
    const install = vi.fn().mockReturnValue(result)
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(retryRegistryInstall(install, {
      delays: [10, 20],
      wait
    })).resolves.toBe(result)
    expect(install).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toEqual([[10], [20]])
  })

  it('tolerates multi-minute default registry propagation delays', async () => {
    const install = vi.fn()
      .mockReturnValueOnce(failure('ETARGET'))
      .mockReturnValueOnce(failure('ETARGET'))
      .mockReturnValueOnce(failure('E404'))
      .mockReturnValueOnce(failure('ETARGET'))
      .mockReturnValueOnce(failure('E404'))
      .mockReturnValueOnce(failure('ETARGET'))
      .mockReturnValueOnce(failure('E404'))
      .mockReturnValue(success())
    const wait = vi.fn().mockResolvedValue(undefined)
    const onRetry = vi.fn()

    await expect(retryRegistryInstall(install, {
      wait,
      onRetry
    })).resolves.toEqual(success())
    expect(install).toHaveBeenCalledTimes(8)
    expect(wait.mock.calls).toEqual([
      [2_000],
      [4_000],
      [8_000],
      [16_000],
      [30_000],
      [30_000],
      [30_000]
    ])
    expect(onRetry).toHaveBeenLastCalledWith({
      attempt: 8,
      delay: 30_000,
      maximumAttempts: 34
    })
  })

  it('keeps polling when the published version takes twelve minutes to appear', async () => {
    let elapsed = 0
    const install = vi.fn(() => elapsed < 12 * 60_000 ? failure('ETARGET') : success())
    const wait = vi.fn(async (delay: number) => { elapsed += delay })

    await expect(retryRegistryInstall(install, { wait })).resolves.toEqual(success())
    expect(elapsed).toBe(12 * 60_000)
    expect(install).toHaveBeenCalledTimes(28)
    expect(wait.mock.calls.every(([delay]) => delay <= 30_000)).toBe(true)
  })

  it('stops after fifteen minutes of default scheduled waits', async () => {
    const result = failure('E404')
    const install = vi.fn(() => result)
    let elapsed = 0
    const wait = vi.fn(async (delay: number) => { elapsed += delay })

    await expect(retryRegistryInstall(install, { wait })).resolves.toBe(result)
    expect(elapsed).toBe(15 * 60_000)
    expect(install).toHaveBeenCalledTimes(34)
  })

  it('does not retry a killed install with propagation text in its output', async () => {
    const result = { ...failure('E404'), status: null, signal: 'SIGTERM' }
    const install = vi.fn(() => result)
    const wait = vi.fn()

    await expect(retryRegistryInstall(install, { wait })).resolves.toBe(result)
    expect(install).toHaveBeenCalledOnce()
    expect(wait).not.toHaveBeenCalled()
  })

  it('recognizes propagation codes in either npm output stream', () => {
    expect(isRegistryPropagationFailure(failure('ETARGET'))).toBe(true)
    expect(isRegistryPropagationFailure({
      status: 1,
      stdout: 'npm error code E404',
      stderr: ''
    })).toBe(true)
    expect(isRegistryPropagationFailure(failure('EACCES'))).toBe(false)
  })
})

function success() {
  return { status: 0, stdout: '', stderr: '' }
}

function failure(code: string) {
  return {
    status: 1,
    stdout: '',
    stderr: `npm error code ${code}`
  }
}
