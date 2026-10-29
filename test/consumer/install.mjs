import assert from 'node:assert/strict'
import { buildInstalledWorkflows } from './build-workflows.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = mkdtempSync(join(tmpdir(), 'npora-consumer-'))

try {
  const packed = run('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', directory,
    '--cache', join(directory, 'npm-cache')
  ], root)
  const filename = JSON.parse(packed.stdout)[0]?.filename

  assert.ok(filename, 'npm pack did not produce a tarball')
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    private: true,
    type: 'module'
  }))
  run('npm', [
    'install', join(directory, basename(filename)),
    '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--cache', join(directory, 'npm-cache')
  ], directory)
  writeFileSync(
    join(directory, 'app.mjs'),
    readFileSync(new URL('./node-app.mjs', import.meta.url))
  )
  run(process.execPath, ['app.mjs'], directory)
  for (const workflow of await buildInstalledWorkflows(directory)) {
    run(process.execPath, [workflow], directory)
  }
  writeFileSync(join(directory, 'streaming-contract.mjs'),
    readFileSync(new URL('./streaming-contract.mjs', import.meta.url)))
  writeFileSync(join(directory, 'streaming.mjs'), `
    import * as esm from '@npora/request/core';
    import { downloadPlugin } from '@npora/request/plugins/download';
    import { createRequire } from 'node:module';
    import { checkStreamingContract } from './streaming-contract.mjs';
    const require = createRequire(import.meta.url);
    await checkStreamingContract({ ...esm, downloadPlugin }, 'ESM');
    await checkStreamingContract({ ...require('@npora/request/core'),
      ...require('@npora/request/plugins/download') }, 'CommonJS');
    const { toFormErrors } = await import('@npora/request/schema-errors');
    const issues = [{ message: 'Required', path: ['users', 0, 'name'] }];
    for (const flatten of [toFormErrors, require('@npora/request/schema-errors').toFormErrors]) {
      if (flatten(issues).fieldErrors['users.0.name'][0] !== 'Required') throw Error('Form error export');
    }
  `)
  run(process.execPath, ['streaming.mjs'], directory)
  for (const name of ['capabilities.mjs', 'capability-contract.mjs', 'session.mjs', 'session-contract.mjs']) {
    writeFileSync(join(directory, name), readFileSync(new URL(name, import.meta.url)))
  }
  run(process.execPath, ['capabilities.mjs'], directory)
  run(process.execPath, ['session.mjs'], directory)
  console.log('Installed package consumer, onboarding workflows, HTTP sessions, and ESM/CommonJS streaming passed.')
} finally {
  rmSync(directory, { recursive: true, force: true })
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 })

  assert.equal(result.status, 0, [
    `${command} ${args.join(' ')} failed.`, result.error?.message,
    result.signal && `Terminated by ${result.signal}`, result.stdout, result.stderr
  ].filter(Boolean).join('\n'))

  return result
}
