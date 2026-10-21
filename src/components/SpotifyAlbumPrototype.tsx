import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useServerFn } from '@tanstack/react-start'
import type { CollectionItem } from '../lib/collection'
import { loadSpotifyMatch, saveSpotifyMatch, spotifyAlbumId, type AlbumCandidate } from '../lib/spotify'
import { matchSpotifyAlbum } from '../server/functions'
import { ButtonLabel } from './ButtonLabel'

// Proof of concept: can a Discogs sleeve resolve to a useful Spotify listening experience?
export function SpotifyAlbumPrototype({ item, active = true }: { item: CollectionItem; active?: boolean }) {
  const search = useServerFn(matchSpotifyAlbum)
  const [albumId, setAlbumId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<AlbumCandidate[]>([])
  const [choosing, setChoosing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState('')
  const [storageFailed, setStorageFailed] = useState(false)
  const run = useRef(0)
  const inputId = useId()

  function select(id: string) {
    run.current++
    setAlbumId(id)
    setChoosing(false)
    setLoading(false)
    setInputError('')
    setStorageFailed(!saveSpotifyMatch(item.releaseId, id))
  }

  async function findMatches(autoSelect: boolean) {
    const request = ++run.current
    setLoading(true)
    setMessage('')
    setCandidates([])
    try {
      const result = await search({ data: { artist: item.artist, artistAlt: item.artistAlt, title: item.title, year: item.year } })
      if (request !== run.current) return
      if (!result.ok) {
        setMessage(result.error === 'not_configured'
          ? 'Automatic matching isn’t available. Paste a Spotify album link below.'
          : result.error === 'rate_limited'
            ? 'Spotify is limiting searches. Try again later or paste an album link.'
            : 'Couldn’t search Spotify. Try again or paste an album link.')
      } else {
        setCandidates(result.candidates)
        if (autoSelect && result.suggestedId) select(result.suggestedId)
        else setMessage(result.candidates.length ? 'Choose the Spotify edition you want to hear.' : 'No albums found. Paste a Spotify album link below.')
      }
    } catch {
      if (request === run.current) setMessage('Couldn’t search Spotify. Try again or paste an album link.')
    } finally {
      if (request === run.current) setLoading(false)
    }
  }

  useEffect(() => {
    const saved = loadSpotifyMatch(item.releaseId)
    if (saved) { setAlbumId(saved); setLoading(false) }
    else void findMatches(true)
    return () => { run.current++ }
  }, [item.releaseId])

  function submit(event: FormEvent) {
    event.preventDefault()
    const id = spotifyAlbumId(input)
    if (!id) { setInputError('Paste a Spotify album link, such as https://open.spotify.com/album/…'); return }
    select(id)
  }

  return (
    <section className="spotify-album" aria-label="Listen on Spotify">
      <div className="spotify-heading">
        <span>Listen on Spotify</span>
        {albumId && (
          <button className="button" type="button" onClick={() => {
            setChoosing((value) => !value)
            if (!choosing) void findMatches(false)
          }}>
            <ButtonLabel>{choosing ? 'Done' : 'Change album'}</ButtonLabel>
          </button>
        )}
      </div>
      {albumId && <SpotifyEmbedPrototype key={albumId} albumId={albumId} active={active} />}
      {storageFailed && <p className="muted" role="status">This choice couldn’t be saved in this browser.</p>}
      {(!albumId || choosing) && (
        <div className="spotify-choices">
          <p className="muted" role="status">{loading ? 'Finding this album on Spotify…' : message}</p>
          {candidates.length > 0 && (
            <ul className="spotify-candidates">
              {candidates.map((album) => (
                <li key={album.id}>
                  <button className="spotify-candidate" type="button" onClick={() => select(album.id)}>
                    {album.imageUrl && <img src={album.imageUrl} alt="" loading="lazy" />}
                    <span><strong>{album.name}</strong><span className="muted">{album.artists.join(', ')}{album.year ? ` · ${album.year}` : ''}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && <button className="button spotify-retry" type="button" onClick={() => void findMatches(false)}><ButtonLabel>Search again</ButtonLabel></button>}
          <form className="spotify-link-form" onSubmit={submit}>
            <label htmlFor={inputId}>Spotify album link</label>
            <div>
              <input id={inputId} type="text" inputMode="url" placeholder="https://open.spotify.com/album/…" value={input}
                onChange={(event) => { setInput(event.target.value); setInputError('') }}
                aria-invalid={Boolean(inputError)} aria-describedby={inputError ? `${inputId}-error` : undefined} />
              <button className="button" type="submit"><ButtonLabel>Use album</ButtonLabel></button>
            </div>
            {inputError && <p id={`${inputId}-error`} className="spotify-error" role="alert">{inputError}</p>}
          </form>
        </div>
      )}
    </section>
  )
}

type EmbedController = {
  play(): void
  pause(): void
  destroy(): void
  addListener(event: 'ready', callback: () => void): void
}
type EmbedApi = {
  createController(element: HTMLElement, options: { uri: string; width: string; height: number }, callback: (controller: EmbedController) => void): void
}
type SpotifyWindow = Window & {
  onSpotifyIframeApiReady?: (api: EmbedApi) => void
  vinylSpotifyEmbedApi?: EmbedApi
}
let embedApi: Promise<EmbedApi> | null = null

function loadEmbedApi(): Promise<EmbedApi> {
  const spotifyWindow = window as SpotifyWindow
  // Keep the loaded API through Vite hot updates, which can replace this module.
  if (spotifyWindow.vinylSpotifyEmbedApi) return Promise.resolve(spotifyWindow.vinylSpotifyEmbedApi)
  if (embedApi) return embedApi
  embedApi = new Promise<EmbedApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://open.spotify.com/embed/iframe-api/v1'
    script.async = true
    const timer = window.setTimeout(() => { script.remove(); reject(new Error('Spotify timed out')) }, 15_000)
    spotifyWindow.onSpotifyIframeApiReady = (api) => {
      clearTimeout(timer)
      spotifyWindow.vinylSpotifyEmbedApi = api
      resolve(api)
    }
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Spotify could not load')) }
    document.body.append(script)
  }).catch((error) => { embedApi = null; throw error })
  return embedApi
}

function SpotifyEmbedPrototype({ albumId, active }: { albumId: string; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<EmbedController | null>(null)
  const isActive = useRef(active)
  isActive.current = active
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timedOut = false
    setFailed(false)
    setReady(false)
    const container = host.current!
    const target = document.createElement('div')
    container.append(target)
    function fallback() {
      if (cancelled) return
      timedOut = true
      controller.current?.destroy()
      controller.current = null
      container.replaceChildren()
      setFailed(true)
    }
    const readyTimeout = window.setTimeout(fallback, 10_000)
    loadEmbedApi().then((api) => {
      if (cancelled || timedOut) return
      api.createController(target, { uri: `spotify:album:${albumId}`, width: '100%', height: 152 }, (instance) => {
        if (cancelled || timedOut) { instance.destroy(); return }
        controller.current = instance
        instance.addListener('ready', () => {
          if (cancelled || timedOut) return
          clearTimeout(readyTimeout)
          setFailed(false)
          setReady(true)
          if (isActive.current) instance.play()
        })
      })
      // The album view animates in from opacity: 0. Don't let Spotify's lazy
      // iframe wait for another interaction before loading a saved match.
      const iframe = container.querySelector('iframe')
      if (iframe) { iframe.loading = 'eager'; iframe.title = 'Spotify album player' }
    }).catch(fallback)
    return () => {
      cancelled = true
      clearTimeout(readyTimeout)
      controller.current?.destroy()
      controller.current = null
      container.replaceChildren()
    }
  }, [albumId, attempt])

  useEffect(() => { if (!active) controller.current?.pause() }, [active])

  return (
    <div className="spotify-player">
      <div ref={host} hidden={failed} />
      {failed && <iframe src={`https://open.spotify.com/embed/album/${albumId}`} title="Spotify album player" height={152}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />}
      <p className="muted" role="status">{failed ? 'Automatic playback didn’t connect. Press play in the player above.' : ready ? 'If playback doesn’t start, press play in Spotify’s player.' : 'Loading Spotify’s player…'}</p>
      {failed && <button className="button spotify-retry" type="button" onClick={() => setAttempt((value) => value + 1)}><ButtonLabel>Reload player</ButtonLabel></button>}
      <a href={`https://open.spotify.com/album/${albumId}`} target="_blank" rel="noreferrer">Open in Spotify</a>
    </div>
  )
}
