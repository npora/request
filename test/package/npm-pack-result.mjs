export function getNpmPackManifest(output) {
  const parsed = JSON.parse(output)
  const candidate = Array.isArray(parsed)
    ? parsed[0]
    : parsed
  const manifest = Array.isArray(candidate?.files)
    ? candidate
    : Object.values(candidate ?? {})
      .find(value => Array.isArray(value?.files))

  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    !Array.isArray(manifest.files)
  ) {
    throw new TypeError(
      'npm pack --json returned an invalid manifest'
    )
  }

  return manifest
}
