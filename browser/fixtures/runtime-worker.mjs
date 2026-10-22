import { runRuntimeContract } from '../../test/runtime-contract.mjs'

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('message', event => {
  event.waitUntil(runRuntimeContract(self.location.origin).then(
    result => event.ports[0].postMessage({ result }),
    error => event.ports[0].postMessage({ error: String(error), stack: error.stack })
  ))
})
