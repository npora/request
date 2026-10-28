import * as core from '@npora/request/core'
import * as cache from '@npora/request/plugins/cache'
import { toFormErrors } from '@npora/request/schema-errors'
import { createRequire } from 'node:module'
import { checkCapabilityContract } from './capability-contract.mjs'

const require = createRequire(import.meta.url)
await checkCapabilityContract({ ...core, ...cache, toFormErrors }, 'ESM')
await checkCapabilityContract({
  ...require('@npora/request/core'),
  ...require('@npora/request/plugins/cache'),
  ...require('@npora/request/schema-errors')
}, 'CommonJS')
