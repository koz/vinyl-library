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

  it('shows an actionable error if the first import fails', () => {
    const html = render([null, { state: 'failed', error: 'rate_limited' }])
    expect(html).toContain('Discogs is limiting requests')
    expect(html).toContain('Try again')
    expect(html).not.toContain('shelf-spinner')
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
