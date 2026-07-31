import assert from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { getNpmPackManifest } from './npm-pack-result.mjs'

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), 'npora-request-pack-')
)

try {
  const result = spawnSync(
    'npm',
    [
      'pack',
      '--dry-run',
      '--json'
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: join(
          temporaryDirectory,
          'npm-cache'
        )
      }
    }
  )

  assert.equal(
    result.status,
    0,
    result.stderr || 'npm pack --dry-run failed'
  )

  const manifest = getNpmPackManifest(result.stdout)
  const paths = manifest.files
    .map(file => file.path)
    .sort()

  assert.deepEqual(paths, [
    'LICENSE',
    'README.md',
    'dist/index.cjs',
    'dist/index.d.cts',
    'dist/index.d.ts',
    'dist/index.js',
    'package.json'
  ])
} finally {
  rmSync(temporaryDirectory, {
    recursive: true,
    force: true
  })
}
