import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
  readdirSync
} from 'node:fs'
import {
  dirname,
  join,
  resolve
} from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(
  new URL('../', import.meta.url)
)
const documents = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  ...readdirSync(join(root, 'docs'))
    .filter(file => file.endsWith('.md'))
    .map(file => join('docs', file))
]
const missing = []

for (const document of documents) {
  const source = readFileSync(
    join(root, document),
    'utf8'
  )
  const links = source.matchAll(
    /(?<!!)\[[^\]]+\]\(([^)]+)\)/g
  )

  for (const match of links) {
    const target = match[1]?.trim()

    if (
      !target ||
      target.startsWith('#') ||
      /^[a-z][a-z\d+\-.]*:/i.test(target)
    ) {
      continue
    }

    const path = decodeURIComponent(
      target.split('#', 1)[0]
    )
    const absolutePath = resolve(
      root,
      dirname(document),
      path
    )

    if (!existsSync(absolutePath)) {
      missing.push(`${document}: ${target}`)
    }
  }
}

assert.deepEqual(
  missing,
  [],
  `Broken documentation links:\n${missing.join('\n')}`
)

console.log(
  `Documentation links passed for ${documents.length} files.`
)
