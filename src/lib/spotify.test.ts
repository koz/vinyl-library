import { describe, expect, it } from 'vitest'
import { rankSpotifyAlbums, suggestedSpotifyAlbum, type SpotifyAlbum } from './spotify'

const query = { artist: 'Amy Winehouse', artistAlt: null, title: 'Back To Black', year: 2016 }
const album: SpotifyAlbum = {
  id: '097eYvf9NKjFnv4xA9s2oV',
  name: 'Back To Black',
  artists: ['Amy Winehouse'],
  year: 2006,
  imageUrl: null,
}
const duplicate: SpotifyAlbum = { ...album, id: '68wQRlCBGhBW3BNuXKr36W' }

function suggest(albums: SpotifyAlbum[]) {
  return suggestedSpotifyAlbum(rankSpotifyAlbums(query, albums))
}

describe('Spotify album suggestions', () => {
  it('selects the first exact match when duplicate listings have identical metadata', () => {
    expect(suggest([album, duplicate])).toBe(album.id)
    expect(suggest([duplicate, album])).toBe(duplicate.id)
  })

  it('compares the duplicate group with the next distinct candidate', () => {
    const otherYear = { ...album, id: 'other-year', year: 2007 }
    expect(suggest([album, duplicate, otherYear])).toBeNull()
  })

  it('keeps different release years and artist credits ambiguous', () => {
    expect(suggest([album, { ...duplicate, year: 2007 }])).toBeNull()
    expect(suggest([album, { ...duplicate, artists: ['Amy Winehouse', 'Guest'] }])).toBeNull()
  })

  it('does not automatically select a different edition or tribute artist', () => {
    expect(suggest([{ ...album, name: 'Back To Black (Deluxe Edition)' }])).toBeNull()
    expect(suggest([{ ...album, artists: ['Amy Winehouse Tribute Band'] }])).toBeNull()
  })

  it('still selects an exact match over a clearly different edition', () => {
    expect(suggest([album, duplicate, { ...album, id: 'deluxe', name: 'Back To Black (Deluxe Edition)' }])).toBe(album.id)
  })
})
