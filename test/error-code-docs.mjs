import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'

export function checkErrorCodeDocs(root) {
  const source = ts.createSourceFile('RequestError.ts', readFileSync(
    join(root, 'src/errors/RequestError.ts'), 'utf8'
  ), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(statement =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === 'RequestErrorCode')
  assert.ok(declaration && ts.isUnionTypeNode(declaration.type), 'RequestErrorCode union is missing')
  const codes = declaration.type.types.map(type => {
    assert.ok(ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal),
      'RequestErrorCode must contain string literals')
    return type.literal.text
  }).sort()
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  const api = readFileSync(join(root, 'docs/api.md'), 'utf8')
  const list = readme.match(/Stable request error codes:\s*\n((?:- `[A-Z_]+`\s*\n)+)/)?.[1]
  const block = api.match(/Error codes:\s*```ts\n([\s\S]*?)```/)?.[1]
  assert.ok(list, 'README error code list is missing')
  assert.ok(block, 'API error code block is missing')
  for (const [name, actual] of [
    ['README', [...list.matchAll(/`([A-Z_]+)`/g)].map(match => match[1])],
    ['API reference', block.trim().split(/\s+/)]
  ]) {
    assert.deepEqual(actual.sort(), codes, `${name} error codes differ from RequestErrorCode`)
  }
  return codes.length
}
