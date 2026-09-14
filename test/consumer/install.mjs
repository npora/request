import assert from 'node:assert/strict'
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
  console.log('Installed package consumer passed.')
} finally {
  rmSync(directory, { recursive: true, force: true })
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })

  assert.equal(result.status, 0, [
    `${command} ${args.join(' ')} failed.`, result.stdout, result.stderr
  ].filter(Boolean).join('\n'))

  return result
}
