export function getNpmPackManifest(output) {
  const parsed = JSON.parse(output)
  const manifest = Array.isArray(parsed)
    ? parsed[0]
    : parsed

  if (
    manifest === null ||
    typeof manifest !== 'object'
  ) {
    throw new TypeError(
      'npm pack --json returned an invalid manifest'
    )
  }

  return manifest
}
