import type { PathLike } from 'node:fs'

export const root: string
export function hashFile(path: PathLike): string
export function measurementMetadata(): {
  package: { name: string; version: string }
  runtime: {
    node: string
    platform: string
    architecture: string
    cpuModel: string | undefined
    logicalCpus: number
  }
  provenance: {
    gitCommit: string
    gitDirty: boolean
    buildSha256: string
    dependencyLockSha256: string
  }
}
