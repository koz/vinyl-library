import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  spotifyClientId: 'test-client', spotifyClientSecret: 'test-secret', spotifyMarket: 'NL',
}))
vi.mock('./env.server', () => ({ getEnv: () => env }))

const query = { artist: 'Artist', artistAlt: null, title: 'Album', year: 2020 }
const album = { id: '097eYvf9NKjFnv4xA9s2oV', name: 'Album', artists: [{ name: 'Artist' }], release_date: '2020', images: [] }
let searchSpotifyAlbums: typeof import('./spotify.server').searchSpotifyAlbums
let requests: ReturnType<typeof vi.fn>
let searchResponse: () => Response

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T10:00:00Z'))
  searchResponse = () => Response.json({ albums: { items: [album] } })
  requests = vi.fn(async (url: string) => url.includes('/api/token')
    ? Response.json({ access_token: 'test-token', expires_in: 3600 }) : searchResponse())
  vi.stubGlobal('fetch', requests)
  ;({ searchSpotifyAlbums } = await import('./spotify.server'))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const searchCalls = () => requests.mock.calls.filter(([url]) => url.includes('/v1/search'))

describe('public Spotify matching', () => {
  it('reuses cached matches and combines simultaneous requests', async () => {
    const [first, second] = await Promise.all([searchSpotifyAlbums(query), searchSpotifyAlbums(query)])
    expect(first).toMatchObject({ ok: true, suggestedId: album.id })
    expect(second).toEqual(first)
    expect(await searchSpotifyAlbums({ ...query, artist: ' artist ', title: 'ALBUM' })).toEqual(first)
    expect(searchCalls()).toHaveLength(1)
    expect(requests.mock.calls.filter(([url]) => url.includes('/api/token'))).toHaveLength(1)
  })

  it('refreshes cached matches after an hour', async () => {
    await searchSpotifyAlbums(query)
    vi.advanceTimersByTime(60 * 60 * 1000)
    await searchSpotifyAlbums(query)
    expect(searchCalls()).toHaveLength(2)
  })

  it('caches empty searches for five minutes, including the broader fallback', async () => {
    searchResponse = () => Response.json({ albums: { items: [] } })
    expect(await searchSpotifyAlbums(query)).toEqual({ ok: true, candidates: [], suggestedId: null })
    await searchSpotifyAlbums(query)
    expect(searchCalls()).toHaveLength(2)
    vi.advanceTimersByTime(5 * 60 * 1000)
    await searchSpotifyAlbums(query)
    expect(searchCalls()).toHaveLength(4)
  })

  it('does not cache temporary upstream failures', async () => {
    searchResponse = () => new Response(null, { status: 503 })
    expect(await searchSpotifyAlbums(query)).toEqual({ ok: false, error: 'unavailable' })
    searchResponse = () => Response.json({ albums: { items: [album] } })
    expect(await searchSpotifyAlbums(query)).toMatchObject({ ok: true, suggestedId: album.id })
    expect(searchCalls()).toHaveLength(2)
  })

  it('limits all visitors to 30 upstream searches per rolling minute while serving cached matches', async () => {
    await searchSpotifyAlbums(query)
    for (let i = 1; i < 30; i++) await searchSpotifyAlbums({ ...query, title: `Album ${i}` })
    expect(await searchSpotifyAlbums({ ...query, title: 'Over budget' })).toEqual({ ok: false, error: 'rate_limited' })
    expect(await searchSpotifyAlbums(query)).toMatchObject({ ok: true, suggestedId: album.id })
    expect(searchCalls()).toHaveLength(30)
    vi.advanceTimersByTime(60_000)
    expect(await searchSpotifyAlbums({ ...query, title: 'Over budget' })).toMatchObject({ ok: true })
    expect(searchCalls()).toHaveLength(31)
  })

  it('counts broader fallback searches against the same budget', async () => {
    for (let i = 0; i < 29; i++) await searchSpotifyAlbums({ ...query, title: `Album ${i}` })
    searchResponse = () => Response.json({ albums: { items: [] } })
    expect(await searchSpotifyAlbums(query)).toEqual({ ok: false, error: 'rate_limited' })
    expect(searchCalls()).toHaveLength(30)
  })

  it('retries an expired token and counts the retry against the search budget', async () => {
    let attempts = 0
    searchResponse = () => ++attempts === 1 ? new Response(null, { status: 401 })
      : Response.json({ albums: { items: [album] } })
    expect(await searchSpotifyAlbums(query)).toMatchObject({ ok: true, suggestedId: album.id })
    expect(searchCalls()).toHaveLength(2)
    expect(requests.mock.calls.filter(([url]) => url.includes('/api/token'))).toHaveLength(2)
  })

  it('backs off when the token endpoint is rate limited', async () => {
    requests.mockImplementationOnce(async () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }))
    expect(await searchSpotifyAlbums(query)).toEqual({ ok: false, error: 'rate_limited' })
    vi.advanceTimersByTime(60_000)
    expect(await searchSpotifyAlbums({ ...query, title: 'Other' })).toEqual({ ok: false, error: 'rate_limited' })
    expect(requests).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(await searchSpotifyAlbums(query)).toMatchObject({ ok: true, suggestedId: album.id })
  })

  it.each([null, 'invalid'])('uses a one-minute cooldown without a usable Retry-After (%s)', async (retryAfter) => {
    searchResponse = () => new Response(null, { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} })
    await searchSpotifyAlbums(query)
    vi.advanceTimersByTime(30_000)
    expect(await searchSpotifyAlbums(query)).toEqual({ ok: false, error: 'rate_limited' })
    expect(searchCalls()).toHaveLength(1)
    vi.advanceTimersByTime(30_000)
    searchResponse = () => Response.json({ albums: { items: [album] } })
    expect(await searchSpotifyAlbums(query)).toMatchObject({ ok: true })
  })

  it.each(['120', 'Fri, 23 Oct 2026 10:02:00 GMT'])('respects Spotify Retry-After: %s across different albums', async (retryAfter) => {
    searchResponse = () => new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } })
    expect(await searchSpotifyAlbums(query)).toEqual({ ok: false, error: 'rate_limited' })
    vi.advanceTimersByTime(60_000)
    expect(await searchSpotifyAlbums({ ...query, title: 'Other' })).toEqual({ ok: false, error: 'rate_limited' })
    expect(searchCalls()).toHaveLength(1)
    vi.advanceTimersByTime(60_000)
    searchResponse = () => Response.json({ albums: { items: [album] } })
    expect(await searchSpotifyAlbums(query)).toMatchObject({ ok: true })
    expect(searchCalls()).toHaveLength(2)
  })

  it('bounds the result cache by evicting older albums', async () => {
    await searchSpotifyAlbums(query)
    for (let i = 1; i <= 500; i++) {
      vi.advanceTimersByTime(2100)
      await searchSpotifyAlbums({ ...query, title: `Album ${i}` })
    }
    const before = searchCalls().length
    await searchSpotifyAlbums(query)
    expect(searchCalls()).toHaveLength(before + 1)
  })
})
