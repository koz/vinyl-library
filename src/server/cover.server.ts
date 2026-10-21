import { getEnv } from './env.server'

const COVER_HOST = 'i.discogs.com'
const MAX_BYTES = 5 * 1024 * 1024

// Only Discogs' image CDN may be fetched, so the proxy can't be used to reach other hosts.
export function coverSourceUrl(raw: string | null): URL | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== COVER_HOST) return null
  if (url.port || url.username || url.password) return null
  return url
}

export async function fetchCover(url: URL): Promise<Response> {
  const upstream = await fetch(url, {
    headers: { 'User-Agent': getEnv().discogsUserAgent },
    redirect: 'error',
  })
  const type = upstream.headers.get('Content-Type') ?? ''
  const length = Number(upstream.headers.get('Content-Length'))
  if (!upstream.ok || !type.startsWith('image/') || length > MAX_BYTES) {
    await upstream.body?.cancel()
    return new Response(null, { status: 502 })
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': type,
      // Discogs image URLs are content-addressed, so they never change.
      'Cache-Control': 'public, max-age=2592000, immutable',
    },
  })
}
