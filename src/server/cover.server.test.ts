import { describe, expect, it } from 'vitest'
import { coverSourceUrl } from './cover.server'

describe('coverSourceUrl', () => {
  it('accepts Discogs CDN images', () => {
    const url = 'https://i.discogs.com/abc/rs:fit/g:sm/q:90/h:600/w:600/image.jpeg'
    expect(coverSourceUrl(url)?.href).toBe(url)
  })

  it('rejects other hosts, protocols and malformed URLs', () => {
    expect(coverSourceUrl(null)).toBeNull()
    expect(coverSourceUrl('not a url')).toBeNull()
    expect(coverSourceUrl('http://i.discogs.com/a.jpeg')).toBeNull()
    expect(coverSourceUrl('https://example.com/a.jpeg')).toBeNull()
    expect(coverSourceUrl('https://i.discogs.com.example.com/a.jpeg')).toBeNull()
    expect(coverSourceUrl('https://user@i.discogs.com/a.jpeg')).toBeNull()
    expect(coverSourceUrl('https://i.discogs.com:8443/a.jpeg')).toBeNull()
  })
})
