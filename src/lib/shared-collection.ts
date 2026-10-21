import { z } from 'zod'
import type { CollectionItem } from './collection'

// Keep query URLs below common 8 KB request-line limits. No records are silently dropped.
export const MAX_SHARE_URL_LENGTH = 8_000
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
const VERSION = '1.'

const text = z.string().max(2_000)
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const image = z.string().max(2_000).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'i.discogs.com'
      && !url.port && !url.username && !url.password
  } catch {
    return false
  }
}).nullable()
const row = z.tuple([
  id, id, text, text.nullable(), text, z.number().int().min(1).max(9999).nullable(),
  text, image,
])
const snapshot = z.tuple([z.string().min(1).max(200), z.array(row).max(10_000)])

export type SharedCollection = { username: string; items: CollectionItem[] }

export class ShareTooLargeError extends Error {
  constructor() {
    super('This collection is too large to fit in a share link.')
  }
}

async function readBytes(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) {
        await reader.cancel()
        throw new ShareTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

// Tuples omit field names, sort-only metadata, and the redundant thumbnail URL. Deflate
// compresses repeated artist names and CDN paths; base64url avoids percent-encoding.
export async function createShareUrl(baseUrl: string, collection: SharedCollection): Promise<string> {
  const data = snapshot.parse([collection.username, collection.items.map((item) => [
    item.instanceId, item.releaseId, item.artist, item.artistAlt, item.title, item.year,
    item.genre, item.coverUrl ?? item.thumbUrl,
  ])])
  const raw = new TextEncoder().encode(JSON.stringify(data))
  if (raw.length > MAX_SNAPSHOT_BYTES) throw new ShareTooLargeError()
  const compressed = await readBytes(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate')),
    MAX_SHARE_URL_LENGTH,
  )
  const encoded = btoa(Array.from(compressed, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const url = new URL('/share', baseUrl)
  url.searchParams.set('data', VERSION + encoded)
  if (url.href.length > MAX_SHARE_URL_LENGTH) throw new ShareTooLargeError()
  return url.href
}

// Query parameters are untrusted. Invalid versions, damaged compression, excessive output,
// duplicate instance IDs, and malformed records all produce the same recoverable UI state.
export async function readSharedCollection(encoded: unknown): Promise<SharedCollection | null> {
  if (typeof encoded !== 'string' || encoded.length > MAX_SHARE_URL_LENGTH
    || !encoded.startsWith(VERSION)) return null
  const body = encoded.slice(VERSION.length)
  if (!/^[\w-]+$/.test(body)) return null
  try {
    const binary = atob(body.replace(/-/g, '+').replace(/_/g, '/'))
    const compressed = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const raw = await readBytes(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')),
      MAX_SNAPSHOT_BYTES,
    )
    const [username, rows] = snapshot.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
    if (new Set(rows.map(([instanceId]) => instanceId)).size !== rows.length) return null
    return {
      username,
      items: rows.map(([instanceId, releaseId, artist, artistAlt, title, year, genre, coverUrl]) => ({
        instanceId, releaseId, artist, artistAlt, title, year, genre, thumbUrl: coverUrl, coverUrl,
      })),
    }
  } catch {
    return null
  }
}
