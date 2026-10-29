import * as core from '@npora/request/core'
import { authPlugin } from '@npora/request/plugins/auth'
import { cachePlugin } from '@npora/request/plugins/cache'
import { retryPlugin } from '@npora/request/plugins/retry'
import { createRequire } from 'node:module'
import { checkSessionContract } from './session-contract.mjs'

const require = createRequire(import.meta.url)
await checkSessionContract({ ...core, authPlugin, cachePlugin, retryPlugin }, 'ESM')
await checkSessionContract({
  ...require('@npora/request/core'),
  ...require('@npora/request/plugins/auth'),
  ...require('@npora/request/plugins/cache'),
  ...require('@npora/request/plugins/retry')
}, 'CommonJS')
