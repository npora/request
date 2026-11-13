const URL_REFERENCE = /^([^?#]*)(?:\?([^#]*))?(#.*)?$/

export function joinURL(baseURL: string | undefined, url: string): string {
  if (!baseURL || isAbsoluteURL(url)) {
    return url
  }

  if (!url) {
    return baseURL
  }

  const baseHasSuffix = baseURL.includes('?') || baseURL.includes('#')
  const firstInputCharacter = url.charCodeAt(0)

  if (
    !baseHasSuffix &&
    firstInputCharacter !== 63 &&
    firstInputCharacter !== 35
  ) {
    return joinURLPath(baseURL, url)
  }

  const base = URL_REFERENCE.exec(baseURL)!
  const input = URL_REFERENCE.exec(url)!
  const path = joinURLPath(base[1]!, input[1]!)
  const baseQuery = base[2] ?? ''
  const inputQuery = input[2] ?? ''
  const query = baseQuery && inputQuery
    ? `${baseQuery}&${inputQuery}`
    : baseQuery || inputQuery
  const hash = input[3] || base[3] || ''

  return `${path}${query ? `?${query}` : ''}${hash}`
}

function joinURLPath(baseURL: string, url: string): string {
  if (!url) {
    return baseURL
  }

  let baseEnd = baseURL.length
  let urlStart = 0

  while (
    baseEnd > 0 &&
    baseURL.charCodeAt(baseEnd - 1) === 47
  ) {
    baseEnd -= 1
  }

  while (
    urlStart < url.length &&
    url.charCodeAt(urlStart) === 47
  ) {
    urlStart += 1
  }

  return `${baseURL.slice(0, baseEnd)}/${url.slice(urlStart)}`
}

export function isAbsoluteURL(url: string): boolean {
  if (url.startsWith('//')) {
    return true
  }

  const colon = url.indexOf(':')

  if (colon <= 0) {
    return false
  }

  return /^[a-z][a-z\d+\-.]*$/i.test(
    url.slice(0, colon)
  )
}

