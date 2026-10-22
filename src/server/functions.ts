import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { toVinylItems, type ImportedItem } from '../lib/collection'
import { DiscogsAuthError, DiscogsError, getCollectionPage } from './discogs.server'
import { destroySession, getSession } from './session.server'
import { searchSpotifyAlbums } from './spotify.server'

export type ImportError = 'reauth' | 'rate_limited' | 'failed'

export type CollectionPageResult =
  | { ok: true; pages: number; items: ImportedItem[] }
  | { ok: false; error: ImportError }

export const getViewer = createServerFn({ method: 'GET' }).handler(async () => {
  const session = getSession()
  return session ? { id: session.discogsId, username: session.username } : null
})

// Returns one page of the Discogs collection, already filtered to vinyl.
// The browser fetches every page, then sorts and saves the full list.
export const fetchCollectionPage = createServerFn({ method: 'GET' })
  .validator(z.object({ page: z.number().int().min(1) }))
  .handler(async ({ data }): Promise<CollectionPageResult> => {
    const session = getSession()
    if (!session) throw redirect({ to: '/' })

    try {
      const result = await getCollectionPage(session.credentials, session.username, data.page)
      return {
        ok: true,
        pages: Math.max(result.pagination.pages, 1),
        items: toVinylItems(result.releases),
      }
    } catch (error) {
      if (error instanceof DiscogsAuthError) return { ok: false, error: 'reauth' }
      if (error instanceof DiscogsError && error.status === 429) {
        return { ok: false, error: 'rate_limited' }
      }
      console.error('Could not fetch Discogs collection page', error)
      return { ok: false, error: 'failed' }
    }
  })

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  destroySession()
})

// Public so shared collections can resolve albums without a Discogs session.
// Search caching and the upstream rate budget live in spotify.server.
export const matchSpotifyAlbum = createServerFn({ method: 'GET' })
  .validator(z.object({
    artist: z.string().trim().min(1).max(500),
    artistAlt: z.string().trim().max(500).nullable(),
    title: z.string().trim().min(1).max(500),
    year: z.number().int().nullable(),
  }))
  .handler(async ({ data }) => {
    return searchSpotifyAlbums(data)
  })
