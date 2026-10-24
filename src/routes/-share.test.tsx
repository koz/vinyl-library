import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollectionItem } from '../lib/collection'

const fixture = vi.hoisted(() => ({ cursor: 0 }))
const item: CollectionItem = {
  instanceId: 1, releaseId: 1, artist: 'Artist', artistAlt: null, title: 'Album',
  year: 2020, genre: 'Jazz', coverUrl: null, thumbUrl: null,
}

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    // The page's view, CollectionView's pagination/readiness, then VinylShelf's scene/readiness/columns/selection.
    const states = ['shelves', true, 50, true, true, null, true, 4, { item, closing: false }]
    return [states[fixture.cursor++] ?? initial, vi.fn()]
  },
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-router')>(),
  createFileRoute: () => (options: object) => ({
    ...options,
    useLoaderData: () => ({ username: 'collector', items: [item] }),
    useSearch: () => ({ data: 'snapshot' }),
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('../components/SpotifyAlbumPrototype', () => ({
  SpotifyAlbumPrototype: () => <section aria-label="Listen on Spotify" />,
}))

// Exercise the shared route through its real collection and selected-record views.
// @ts-expect-error TanStack creates this module during the Vite transform.
import { component as Component } from './share?tsr-split=component'

describe('shared collection playback', () => {
  it('renders the Spotify player for a selected record without signing in', () => {
    fixture.cursor = 0
    const html = renderToStaticMarkup(<Component />)
    expect(html).toContain('Shared collection')
    expect(html).toContain('aria-label="Flip through the crate"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Listen on Spotify"')
  })
})
