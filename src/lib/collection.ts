export type DiscogsCollectionRelease = {
  instance_id: number
  id: number
  basic_information: {
    title: string
    year: number
    thumb?: string
    cover_image?: string
    artists?: { name: string; anv?: string; join?: string }[]
    genres?: string[]
    formats?: { name: string }[]
  }
}

export type CollectionItem = {
  instanceId: number
  releaseId: number
  /** The artist as credited on this release. */
  artist: string
  /** Discogs' main artist name, shown when the credit is in a non-Latin script. */
  artistAlt: string | null
  title: string
  year: number | null
  genre: string
  thumbUrl: string | null
  coverUrl: string | null
}

export function isVinyl(release: DiscogsCollectionRelease): boolean {
  return (release.basic_information.formats ?? []).some((format) => format.name === 'Vinyl')
}

// Discogs disambiguates identically named artists with a numeric suffix, e.g. "Nirvana (2)".
function stripDisambiguation(name: string): string {
  return name.replace(/\s+\(\d+\)$/, '')
}

// `credited` uses the name variation printed on the release (anv); `main` uses the artist's Discogs name.
export function formatArtists(
  artists: DiscogsCollectionRelease['basic_information']['artists'],
  variant: 'credited' | 'main' = 'credited',
): string {
  if (!artists?.length) return 'Unknown artist'
  return artists
    .map((artist, index) => {
      const name = stripDisambiguation(
        variant === 'credited' ? artist.anv || artist.name : artist.name,
      )
      const join = artist.join?.trim()
      if (!join || index === artists.length - 1) return name
      return join === ',' ? `${name}, ` : `${name} ${join} `
    })
    .join('')
}

// Discogs serves a placeholder spacer image when a release has no artwork.
function imageUrl(url: string | undefined): string | null {
  if (!url || url.includes('spacer.gif')) return null
  return url
}

const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

function alternateName(credited: string, main: string): string | null {
  if (credited === main) return null
  return NON_LATIN.test(credited) && !NON_LATIN.test(main) ? main : null
}

export type ImportedItem = CollectionItem & { sortArtist: string }

export function normalizeRelease(release: DiscogsCollectionRelease): ImportedItem {
  const info = release.basic_information
  const artist = formatArtists(info.artists, 'credited')
  const mainArtist = formatArtists(info.artists, 'main')
  return {
    instanceId: release.instance_id,
    releaseId: release.id,
    artist,
    artistAlt: alternateName(artist, mainArtist),
    sortArtist: mainArtist,
    title: info.title,
    year: info.year > 0 ? info.year : null,
    genre: (info.genres ?? []).join(', '),
    thumbUrl: imageUrl(info.thumb),
    coverUrl: imageUrl(info.cover_image),
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

// Sorting by the main name keeps an artist's releases together however each one credits them.
export function compareItems(a: ImportedItem, b: ImportedItem): number {
  return (
    collator.compare(a.sortArtist, b.sortArtist) ||
    collator.compare(a.title, b.title) ||
    a.instanceId - b.instanceId
  )
}

export function toVinylItems(releases: DiscogsCollectionRelease[]): ImportedItem[] {
  return releases.filter(isVinyl).map(normalizeRelease)
}

export function sortItems(items: ImportedItem[]): ImportedItem[] {
  return [...items].sort(compareItems)
}
