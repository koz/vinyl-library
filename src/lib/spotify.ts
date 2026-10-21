import type { CollectionItem } from './collection'

export type SpotifyAlbum = {
  id: string
  name: string
  artists: string[]
  year: number | null
  imageUrl: string | null
}

export type AlbumQuery = Pick<CollectionItem, 'artist' | 'artistAlt' | 'title' | 'year'>
export type AlbumCandidate = SpotifyAlbum & { score: number; exact: boolean }
export type SpotifySearchResult =
  | { ok: true; candidates: AlbumCandidate[]; suggestedId: string | null }
  | { ok: false; error: 'not_configured' | 'rate_limited' | 'unavailable' }

const ALBUM_ID = /^[A-Za-z0-9]{22}$/

export function spotifyAlbumId(input: string): string | null {
  const value = input.trim()
  if (value.startsWith('spotify:album:')) {
    const id = value.slice('spotify:album:'.length)
    return ALBUM_ID.test(id) ? id : null
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.username || url.password || url.port) return null
    const id = url.pathname.match(/^\/(?:intl-[a-z]+\/)?album\/([A-Za-z0-9]{22})\/?$/)?.[1]
    return id ?? null
  } catch {
    return null
  }
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const left = new Set(a.split(' '))
  const right = new Set(b.split(' '))
  const common = [...left].filter((word) => right.has(word)).length
  return common / new Set([...left, ...right]).size
}

// Conservative on purpose: a fuzzy title or a different edition needs a human choice.
export function rankSpotifyAlbums(query: AlbumQuery, albums: SpotifyAlbum[]): AlbumCandidate[] {
  const artists = [query.artist, query.artistAlt].filter((a): a is string => Boolean(a)).map(normalize)
  return [...new Map(albums.map((album) => [album.id, album])).values()].map((album) => {
    const artist = Math.max(0, ...album.artists.flatMap((a) => artists.map((b) => similarity(normalize(a), b))))
    const title = similarity(normalize(query.title), normalize(album.name))
    const year = query.year && album.year === query.year ? 0.03 : 0
    return { ...album, score: title * 0.65 + artist * 0.32 + year, exact: title === 1 && artist === 1 }
  }).sort((a, b) => b.score - a.score)
}

export function suggestedSpotifyAlbum(candidates: AlbumCandidate[]): string | null {
  const first = candidates[0]
  if (!first?.exact) return null
  const artists = first.artists.map(normalize).sort()
  // Separate Spotify IDs can describe the same album. Compare the first listing
  // with the next distinct album so duplicate entries don't create a false tie.
  const second = candidates.slice(1).find((candidate) => {
    const otherArtists = candidate.artists.map(normalize).sort()
    return normalize(candidate.name) !== normalize(first.name) ||
      candidate.year !== first.year ||
      otherArtists.length !== artists.length ||
      otherArtists.some((artist, index) => artist !== artists[index])
  })
  return !second || first.score - second.score >= 0.08 ? first.id : null
}

const MATCH_PREFIX = 'vinyl-library:spotify-poc:'

export function loadSpotifyMatch(releaseId: number): string | null {
  try {
    const id = localStorage.getItem(`${MATCH_PREFIX}${releaseId}`)
    return id && ALBUM_ID.test(id) ? id : null
  } catch {
    return null
  }
}

export function saveSpotifyMatch(releaseId: number, albumId: string): boolean {
  try {
    localStorage.setItem(`${MATCH_PREFIX}${releaseId}`, albumId)
    return true
  } catch {
    return false
  }
}

export function deleteSpotifyMatches(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(MATCH_PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    // Storage may be disabled; don't prevent signing out in that case.
  }
}
