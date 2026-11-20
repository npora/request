import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'

/** Follow declaration references as types, even when matching JS chunks exist. */
export function collectDependencies(entry) {
  const pending = [entry]
  const visited = new Set()
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    const imports = [
      ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
      ...source.matchAll(/\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g)
    ]
    for (const match of imports) {
      const specifier = match[1]
      if (!specifier?.startsWith('.')) continue
      let dependency = resolve(dirname(file), specifier)
      if (/\.d\.(?:ts|mts|cts)$/.test(file)) {
        dependency = dependency.replace(/\.(js|mjs|cjs)$/, (_, extension) => ({
          js: '.d.ts', mjs: '.d.mts', cjs: '.d.cts'
        })[extension])
      }
      if (!extname(dependency) || !existsSync(dependency)) {
        throw new Error(`Missing package dependency ${dependency} referenced by ${file}`)
      }
      pending.push(dependency)
    }
  }
  return [...visited]
}
