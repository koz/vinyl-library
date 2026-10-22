import { getEnv } from './env.server'
import { rankSpotifyAlbums, suggestedSpotifyAlbum, type AlbumQuery, type SpotifyAlbum, type SpotifySearchResult } from '../lib/spotify'

let token: { value: string; expires: number } | null = null
let pendingToken: Promise<string> | null = null

// Shared by signed-in and public visitors within this server process. Cache hits
// and simultaneous lookups of the same record don't spend the upstream budget.
const CACHE_LIMIT = 500
const MATCH_TTL = 60 * 60 * 1000
const EMPTY_TTL = 5 * 60 * 1000
const SEARCH_WINDOW = 60_000
const SEARCH_LIMIT = 30
const results = new Map<string, { result: SpotifySearchResult; expires: number }>()
const pendingSearches = new Map<string, Promise<SpotifySearchResult>>()
const searchTimes: number[] = []
let retryAt = 0

class SpotifyError extends Error {
  constructor(readonly status: number, retryAfter?: string | null) {
    super(`Spotify request failed (${status})`)
    // Only upstream 429s extend the cooldown; locally rejected requests must
    // not keep moving it forward while visitors retry.
    if (status === 429 && retryAfter !== undefined) {
      const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN
      const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter ?? '')
      retryAt = Math.max(retryAt, Number.isFinite(until) ? until : Date.now() + SEARCH_WINDOW)
    }
  }
}

function reserveSearch(): void {
  const now = Date.now()
  while (searchTimes.length && searchTimes[0]! <= now - SEARCH_WINDOW) searchTimes.shift()
  if (now < retryAt || searchTimes.length >= SEARCH_LIMIT) throw new SpotifyError(429)
  searchTimes.push(now)
}

async function accessToken(clientId: string, clientSecret: string): Promise<string> {
  if (token && token.expires > Date.now()) return token.value
  if (pendingToken) return pendingToken
  pendingToken = (async () => {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new SpotifyError(response.status, response.headers.get('Retry-After'))
    const body = await response.json() as { access_token: string; expires_in: number }
    token = { value: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 }
    return token.value
  })()
  try { return await pendingToken } finally { pendingToken = null }
}

type SearchAlbum = {
  id: string
  name: string
  artists: { name: string }[]
  release_date: string
  images: { url: string }[]
}

export async function searchSpotifyAlbums(query: AlbumQuery): Promise<SpotifySearchResult> {
  const env = getEnv()
  if (!env.spotifyClientId || !env.spotifyClientSecret) return { ok: false, error: 'not_configured' }
  const key = JSON.stringify([
    env.spotifyMarket, query.artist.trim().toLowerCase(), query.artistAlt?.trim().toLowerCase() || null,
    query.title.trim().toLowerCase(), query.year,
  ])
  const cached = results.get(key)
  if (cached && cached.expires > Date.now()) return cached.result
  results.delete(key)
  const pending = pendingSearches.get(key)
  if (pending) return pending
  const request = searchUncached(query, env).then((result) => {
    if (result.ok) {
      if (results.size >= CACHE_LIMIT) results.delete(results.keys().next().value!)
      results.set(key, {
        result, expires: Date.now() + (result.candidates.length ? MATCH_TTL : EMPTY_TTL),
      })
    }
    return result
  }).finally(() => { pendingSearches.delete(key) })
  pendingSearches.set(key, request)
  return request
}

async function searchUncached(query: AlbumQuery, env: ReturnType<typeof getEnv>): Promise<SpotifySearchResult> {
  const clean = (text: string) => text.replace(/[":]/g, ' ').trim()
  const search = async (q: string): Promise<SpotifyAlbum[]> => {
    const params = new URLSearchParams({ q, type: 'album', market: env.spotifyMarket, limit: '10' })
    for (let attempt = 0; ; attempt++) {
      reserveSearch()
      const bearer = await accessToken(env.spotifyClientId!, env.spotifyClientSecret!)
      const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 401 && attempt === 0) { token = null; continue }
      if (!response.ok) throw new SpotifyError(response.status, response.headers.get('Retry-After'))
      const body = await response.json() as { albums: { items: SearchAlbum[] } }
      return body.albums.items.map((album) => ({
        id: album.id, name: album.name, artists: album.artists.map((a) => a.name),
        year: Number(album.release_date.slice(0, 4)) || null,
        imageUrl: album.images.at(-1)?.url ?? null,
      }))
    }
  }
  try {
    const artist = clean(query.artistAlt || query.artist)
    let albums = await search(`artist:"${artist}" album:"${clean(query.title)}"`)
    // A broader fallback helps with alternate credits and edition suffixes.
    if (!albums.length) albums = await search(`${artist} ${clean(query.title)}`)
    const candidates = rankSpotifyAlbums(query, albums)
    return { ok: true, candidates, suggestedId: suggestedSpotifyAlbum(candidates) }
  } catch (error) {
    return { ok: false, error: error instanceof SpotifyError && error.status === 429 ? 'rate_limited' : 'unavailable' }
  }
}
