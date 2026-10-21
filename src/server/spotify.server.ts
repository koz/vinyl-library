import { getEnv } from './env.server'
import { rankSpotifyAlbums, suggestedSpotifyAlbum, type AlbumQuery, type SpotifyAlbum, type SpotifySearchResult } from '../lib/spotify'

let token: { value: string; expires: number } | null = null
let pendingToken: Promise<string> | null = null

class SpotifyError extends Error {
  constructor(readonly status: number) { super(`Spotify request failed (${status})`) }
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
    if (!response.ok) throw new SpotifyError(response.status)
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
  const clean = (text: string) => text.replace(/[":]/g, ' ').trim()
  const search = async (q: string): Promise<SpotifyAlbum[]> => {
    const params = new URLSearchParams({ q, type: 'album', market: env.spotifyMarket, limit: '10' })
    for (let attempt = 0; ; attempt++) {
      const bearer = await accessToken(env.spotifyClientId!, env.spotifyClientSecret!)
      const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 401 && attempt === 0) { token = null; continue }
      if (!response.ok) throw new SpotifyError(response.status)
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
