import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus } from 'node:os'

export const root = fileURLToPath(new URL('../', import.meta.url))

export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function measurementMetadata() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const hash = createHash('sha256')
  function visit(directory, prefix = '') {
    for (const name of readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = `${prefix}${name.name}`
      if (name.isDirectory()) visit(join(directory, name.name), `${relative}/`)
      else {
        hash.update(`${relative}\0`)
        hash.update(readFileSync(join(directory, name.name)))
        hash.update('\0')
      }
    }
  }
  visit(join(root, 'dist'))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  return {
    package: { name: manifest.name, version: manifest.version },
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuModel: cpus()[0]?.model,
      logicalCpus: cpus().length
    },
    provenance: {
      gitCommit: git(['rev-parse', 'HEAD']),
      gitDirty: git(['status', '--porcelain']).length > 0,
      buildSha256: hash.digest('hex'),
      dependencyLockSha256: hashFile(join(root, 'pnpm-lock.yaml'))
    }
  }
}
