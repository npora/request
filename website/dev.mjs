// Starts the external DO Worker before Pages so Wrangler can discover the binding.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('./', import.meta.url))
const cli = fileURLToPath(new URL('./node_modules/wrangler/bin/wrangler.js', import.meta.url))
const children = new Set()
let closing = false
function close(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}
process.on('SIGINT', () => close())
process.on('SIGTERM', () => close())
function start(args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  child.on('exit', code => { children.delete(child); if (!closing) close(code || 1) })
  child.on('error', error => { console.error(error); close(1) })
  child.stderr.on('data', data => process.stderr.write(data))
  return child
}
const state = start(['dev', '--config', 'state/wrangler.jsonc', '--ip', '127.0.0.1', '--port', '8788', '--persist-to', '../../.artifacts/website/do-state'])
let started = false
state.stdout.on('data', data => {
  process.stdout.write(data)
  if (!started && data.toString().includes('Ready on')) {
    started = true
    const pages = start(['pages', 'dev', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', '../.artifacts/website/pages-state'])
    pages.stdout.on('data', chunk => process.stdout.write(chunk))
  }
})
