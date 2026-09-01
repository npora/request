import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(
  new URL('../../', import.meta.url)
)
const packageManifest = JSON.parse(
  readFileSync(
    join(projectRoot, 'package.json'),
    'utf8'
  )
)
const packageName = packageManifest.name
const expectedVersion = process.env.EXPECTED_PACKAGE_VERSION
const packageSpec = expectedVersion
  ? `${packageName}@${expectedVersion}`
  : `${packageName}@latest`
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), 'npora-request-registry-')
)
const npmCache = join(temporaryDirectory, 'npm-cache')

try {
  writeFileSync(
    join(temporaryDirectory, 'package.json'),
    JSON.stringify({
      private: true
    })
  )

  run(
    'npm',
    [
      'install',
      packageSpec,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund'
    ]
  )

  const installedManifest = JSON.parse(
    readFileSync(
      join(
        temporaryDirectory,
        'node_modules',
        ...packageName.split('/'),
        'package.json'
      ),
      'utf8'
    )
  )

  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        `import { createClient } from '${packageName}/core';`,
        `import { retryPlugin } from '${packageName}/plugins/retry';`,
        `import { MockAdapter } from '${packageName}/testing';`,
        'const adapter = new MockAdapter();',
        "adapter.onGet('/smoke').networkErrorOnce();",
        "adapter.onGet('/smoke').reply(200, { format: 'esm' });",
        'const client = createClient({ adapter }).use(retryPlugin({ retries: 1 }));',
        'const data = await client.get("/smoke");',
        "if (data.format !== 'esm') process.exit(1)"
      ].join('\n')
    ]
  )

  run(
    process.execPath,
    [
      '--eval',
      [
        `const { createClient } = require('${packageName}/core');`,
        `const { retryPlugin } = require('${packageName}/plugins/retry');`,
        `const { MockAdapter } = require('${packageName}/adapters/mock');`,
        'const adapter = new MockAdapter();',
        "adapter.onGet('/smoke').networkErrorOnce();",
        "adapter.onGet('/smoke').reply(200, { format: 'cjs' });",
        'createClient({ adapter }).use(retryPlugin({ retries: 1 })).get("/smoke")',
        "  .then(data => { if (data.format !== 'cjs') process.exit(1) })",
        '  .catch(() => process.exit(1))'
      ].join('\n')
    ]
  )

  assert.equal(installedManifest.name, packageName)
  if (expectedVersion) {
    assert.equal(installedManifest.version, expectedVersion)
  }
  console.log(
    `Registry smoke test passed for ${packageName}@${installedManifest.version} ` +
      `on ${process.version}.`
  )
} finally {
  rmSync(temporaryDirectory, {
    recursive: true,
    force: true
  })
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: temporaryDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: npmCache
    }
  })

  assert.equal(
    result.status,
    0,
    [
      `${command} ${args.join(' ')} failed.`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n')
  )
}
