import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { runRuntimeContract } from './runtime-contract.mjs'

vi.mock('./runtime-contract.mjs', () => ({
  runRuntimeContract: vi.fn(async () => ({ ok: true }))
}))

interface Message {
  origin: string
  data: unknown
  ports: Array<{ postMessage: (value: unknown) => void }>
  waitUntil: (promise: Promise<unknown>) => void
}

let receive: (event: Message) => void

beforeAll(async () => {
  vi.stubGlobal('self', {
    location: { origin: 'https://app.test' },
    addEventListener(type: string, listener: typeof receive) {
      if (type === 'message') receive = listener
    }
  })
  await import('../browser/fixtures/runtime-worker.mjs')
})
afterEach(() => vi.clearAllMocks())
afterAll(() => vi.unstubAllGlobals())

it.each(['https://attacker.test', 'https://app.test.attacker.test', 'null', ''])(
  'does not execute contracts for an untrusted message origin: %s', origin => {
    const postMessage = vi.fn()
    const waitUntil = vi.fn()
    receive({ origin, data: 'run', ports: [{ postMessage }], waitUntil })
    expect(runRuntimeContract).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  }
)

it('ignores unexpected commands and missing reply ports', () => {
  const waitUntil = vi.fn()
  receive({ origin: 'https://app.test', data: 'unknown', ports: [{ postMessage: vi.fn() }], waitUntil })
  receive({ origin: 'https://app.test', data: 'run', ports: [], waitUntil })
  expect(runRuntimeContract).not.toHaveBeenCalled()
  expect(waitUntil).not.toHaveBeenCalled()
})

it('runs and replies only to a same-origin command with a reply port', async () => {
  const postMessage = vi.fn()
  let pending: Promise<unknown> | undefined
  receive({
    origin: 'https://app.test', data: 'run', ports: [{ postMessage }],
    waitUntil(promise) { pending = promise }
  })
  await pending
  expect(runRuntimeContract).toHaveBeenCalledWith('https://app.test')
  expect(postMessage).toHaveBeenCalledWith({ result: { ok: true } })
})
