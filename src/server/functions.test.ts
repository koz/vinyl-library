import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(() => null),
  searchSpotifyAlbums: vi.fn(async () => ({ ok: true, candidates: [], suggestedId: null })),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      handler: (_rpc: unknown, handler: unknown) => ({ __executeServer: handler }),
    }
    return builder
  },
}))
vi.mock('./session.server', () => ({ getSession: mocks.getSession, destroySession: vi.fn() }))
vi.mock('./spotify.server', () => ({ searchSpotifyAlbums: mocks.searchSpotifyAlbums }))

// @ts-expect-error TanStack extracts the handler into this server-only module.
import { matchSpotifyAlbum_createServerFn_handler as matchSpotifyAlbum } from './functions?tss-serverfn-split'

it('matches Spotify albums for visitors without a Discogs session', async () => {
  const data = { artist: 'Artist', artistAlt: null, title: 'Album', year: 2020 }
  await expect(matchSpotifyAlbum({ data })).resolves.toEqual({ ok: true, candidates: [], suggestedId: null })
  expect(mocks.searchSpotifyAlbums).toHaveBeenCalledWith(data)
  expect(mocks.getSession).not.toHaveBeenCalled()
})
