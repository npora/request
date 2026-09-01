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

  const requiredPaths = [
    'LICENSE',
    'README.md',
    'package.json',
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/core.js',
    'dist/core.cjs',
    'dist/plugins/retry.js',
    'dist/plugins/retry.cjs',
    'dist/plugins/rate-limit.js',
    'dist/plugins/rate-limit.cjs',
    'dist/plugins/opentelemetry.js',
    'dist/plugins/opentelemetry.cjs',
    'dist/testing.js',
    'dist/testing.cjs'
  ]

  for (const path of requiredPaths) {
    assert.ok(paths.includes(path), `Missing packed file ${path}`)
  }

  assert.ok(
    paths.every(path => (
      path === 'LICENSE' ||
      path === 'README.md' ||
      path === 'package.json' ||
      (
        path.startsWith('dist/') &&
        /\.(?:js|cjs|d\.ts|d\.cts)$/.test(path)
      )
    )),
    'Tarball contains a file outside the compiled package allowlist'
  )
} finally {
  rmSync(temporaryDirectory, {
    recursive: true,
    force: true
  })
}
