import { createClient, FetchAdapter } from '../src/core-entry.ts'
import { MockAdapter } from '../src/adapters/MockAdapter.ts'
import { t } from './i18n.js'

export function setupRecordingDemo() {
  const run = document.getElementById('fixture-run')
  const copy = document.getElementById('fixture-copy')
  const output = document.getElementById('fixture-output')
  const status = document.getElementById('fixture-status')
  let controller, script = '', busy = false, message = 'recording.idle'
  const render = () => {
    run.disabled = busy; copy.disabled = busy || !script
    run.textContent = t(busy ? 'recording.pending' : 'recording.action')
    copy.textContent = t('recording.copy')
    output.textContent = script || t('recording.placeholder')
    status.textContent = t(message)
    output.parentElement.setAttribute('aria-busy', String(busy))
  }
  run.addEventListener('click', async () => {
    busy = true; message = 'recording.pending'; controller = new AbortController(); render()
    try {
      const mock = new MockAdapter({ record: {
        adapter: new FetchAdapter(), maxEntries: 1, maxRecordSize: 32768,
        transform(recording) {
          // Exclude volatile infrastructure headers from this portable demo fixture.
          recording.response.headers = { 'content-type': 'application/json' }
          return recording
        }
      } })
      await createClient({ baseURL: `${location.origin}/api`, adapter: mock,
        signal: controller.signal, timeout: 10000 }).get('/user')
      script = mock.exportMocks()
      if (!script) throw new Error('No supported response was recorded')
      message = 'recording.ready'
    } catch {
      script = ''; message = 'recording.failed'
    } finally { busy = false; controller = undefined; render() }
  })
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(script); message = 'recording.copied' }
    catch { message = 'recording.copy-fallback' }
    render()
  })
  render()
  return { render, dispose: () => controller?.abort() }
}
