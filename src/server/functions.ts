import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { toVinylItems, type ImportedItem } from '../lib/collection'
import { DiscogsAuthError, DiscogsError, getCollectionPage } from './discogs.server'
import { destroySession, getSession } from './session.server'

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
