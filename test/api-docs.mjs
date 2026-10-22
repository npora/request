import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'

const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
const sorted = values => [...new Set(values)].sort()

function properties(source, name) {
  const declaration = source.statements.find(node =>
    ts.isInterfaceDeclaration(node) && node.name.text === name)
  assert.ok(declaration, `${name} interface is missing`)
  return declaration.members.map(member => {
    assert.ok(ts.isPropertySignature(member) && member.name &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)),
    `${name} must contain named properties`)
    return member.name.text
  })
}

export function checkApiDocs(root) {
  const read = path => readFileSync(join(root, path), 'utf8')
  const config = parse('config.ts', read('src/types/config.ts'))
  const expectedFields = sorted(properties(config, 'RequestConfig'))
  const api = read('docs/api.md')
  const configuration = read('docs/configuration.md')
  const readme = read('README.md')
  const documentedFields = []
  for (const section of ['Base', 'Body', 'Control', 'Response']) {
    const block = api.match(new RegExp(`^## ${section}\\n\\n\x60\x60\x60ts\\n([\\s\\S]*?)\x60\x60\x60`, 'm'))?.[1]
    assert.ok(block, `API ${section} config block is missing`)
    documentedFields.push(...properties(parse('docs.ts', `interface Documented ${block}`), 'Documented'))
  }
  assert.deepEqual(sorted(documentedFields), expectedFields,
    'API config fields differ from RequestConfig')

  // Only option tables before plugin extensions count; mentions in prose do not.
  const coreOptions = configuration.split('## Extension options')[0]
  const optionRows = sorted([...coreOptions.matchAll(/^\| `([A-Za-z]\w*)` \|/gm)]
    .map(match => match[1]))
  for (const field of expectedFields) {
    assert.ok(optionRows.includes(field), `Configuration option table is missing ${field}`)
  }

  const manifest = JSON.parse(read('package.json'))
  const publicPaths = Object.keys(manifest.exports).sort()
  const table = api.match(/^<!-- public-entrypoints -->\n([\s\S]*?)^<!-- \/public-entrypoints -->/m)?.[1]
  assert.ok(table, 'Public entrypoint table is missing')
  const paths = [...table.matchAll(/^\| `(\.[^`]*)` \|/gm)].map(match => match[1]).sort()
  assert.deepEqual(paths, publicPaths, 'API entrypoints differ from package.json exports')

  // Derive plugin factories from the source files behind the public build entries.
  const build = parse('tsdown.config.ts', read('tsdown.config.ts'))
  let entries
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(build) === 'entry') {
      entries = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(build)
  assert.ok(entries && ts.isObjectLiteralExpression(entries), 'Build entry map is missing')
  const factories = []
  for (const path of publicPaths.filter(path => path.startsWith('./plugins/'))) {
    const entry = entries.properties.find(node => ts.isPropertyAssignment(node) &&
      node.name.text === path.slice(2))
    assert.ok(entry && ts.isStringLiteral(entry.initializer), `Build entry is missing ${path}`)
    const source = parse(entry.initializer.text, read(entry.initializer.text))
    const names = source.statements.filter(node => ts.isFunctionDeclaration(node) &&
      node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      node.name?.text.endsWith('Plugin')).map(node => node.name.text)
    assert.equal(names.length, 1, `${path} must expose one plugin factory`)
    factories.push(...names)
  }
  const list = readme.match(/Built-in plugins:\s*\n((?:- `\w+\(\)`\s*\n)+)/)?.[1]
  assert.ok(list, 'README built-in plugin list is missing')
  const listedFactories = [...list.matchAll(/`(\w+)\(\)`/g)].map(match => match[1]).sort()
  assert.deepEqual(listedFactories, factories.sort(), 'README plugin list differs from public plugin factories')
  return { fields: expectedFields.length, entrypoints: publicPaths.length, plugins: factories.length }
}
