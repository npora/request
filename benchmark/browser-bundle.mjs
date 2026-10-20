import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Count static initial dependencies separately from all emitted lazy chunks. */
export function summarizeBrowserBundle(bundle) {
  const outputs = bundle.metafile.outputs
  const files = new Map(bundle.outputFiles.map(file => [resolve(file.path), file.contents]))
  // esbuild marks dynamically imported source modules as entry points too.
  const dynamicTargets = new Set(Object.values(outputs).flatMap(output => output.imports
    .filter(dependency => dependency.kind === 'dynamic-import')
    .map(dependency => dependency.path)))
  const roots = Object.entries(outputs).filter(([path, metadata]) => metadata.entryPoint && !dynamicTargets.has(path))
  assert.equal(roots.length, 1, 'Expected one application entry')
  const initialPaths = new Set()
  const visit = path => {
    if (initialPaths.has(path)) return
    initialPaths.add(path)
    const metadata = outputs[path]
    assert.ok(metadata, `Missing output metadata: ${path}`)
    for (const dependency of metadata.imports) {
      if (!dependency.external && dependency.kind !== 'dynamic-import') visit(dependency.path)
    }
  }
  visit(roots[0][0])
  const summarize = paths => {
    const result = { bytes: 0, gzipBytes: 0, files: paths.length }
    for (const path of paths) {
      const contents = files.get(resolve(path))
      assert.ok(contents, `Missing output content: ${path}`)
      result.bytes += contents.byteLength
      result.gzipBytes += gzipSync(contents, { level: 9 }).byteLength
    }
    return result
  }
  const all = Object.keys(outputs)
  return {
    initial: summarize([...initialPaths]),
    lazy: summarize(all.filter(path => !initialPaths.has(path))),
    total: summarize(all)
  }
}
