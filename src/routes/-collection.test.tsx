import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollectionItem } from '../lib/collection'

const fixture = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
}))

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [fixture.states[fixture.cursor++] ?? initial, vi.fn()],
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-router')>(),
  createFileRoute: () => (options: object) => ({
    ...options,
    useLoaderData: () => ({ id: 1, username: 'collector' }),
  }),
  useNavigate: () => vi.fn(),
  redirect: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({ useServerFn: () => vi.fn() }))
vi.mock('../server/functions', () => ({
  fetchCollectionPage: vi.fn(), getViewer: vi.fn(), signOut: vi.fn(),
}))

// Exercise the route component from TanStack's production code-splitting seam.
// @ts-expect-error TanStack creates this module during the Vite transform.
import { component as Component } from './collection?tsr-split=component'

function render(states: unknown[]) {
  fixture.states = states
  fixture.cursor = 0
  return renderToStaticMarkup(<Component />)
}

function expectSpinnerOnly(html: string) {
  expect(html).toContain('role="status"')
  expect(html).toContain('shelf-spinner')
  expect(html).not.toContain('class="panel"')
  expect(html).not.toContain('class="progress"')
  expect(html).not.toContain('Importing your collection from Discogs')
}

beforeEach(() => { fixture.cursor = 0 })

describe('first collection loading', () => {
  it('shows the spinner before browser storage has been checked', () => {
    expectSpinnerOnly(render([]))
  })

  it('keeps the spinner while Discogs pages are importing', () => {
    expectSpinnerOnly(render([null, { state: 'importing', pagesDone: 1, pagesTotal: 3 }]))
  })

  it('shows only the update label while refreshing a saved collection', () => {
    const html = render([[], { state: 'importing' }])
    expect(html).toContain('Updating from Discogs</p>')
    expect(html).not.toContain('Read 1 of')
    expect(html).not.toContain('Failed to update from Discogs')
  })

  it('shows a fading header error instead of a saved-collection error notice', () => {
    const html = render([[], { state: 'failed', error: 'failed' }])
    expect(html).toContain('class="status-line status-line-error" role="alert"')
    expect(html).toContain('Failed to update from Discogs')
    expect(html).not.toContain('Showing your last saved collection.')
  })

  it('shows an actionable error if the first import fails', () => {
    const html = render([null, { state: 'failed', error: 'rate_limited' }])
    expect(html).toContain('Failed to import collection from Discogs, click')
    expect(html).toContain('<a class="inline-link" href="/collection">')
    expect(html).toContain('<span class="button-label">here')
    expect(html).toContain('</a> to try again.')
    expect(html).not.toContain('shelf-spinner')
    expect(html).not.toContain('class="panel"')
    expect(html).not.toContain('Failed to update from Discogs')
  })

  it('keeps reconnect available for expired access', () => {
    const html = render([null, { state: 'failed', error: 'reauth' }, true])
    expect(html).toContain('Reconnect')
    expect(html).not.toContain('shelf-spinner')
  })

  it('shows the spinner while the imported shelf initializes', () => {
    const item: CollectionItem = {
      instanceId: 1, releaseId: 1, artist: 'Artist', artistAlt: null, title: 'Album',
      year: 2020, genre: 'Jazz', coverUrl: null, thumbUrl: null,
    }
    expectSpinnerOnly(render([[item], { state: 'idle' }]))
  })
})
