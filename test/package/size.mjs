import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { getNpmPackManifest } from './npm-pack-result.mjs'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  dirname,
  extname,
  join,
  resolve
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const currentDirectory = dirname(
  fileURLToPath(import.meta.url)
)
const rootDirectory = resolve(
  currentDirectory,
  '../..'
)
const budget = JSON.parse(
  readFileSync(
    join(currentDirectory, 'size-budget.json'),
    'utf8'
  )
)

function readOutputPath() {
  const arguments_ = process.argv
    .slice(2)
    .filter((argument, index) => (
      argument !== '--' || index !== 0
    ))

  if (arguments_.length === 0) {
    return undefined
  }

  assert.deepEqual(
    arguments_.slice(0, 1),
    ['--output'],
    'Usage: node test/package/size.mjs [--output <path>]'
  )
  assert.equal(
    arguments_.length,
    2,
    'Usage: node test/package/size.mjs [--output <path>]'
  )

  return resolve(rootDirectory, arguments_[1])
}

function inspectFiles() {
  return Object.fromEntries(
    Object.entries(budget.files).map(
      ([path, limits]) => {
        const files = limits.transitive
          ? collectDependencies(join(rootDirectory, path))
          : [join(rootDirectory, path)]
        const contents = files.map(file => readFileSync(file))

        return [
          path,
          {
            bytes: contents.reduce(
              (total, content) => total + content.byteLength,
              0
            ),
            gzipBytes: contents.reduce(
              (total, content) => total + gzipSync(content, {
                level: 9
              }).byteLength,
              0
            ),
            files: files.length,
            budget: limits
          }
        ]
      }
    )
  )
}

function collectDependencies(entry) {
  const pending = [entry]
  const visited = new Set()

  while (pending.length > 0) {
    const file = pending.pop()

    if (!file || visited.has(file)) {
      continue
    }

    visited.add(file)

    const source = readFileSync(file, 'utf8')
    const imports = [
      ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
      ...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)
    ]

    for (const match of imports) {
      const specifier = match[1]

      if (!specifier?.startsWith('.')) {
        continue
      }

      let dependency = resolve(dirname(file), specifier)

      if (!existsSync(dependency) && file.endsWith('.d.ts')) {
        dependency = dependency.replace(/\.js$/, '.d.ts')
      } else if (!existsSync(dependency) && file.endsWith('.d.cts')) {
        dependency = dependency.replace(/\.cjs$/, '.d.cts')
      }

      if (extname(dependency) && existsSync(dependency)) {
        pending.push(dependency)
      }
    }
  }

  return [...visited]
}

function inspectPackage() {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'npora-request-size-')
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
        cwd: rootDirectory,
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

    return {
      bytes: manifest.size,
      unpackedBytes: manifest.unpackedSize,
      totalFiles: manifest.totalFiles,
      budget: budget.package
    }
  } finally {
    rmSync(temporaryDirectory, {
      recursive: true,
      force: true
    })
  }
}

function verify(metric, actual, maximum) {
  assert.ok(
    actual <= maximum,
    `${metric} is ${actual} bytes; budget is ${maximum} bytes`
  )
}

function verifyReport(report) {
  for (const [path, result] of Object.entries(
    report.files
  )) {
    verify(
      `${path} raw size`,
      result.bytes,
      result.budget.bytes
    )
    verify(
      `${path} gzip size`,
      result.gzipBytes,
      result.budget.gzipBytes
    )
  }

  verify(
    'npm tarball size',
    report.package.bytes,
    report.package.budget.bytes
  )
  verify(
    'npm unpacked size',
    report.package.unpackedBytes,
    report.package.budget.unpackedBytes
  )
}

function printReport(report) {
  const rows = Object.entries(report.files).map(
    ([path, result]) => ({
      asset: path,
      bytes: result.bytes,
      budget: result.budget.bytes,
      gzip: result.gzipBytes,
      gzipBudget: result.budget.gzipBytes,
      files: result.files
    })
  )

  console.table(rows)
  console.table([
    {
      asset: 'npm tarball',
      bytes: report.package.bytes,
      budget: report.package.budget.bytes
    },
    {
      asset: 'npm unpacked',
      bytes: report.package.unpackedBytes,
      budget: report.package.budget.unpackedBytes
    }
  ])
}

const outputPath = readOutputPath()
const report = {
  generatedAt: new Date().toISOString(),
  files: inspectFiles(),
  package: inspectPackage()
}

printReport(report)
verifyReport(report)

if (outputPath) {
  mkdirSync(dirname(outputPath), {
    recursive: true
  })
  writeFileSync(
    outputPath,
    `${JSON.stringify(report, null, 2)}\n`
  )
}

console.log('Package size budgets passed.')
