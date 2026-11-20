/** Fetch exposes decoded bytes; encoded Content-Length cannot bound that body. */
export function decodedContentLength(headers: Headers): number | undefined {
  const encoding = headers.get('content-encoding')?.trim().toLowerCase()
  if (encoding && encoding !== 'identity') return undefined
  const value = headers.get('content-length')
  if (!value) return undefined
  const length = Number(value)
  return Number.isFinite(length) && length >= 0 ? length : undefined
}
