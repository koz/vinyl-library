import { useEffect, useRef, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import type { CollectionItem } from '../lib/collection'
import { loadSpotifyMatch, saveSpotifyMatch } from '../lib/spotify'
import { matchSpotifyAlbum } from '../server/functions'

// Proof of concept: can a Discogs sleeve resolve to a useful Spotify listening experience?
export function SpotifyAlbumPrototype({ item, active = true }: { item: CollectionItem; active?: boolean }) {
  const search = useServerFn(matchSpotifyAlbum)
  const [albumId, setAlbumId] = useState<string | null>(null)
  const [readyAlbumId, setReadyAlbumId] = useState<string | null>(null)
  const [storageFailed, setStorageFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const saved = loadSpotifyMatch(item.releaseId)
    if (saved) setAlbumId(saved)
    else {
      void search({ data: { artist: item.artist, artistAlt: item.artistAlt, title: item.title, year: item.year } })
        .then((result) => {
          if (cancelled || !result.ok || !result.suggestedId) return
          setAlbumId(result.suggestedId)
          setStorageFailed(!saveSpotifyMatch(item.releaseId, result.suggestedId))
        })
        .catch(() => {
          // Matching failures leave the Spotify section omitted.
        })
    }
    return () => { cancelled = true }
  }, [item.releaseId])

  if (!albumId) return null

  const visible = readyAlbumId === albumId

  return (
    <section
      className={`spotify-album${visible ? '' : ' spotify-album-pending'}`}
      aria-label="Listen on Spotify"
      aria-hidden={!visible}
      inert={!visible}
    >
      <SpotifyEmbedPrototype key={albumId} albumId={albumId} active={active} onReady={setReadyAlbumId} />
      {storageFailed && <p className="muted" role="status">This choice couldn’t be saved in this browser.</p>}
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

function SpotifyEmbedPrototype({ albumId, active, onReady }: {
  albumId: string
  active: boolean
  onReady: (albumId: string | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<EmbedController | null>(null)
  const isActive = useRef(active)
  isActive.current = active

  useEffect(() => {
    let cancelled = false
    let timedOut = false
    onReady(null)
    const container = host.current!
    const target = document.createElement('div')
    container.append(target)
    function fail() {
      if (cancelled) return
      timedOut = true
      controller.current?.destroy()
      controller.current = null
      container.replaceChildren()
      onReady(null)
    }
    const readyTimeout = window.setTimeout(fail, 10_000)
    loadEmbedApi().then((api) => {
      if (cancelled || timedOut) return
      api.createController(target, { uri: `spotify:album:${albumId}`, width: '100%', height: 152 }, (instance) => {
        if (cancelled || timedOut) { instance.destroy(); return }
        controller.current = instance
        instance.addListener('ready', () => {
          if (cancelled || timedOut) return
          clearTimeout(readyTimeout)
          onReady(albumId)
          if (isActive.current) instance.play()
        })
      })
      // The album view animates in from opacity: 0. Don't let Spotify's lazy
      // iframe wait for another interaction before loading a saved match.
      const iframe = container.querySelector('iframe')
      if (iframe) { iframe.loading = 'eager'; iframe.title = 'Spotify album player' }
    }).catch(fail)
    return () => {
      cancelled = true
      clearTimeout(readyTimeout)
      controller.current?.destroy()
      controller.current = null
      container.replaceChildren()
    }
  }, [albumId, onReady])

  useEffect(() => { if (!active) controller.current?.pause() }, [active])

  return (
    <div className="spotify-player">
      <div ref={host} />
    </div>
  )
}
