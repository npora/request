import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(
  new URL('../', import.meta.url)
)
const manifest = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8')
)
const changesetsConfig = JSON.parse(
  readFileSync(
    join(root, '.changeset/config.json'),
    'utf8'
  )
)
const workflow = readFileSync(
  join(root, '.github/workflows/release.yml'),
  'utf8'
)
const actionStart = workflow.indexOf(
  '      - name: Create release pull request or publish'
)
const actionEnd = workflow.indexOf(
  '\n      - name:',
  actionStart + 1
)
const actionStep = workflow.slice(
  actionStart,
  actionEnd === -1 ? undefined : actionEnd
)

assert.match(
  workflow,
  /workflow_run:\s+workflows:\s+- CI\s+types:\s+- completed/
)
assert.match(
  workflow,
  /github\.event\.workflow_run\.conclusion == 'success'/
)
assert.match(
  workflow,
  /github\.event\.workflow_run\.head_branch == 'main'/
)
assert.match(
  workflow,
  /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/
)
assert.match(workflow, /pnpm test:types/)
assert.match(workflow, /pnpm test:examples/)
assert.match(workflow, /pnpm benchmark:types/)

assert.match(
  manifest.devDependencies['@changesets/cli'],
  /^\^3\./,
  'The release workflow requires Changesets CLI v3.'
)
assert.equal(
  changesetsConfig.$schema,
  'https://unpkg.com/@changesets/config@4.0.0/schema.json'
)
assert.match(
  actionStep,
  /uses: changesets\/action@72b60a2c449090fd1871c5578768a32a76011a9d # v2\.1\.0/
)
assert.match(
  actionStep,
  /github-token: \$\{\{ secrets\.GITHUB_TOKEN \}\}/
)
assert.match(
  actionStep,
  /version-script: pnpm version-packages/
)
assert.match(
  actionStep,
  /publish-script: pnpm release/
)
assert.match(
  actionStep,
  /create-github-releases: true/
)
assert.doesNotMatch(actionStep, /^\s+version:/m)
assert.doesNotMatch(actionStep, /^\s+publish:/m)
assert.doesNotMatch(actionStep, /createGithubReleases:/)
assert.doesNotMatch(actionStep, /^\s+env:/m)
const verificationStart = workflow.indexOf('\n  verify-published:')
assert.ok(verificationStart > actionStart, 'Published verification must be a separate job')
const publishJob = workflow.slice(0, verificationStart)
const verificationJob = workflow.slice(verificationStart)
assert.match(publishJob, /published: \$\{\{ steps\.changesets\.outputs\.published \}\}/)
assert.ok(publishJob.includes("fromJSON(steps.changesets.outputs['published-packages'] || '[]')[0].version"))
assert.doesNotMatch(publishJob, /node test\/package\/registry-install\.mjs/)
assert.match(verificationJob, /needs: release/)
assert.match(verificationJob, /if: needs\.release\.outputs\.published == 'true'/)
assert.match(verificationJob, /timeout-minutes: 30/)
assert.match(verificationJob, /permissions:\s+contents: read/)
assert.match(verificationJob, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/)
assert.match(verificationJob, /EXPECTED_PACKAGE_VERSION: \$\{\{ needs\.release\.outputs\.version \}\}/)
assert.match(verificationJob, /test -n "\$EXPECTED_PACKAGE_VERSION"\s+node test\/package\/registry-install\.mjs/)
assert.doesNotMatch(verificationJob, /pnpm release|changesets\/action|id-token: write|contents: write/)

console.log(
  'Changesets v3 and Action v2 release workflow contract passed.'
)
