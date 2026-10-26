import { describe, expect, it } from 'vitest'
import {
  findRecord,
  sortItems,
  toVinylItems,
  formatArtists,
  normalizeRelease,
  type DiscogsCollectionRelease,
} from './collection'

function release(
  instanceId: number,
  overrides: Partial<DiscogsCollectionRelease['basic_information']> = {},
): DiscogsCollectionRelease {
  return {
    instance_id: instanceId,
    id: instanceId * 10,
    basic_information: {
      title: 'Untitled',
      year: 1990,
      artists: [{ name: 'Artist' }],
      genres: ['Rock'],
      formats: [{ name: 'Vinyl' }],
      ...overrides,
    },
  }
}

describe('formatArtists', () => {
  it('uses name variations, joins and strips Discogs disambiguation', () => {
    expect(
      formatArtists([
        { name: 'Nirvana (2)', join: ',' },
        { name: 'Someone Else', anv: 'S. Else', join: 'Feat.' },
        { name: 'Guest' },
      ]),
    ).toBe('Nirvana, S. Else Feat. Guest')
  })

  it('handles missing artists', () => {
    expect(formatArtists([])).toBe('Unknown artist')
  })
})

describe('normalizeRelease', () => {
  it('maps unknown years, genres and placeholder artwork', () => {
    const item = normalizeRelease(
      release(1, {
        year: 0,
        genres: ['Jazz', 'Funk / Soul'],
        thumb: 'https://img.discogs.com/spacer.gif',
        cover_image: 'https://i.discogs.com/cover.jpg',
      }),
    )
    expect(item).toMatchObject({
      year: null,
      genre: 'Jazz, Funk / Soul',
      thumbUrl: null,
      coverUrl: 'https://i.discogs.com/cover.jpg',
    })
  })
})

describe('toVinylItems and sortItems', () => {
  it('keeps entries containing vinyl, including mixed-format sets', () => {
    const items = sortItems(toVinylItems([
      release(1, { formats: [{ name: 'CD' }] }),
      release(2, { formats: [{ name: 'CD' }, { name: 'Vinyl' }] }),
      release(3, { formats: [{ name: 'Vinyl' }] }),
    ]))
    expect(items.map((i) => i.instanceId)).toEqual([2, 3])
  })

  it('shows the main name only for non-Latin credits', () => {
    const [japanese, latinVariant, bothJapanese] = [
      release(1, { artists: [{ name: 'Joe Hisaishi', anv: '久石 譲' }] }),
      release(2, { artists: [{ name: 'Joe Hisaishi', anv: 'J. Hisaishi' }] }),
      release(3, { artists: [{ name: '久石譲', anv: '久石 譲' }] }),
    ].map(normalizeRelease)
    expect(japanese).toMatchObject({ artist: '久石 譲', artistAlt: 'Joe Hisaishi' })
    expect(latinVariant).toMatchObject({ artist: 'J. Hisaishi', artistAlt: null })
    expect(bothJapanese).toMatchObject({ artist: '久石 譲', artistAlt: null })
  })

  it('sorts by the main artist name, grouping differently credited releases', () => {
    const items = sortItems(toVinylItems([
      release(1, { artists: [{ name: 'Kraftwerk' }], title: 'Autobahn' }),
      release(2, { artists: [{ name: 'Joe Hisaishi', anv: '久石 譲' }], title: 'Kiki' }),
      release(3, { artists: [{ name: 'Air' }], title: 'Moon Safari' }),
      release(4, { artists: [{ name: 'Joe Hisaishi' }], title: 'Spirited Away' }),
    ]))
    expect(items.map((i) => i.instanceId)).toEqual([3, 2, 4, 1])
  })

  it('sorts by artist, then title, keeping separate copies', () => {
    const items = sortItems(toVinylItems([
      release(1, { artists: [{ name: 'beck' }], title: 'Sea Change' }),
      release(2, { artists: [{ name: 'Air' }], title: 'Talkie Walkie' }),
      release(3, { artists: [{ name: 'Beck' }], title: 'Odelay' }),
      release(4, { artists: [{ name: 'Air' }], title: 'Moon Safari' }),
      release(5, { artists: [{ name: 'Air' }], title: 'Moon Safari' }),
    ]))
    expect(items.map((i) => i.instanceId)).toEqual([4, 5, 2, 3, 1])
  })
})

describe('findRecord', () => {
  const items = sortItems(toVinylItems([
    release(1, { artists: [{ name: 'Sigur Rós' }], title: 'Ágætis byrjun' }),
    release(2, { artists: [{ name: 'Air' }], title: 'Moon Safari' }),
    release(3, { artists: [{ name: 'Joe Hisaishi', anv: '久石 譲' }], title: 'Kiki' }),
    release(4, { artists: [{ name: 'Beach House' }], title: 'Bloom' }),
  ]))

  it('finds the first match alphabetically, by artist or title', () => {
    // Air's Moon Safari comes before Beach House's Bloom.
    expect(items[findRecord(items, 'oo')]?.instanceId).toBe(2)
    expect(items[findRecord(items, 'bloom')]?.instanceId).toBe(4)
    expect(items[findRecord(items, 'beach')]?.instanceId).toBe(4)
  })

  it('ignores case, accents and surrounding space', () => {
    expect(items[findRecord(items, '  sigur ros ')]?.instanceId).toBe(1)
    expect(items[findRecord(items, 'AGÆTIS')]?.instanceId).toBe(1)
  })

  it('matches the main name shown under a non-Latin credit', () => {
    expect(items[findRecord(items, 'hisaishi')]?.instanceId).toBe(3)
    expect(items[findRecord(items, '久石')]?.instanceId).toBe(3)
  })

  it('finds nothing for a blank or unmatched query', () => {
    expect(findRecord(items, '   ')).toBe(-1)
    expect(findRecord(items, 'zappa')).toBe(-1)
  })
})
