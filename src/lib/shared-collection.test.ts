import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { ImportedItem } from './collection'
import { createShareUrl, MAX_SHARE_URL_LENGTH, readSharedCollection, ShareTooLargeError } from './shared-collection'

const item: ImportedItem = {
  instanceId: 42,
  releaseId: 123,
  artist: '久石 譲',
  artistAlt: 'Joe Hisaishi',
  sortArtist: 'Joe Hisaishi',
  title: 'もののけ姫 · Soundtrack & more + / ?',
  year: 1997,
  genre: 'Stage & Screen',
  thumbUrl: 'https://i.discogs.com/abc/rs:fit/h:150/w:150/image.jpeg',
  coverUrl: 'https://i.discogs.com/xyz/rs:fit/h:600/w:600/image.jpeg',
}

function encodeRaw(value: unknown): string {
  return `1.${deflateSync(JSON.stringify(value)).toString('base64url')}`
}

describe('collection share links', () => {
  it('round-trips displayed metadata, Unicode, order, and separate copies of the same release', async () => {
    const collection = { username: 'collector', items: [item, { ...item, instanceId: 43, year: null }] }
    const url = new URL(await createShareUrl('https://vinyl.example/collection?other=1#old', collection))
    expect(url.origin + url.pathname).toBe('https://vinyl.example/share')
    expect([...url.searchParams.keys()]).toEqual(['data'])
    expect(url.hash).toBe('')
    expect(url.searchParams.get('data')).toMatch(/^1\.[A-Za-z0-9_-]+$/)
    const decoded = await readSharedCollection(url.searchParams.get('data'))
    const { sortArtist, ...metadata } = item
    const displayed = { ...metadata, thumbUrl: item.coverUrl }
    expect(decoded).toEqual({ username: 'collector', items: [displayed, { ...displayed, instanceId: 43, year: null }] })
    expect(decoded?.items[0]).not.toHaveProperty('sortArtist')
  })

  it('supports an empty collection and missing artwork', async () => {
    for (const items of [[], [{ ...item, coverUrl: null, thumbUrl: null, artistAlt: null }]]) {
      const url = await createShareUrl('https://vinyl.example', { username: 'collector', items })
      const decoded = await readSharedCollection(new URL(url).searchParams.get('data'))
      expect(decoded?.items).toHaveLength(items.length)
      if (items.length) expect(decoded?.items[0]).toMatchObject({ coverUrl: null, thumbUrl: null, artistAlt: null })
    }
  })

  it('uses thumbnail artwork when the full cover is missing', async () => {
    const url = await createShareUrl('https://vinyl.example', {
      username: 'collector', items: [{ ...item, coverUrl: null }],
    })
    const decoded = await readSharedCollection(new URL(url).searchParams.get('data'))
    expect(decoded?.items[0]).toMatchObject({ coverUrl: item.thumbUrl, thumbUrl: item.thumbUrl })
  })

  it('compresses the complete collection and excludes non-display data and credentials', async () => {
    const collection = {
      username: 'collector',
      credentials: { token: 'SECRET_TOKEN', secret: 'SECRET_VALUE' },
      items: Array.from({ length: 100 }, (_, index) => ({ ...item, instanceId: index + 1 })),
    }
    const url = await createShareUrl('https://vinyl.example', collection)
    expect(url.length).toBeLessThan(JSON.stringify(collection).length / 5)
    const decoded = await readSharedCollection(new URL(url).searchParams.get('data'))
    expect(decoded?.items).toHaveLength(100)
    expect(decoded).not.toHaveProperty('credentials')
  })

  it('rejects missing, malformed, truncated, and unsupported payloads without throwing', async () => {
    const url = new URL(await createShareUrl('https://vinyl.example', { username: 'collector', items: [item] }))
    const data = url.searchParams.get('data')!
    for (const value of [undefined, null, 123, '', '2.abc', '1.!', '1.abc', data.slice(0, -4),
      '1.' + 'a'.repeat(MAX_SHARE_URL_LENGTH), encodeRaw({ username: 'collector', items: [] }),
      encodeRaw(['collector', [[42, 123]]])]) {
      expect(await readSharedCollection(value)).toBeNull()
    }
  })

  it('rejects invalid record values, duplicate instance IDs, and unsafe cover URLs', async () => {
    const url = new URL(await createShareUrl('https://vinyl.example', { username: 'collector', items: [item] }))
    const rows: unknown[] = [42, 123, item.artist, item.artistAlt, item.title, item.year, item.genre, item.coverUrl]
    for (const [index, value] of [[0, -1], [1, '123'], [5, 1.5], [7, 'javascript:alert(1)'],
      [7, 'https://example.com/track'], [7, 'https://i.discogs.com.evil.test/image.jpg'],
      [7, 'https://user@i.discogs.com/image.jpg']] as const) {
      const invalid = [...rows]
      invalid[index] = value
      expect(await readSharedCollection(encodeRaw(['collector', [invalid]]))).toBeNull()
    }
    expect(await readSharedCollection(encodeRaw(['collector', [rows, rows]]))).toBeNull()
    expect(await readSharedCollection(url.searchParams.get('data'))).not.toBeNull()
  })

  it('bounds decompressed data even when a compressed payload fits in the query limit', async () => {
    const encoded = encodeRaw(['collector', 'a'.repeat(2 * 1024 * 1024 + 1)])
    expect(encoded.length).toBeLessThan(MAX_SHARE_URL_LENGTH)
    expect(await readSharedCollection(encoded)).toBeNull()
  })

  it('fails explicitly when the full snapshot cannot fit, without dropping records', async () => {
    let seed = 1
    const randomText = () => Array.from({ length: 500 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return String.fromCharCode(33 + seed % 90)
    }).join('')
    const items = Array.from({ length: 30 }, (_, index) => ({ ...item, instanceId: index + 1, title: randomText() }))
    await expect(createShareUrl('https://vinyl.example', { username: 'collector', items })).rejects.toBeInstanceOf(ShareTooLargeError)
  })
})
