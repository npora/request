import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import ts from 'typescript-api'

const DEFAULT_MAX_LINES = 800
const MAX_FUNCTION_LINES = 260
const MAX_COMPLEXITY = 45
const MAX_NESTING = 8
const LEGACY_FILE_LIMITS = new Map([
  // Exact ratchets: these files may shrink, but cannot grow while being split.
  ['src/plugins/cachePlugin.ts', 2681],
  ['src/plugins/indexedDBCacheStore.ts', 1236]
])
const LEGACY_FUNCTION_LINES = new Map([
  ['src/plugins/cachePlugin.ts:cachePlugin', 1200],
  ['src/plugins/cachePlugin.ts:install', 850]
])
const files = process.argv.slice(2)

if (files.length === 0) {
  throw new Error('Pass production TypeScript files to check-complexity.mjs')
}

const failures = []

for (const file of files) {
  const text = await readFile(file, 'utf8')
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const path = relative(process.cwd(), file)
  const lines = source.getLineAndCharacterOfPosition(source.end).line + 1
  const maximumLines = LEGACY_FILE_LIMITS.get(path) ?? DEFAULT_MAX_LINES

  if (lines > maximumLines) {
    failures.push(`${path}: ${lines} file lines exceeds ${maximumLines}`)
  }

  visitFunctions(source, source, path)
}

if (failures.length > 0) {
  throw new Error(`Complexity budget failed:\n${failures.join('\n')}`)
}

process.stdout.write(
  `Complexity budgets passed for ${files.length} production files.\n`
)

function visitFunctions(node, source, path) {
  if (ts.isFunctionLike(node) && node.body) {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source))
      .line + 1
    const end = source.getLineAndCharacterOfPosition(node.end).line + 1
    const metrics = measureFunction(node.body)
    const name = functionName(node)

    const functionLines = end - start + 1
    const maximumFunctionLines = LEGACY_FUNCTION_LINES.get(
      `${path}:${name}`
    ) ?? MAX_FUNCTION_LINES

    if (functionLines > maximumFunctionLines) {
      failures.push(
        `${path}:${start} ${name} has ${functionLines} lines; max ${maximumFunctionLines}`
      )
    }
    if (metrics.complexity > MAX_COMPLEXITY) {
      failures.push(
        `${path}:${start} ${name} complexity ${metrics.complexity}; max ${MAX_COMPLEXITY}`
      )
    }
    if (metrics.nesting > MAX_NESTING) {
      failures.push(
        `${path}:${start} ${name} nesting ${metrics.nesting}; max ${MAX_NESTING}`
      )
    }
  }

  ts.forEachChild(node, child => visitFunctions(child, source, path))
}

function measureFunction(body) {
  let complexity = 1
  let nesting = 0

  walk(body, 0)
  return { complexity, nesting }

  function walk(node, depth) {
    if (node !== body && ts.isFunctionLike(node)) {
      return
    }

    const control = isControlNode(node)
    const nextDepth = control ? depth + 1 : depth

    if (control) {
      complexity += 1
      nesting = Math.max(nesting, nextDepth)
    } else if (
      ts.isBinaryExpression(node) &&
      (
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )
    ) {
      complexity += 1
    }

    ts.forEachChild(node, child => walk(child, nextDepth))
  }
}

function isControlNode(node) {
  return ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isCatchClause(node) ||
    ts.isCaseClause(node)
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) {
    return node.name.text
  }

  const parent = node.parent

  if (
    (ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent)) &&
    parent.name
  ) {
    return parent.name.getText()
  }

  return '<anonymous>'
}
