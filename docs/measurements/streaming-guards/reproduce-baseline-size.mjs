import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = process.cwd()
const directory = mkdtempSync(join(tmpdir(), 'request-baseline-size-'))
try {
  const archive = execFileSync('git', ['archive', '085e55d05ca75ffae6833277ae6a44b5dcc65191'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  execFileSync('tar', ['-x', '-C', directory], { input: archive })
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
  execFileSync(process.execPath, [join(root, 'node_modules/tsdown/dist/run.mjs')], { cwd: directory })
  const output = join(root, 'benchmark-results/review-1.19.6/package-before.json')
  execFileSync(process.execPath, ['test/package/size.mjs', '--output', output], { cwd: directory })
  console.log(JSON.stringify(JSON.parse(readFileSync(output)).package))
} finally { rmSync(directory, { recursive: true, force: true }) }
