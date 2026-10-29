import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { cleanProject } from '../scripts/clean.mjs'

it('cleans generated files while preserving source, dependencies, secrets and evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'request-clean-'))
  try {
    const preserved = ['src/client.ts', 'website/index.html', 'docs/measurements/report.json', 'test/fixture.json',
      'node_modules/package/index.js', '.git/config', '.idea/workspace.xml', '.env', 'custom.tgz']
    const generated = ['dist/index.js', 'website/dist/index.html', '.artifacts/coverage/index.html', 'coverage/index.html',
      'benchmark-results/report.json', 'browser/test-results/results.json',
      'node_modules/.vite/cache', '.pnpm-store/index.db', 'npora-request-1.21.1.tgz']
    for (const path of [...preserved, ...generated]) {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), path)
    }
    const preview = await cleanProject(root, { dryRun: true })
    expect(preview).toContain('dist')
    expect(await readFile(join(root, 'dist/index.js'), 'utf8')).toBe('dist/index.js')
    expect(await cleanProject(root)).toEqual(preview)
    for (const path of preserved) expect(await readFile(join(root, path), 'utf8')).toBe(path)
    for (const path of generated) await expect(lstat(join(root, path))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await cleanProject(root)).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('removes output symlinks without deleting their external targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'request-clean-root-'))
  const external = await mkdtemp(join(tmpdir(), 'request-clean-external-'))
  try {
    await writeFile(join(external, 'keep'), 'preserved')
    await mkdir(join(external, '.cache'))
    await writeFile(join(external, '.cache/keep'), 'external cache')
    await mkdir(join(external, 'dist'))
    await writeFile(join(external, 'dist/keep'), 'external website output')
    await symlink(external, join(root, 'dist'), process.platform === 'win32' ? 'junction' : 'dir')
    await symlink(external, join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    await symlink(external, join(root, 'website'), process.platform === 'win32' ? 'junction' : 'dir')
    await cleanProject(root)
    expect(await readFile(join(external, 'keep'), 'utf8')).toBe('preserved')
    expect(await readFile(join(external, '.cache/keep'), 'utf8')).toBe('external cache')
    expect(await readFile(join(external, 'dist/keep'), 'utf8')).toBe('external website output')
    await expect(lstat(join(root, 'dist'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(external, { recursive: true, force: true })
  }
})
