import assert from 'node:assert/strict'
import { getNpmPackManifest } from './npm-pack-result.mjs'

const manifest = {
  name: '@npora/request',
  files: []
}

assert.deepEqual(
  getNpmPackManifest(JSON.stringify([manifest])),
  manifest
)

assert.deepEqual(
  getNpmPackManifest(JSON.stringify(manifest)),
  manifest
)

assert.throws(
  () => getNpmPackManifest('null'),
  /invalid manifest/
)
