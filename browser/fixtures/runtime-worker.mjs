import { runRuntimeContract } from '../../test/runtime-contract.mjs'

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('message', event => {
  if (event.origin !== self.location.origin) return
  if (event.data !== 'run' || !event.ports[0]) return
  event.waitUntil(runRuntimeContract(self.location.origin).then(
    result => event.ports[0].postMessage({ result }),
    error => event.ports[0].postMessage({ error: String(error), stack: error.stack })
  ))
})
