import { lstat, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const generatedPaths = [
  '.artifacts', 'dist', 'website/dist', 'coverage', 'benchmark-results', 'package-size-results',
  'playwright-report', 'test-results', 'browser/playwright-report', 'browser/test-results',
  'benchmark/competitors/library-comparison-result.json',
  '.pnpm-store', 'node_modules/.cache', 'node_modules/.vite', 'node_modules/.tmp'
]

/** Remove only known generated outputs; source, dependencies and local settings stay intact. */
export async function cleanProject(root, { dryRun = false } = {}) {
  const tarballs = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /^npora-request-\d+\.\d+\.\d+(?:-[\w.-]+)?\.tgz$/.test(entry.name))
    .map(entry => entry.name)
  const removed = []
  for (const relative of [...generatedPaths, ...tarballs]) {
    if (await hasSymlinkParent(root, relative)) continue
    const path = join(root, relative)
    try { await lstat(path) } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    // rm unlinks a symlink itself; it does not follow it into another directory.
    if (!dryRun) await rm(path, { recursive: true, force: true })
    removed.push(relative)
  }
  return removed
}

async function hasSymlinkParent(root, relative) {
  let parent = root
  for (const part of relative.split('/').slice(0, -1)) {
    parent = join(parent, part)
    try {
      if ((await lstat(parent)).isSymbolicLink()) return true
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }
  return false
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
    throw new Error('Usage: node scripts/clean.mjs [--dry-run]')
  }
  const dryRun = args[0] === '--dry-run'
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  for (const path of await cleanProject(root, { dryRun })) {
    console.log(`${dryRun ? 'Would remove' : 'Removed'} ${path}`)
  }
}
