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
const actionStep = workflow.slice(
  workflow.indexOf(
    '      - name: Create release pull request or publish'
  )
)

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

console.log(
  'Changesets v3 and Action v2 release workflow contract passed.'
)
