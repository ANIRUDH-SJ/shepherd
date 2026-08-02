export const PREVIEW_PARTITION = 'shepherd-preview'
export const MAX_PREVIEW_URL_LENGTH = 2_048

export interface PreviewUrlResult {
  ok: boolean
  url: string | null
  error: string | null
}

function previewError(error: string): PreviewUrlResult {
  return { ok: false, url: null, error }
}

function loopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase()
  if (normalized === 'localhost' || normalized === '[::1]') return true
  if (!normalized.startsWith('127.')) return false
  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
  )
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function localNetworkUrl(url: URL, protocols: readonly string[]): boolean {
  return (
    protocols.includes(url.protocol) &&
    !url.username &&
    !url.password &&
    loopbackHostname(url.hostname)
  )
}

export function normalizePreviewUrl(value: unknown): PreviewUrlResult {
  if (typeof value !== 'string') return previewError('Enter a localhost URL')
  const input = value.trim()
  if (!input) return previewError('Enter a localhost URL')
  if (input.length > MAX_PREVIEW_URL_LENGTH) return previewError('Preview URL is too long')
  if (
    [...input].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    return previewError('Preview URL contains control characters')
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`
  const url = parseUrl(candidate)
  if (!url || !localNetworkUrl(url, ['http:', 'https:'])) {
    return previewError('Only HTTP(S) localhost URLs can be previewed')
  }
  if (url.href.length > MAX_PREVIEW_URL_LENGTH) return previewError('Preview URL is too long')
  return { ok: true, url: url.href, error: null }
}

export function previewRequestAllowed(rawUrl: string, resourceType: string): boolean {
  const topLevel = resourceType === 'mainFrame'
  if (!topLevel && (rawUrl === 'about:blank' || rawUrl.startsWith('data:'))) return true
  if (!topLevel && rawUrl.startsWith('blob:')) {
    const blobOrigin = parseUrl(rawUrl.slice('blob:'.length))
    return Boolean(blobOrigin && localNetworkUrl(blobOrigin, ['http:', 'https:']))
  }
  const url = parseUrl(rawUrl)
  return Boolean(
    url && localNetworkUrl(url, topLevel ? ['http:', 'https:'] : ['http:', 'https:', 'ws:', 'wss:'])
  )
}

export function previewUrlLabel(rawUrl: string): string {
  const normalized = normalizePreviewUrl(rawUrl)
  if (!normalized.ok || !normalized.url) return 'Preview'
  const url = new URL(normalized.url)
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`
}
