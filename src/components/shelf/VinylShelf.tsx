import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
} from 'react'
import type { CollectionItem } from '../../lib/collection'
import { ButtonLabel } from '../ButtonLabel'
import { SpotifyAlbumPrototype } from '../SpotifyAlbumPrototype'
import { STAGE_ASPECT, columnsFor } from './layout'
import { VinylCrate } from './VinylCrate'
import type { ShelfScene } from './scene'

type Stage = { item: CollectionItem; closing: boolean }

export type ShelfLayout = 'shelves' | 'crate'

/**
 * The collection as records standing on wooden shelves or in a crate, drawn with WebGPU or WebGL.
 * Calls `onUnsupported` if neither backend is available, so the page can fall back to a plain list.
 */
export function VinylShelf({
  items,
  layout = 'shelves',
  onUnsupported,
  onReady,
}: {
  items: CollectionItem[]
  layout?: ShelfLayout
  onUnsupported: () => void
  onReady: () => void
}) {
  const shelfRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scene, setScene] = useState<ShelfScene | null>(null)
  const [ready, setReady] = useState(false)
  const [columns, setColumns] = useState(4)
  const [stage, setStage] = useState<Stage | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const callbacks = useRef({ onUnsupported, onReady })
  callbacks.current = { onUnsupported, onReady }
  // Read by the Escape listener and the close animation callback, which outlive a render.
  const latest = useRef({ stage, scene })
  latest.current = { stage, scene }

  // three.js is loaded only when the shelf is shown.
  useEffect(() => {
    let cancelled = false
    let instance: ShelfScene | null = null
    import('./scene').then(
      async ({ ShelfScene }) => {
        if (cancelled || !canvasRef.current) return
        try {
          instance = await ShelfScene.create(canvasRef.current, () => {
            if (!cancelled) {
              setReady(true)
              callbacks.current.onReady()
            }
          })
          if (cancelled) {
            instance.dispose()
            return
          }
        } catch (error) {
          if (!cancelled) {
            console.error('Could not start the 3D shelf', error)
            callbacks.current.onUnsupported()
          }
          return
        }
        setScene(instance)
      },
      () => {
        if (!cancelled) callbacks.current.onUnsupported()
      },
    )
    return () => {
      cancelled = true
      instance?.dispose()
    }
  }, [])

  useEffect(() => {
    const shelf = shelfRef.current
    if (!shelf) return
    const observer = new ResizeObserver(() => {
      setColumns(columnsFor(shelf.clientWidth))
      scene?.requestRender()
    })
    observer.observe(shelf)
    // Content above the shelf (notices, progress) can move it without a scroll.
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [scene, layout])

  useEffect(() => {
    if (!stage) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeStage()
    }
    document.addEventListener('keydown', onKeyDown)
    document.documentElement.classList.add('stage-open')
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.documentElement.classList.remove('stage-open')
    }
  }, [stage !== null])

  function openStage(item: CollectionItem, returnTo: HTMLElement) {
    if (stage) return
    returnFocus.current = returnTo
    scene?.hover(null)
    setStage({ item, closing: false })
  }

  function closeStage() {
    const current = latest.current
    if (!current.stage || current.stage.closing) return
    current.stage = { ...current.stage, closing: true }
    setStage(current.stage)
    const finish = () => {
      setStage(null)
      returnFocus.current?.focus({ preventScroll: true })
    }
    if (current.scene) current.scene.close(finish)
    else finish()
  }

  const rows: CollectionItem[][] = []
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns))

  return (
    <>
      <canvas ref={canvasRef} className={`shelf-canvas${ready ? '' : ' shelf-canvas-loading'}`} aria-hidden="true" />
      {layout === 'crate' ? (
        <VinylCrate items={items} scene={scene} ready={ready} stageOpen={stage !== null} onOpen={openStage} />
      ) : (
        <div
          ref={shelfRef}
          className={`shelf${ready ? ' shelf-ready' : ''}`}
          aria-busy={!ready}
          inert={!ready}
          style={{ '--columns': columns } as CSSProperties}
        >
          {rows.map((row, index) => (
            <Fragment key={index}>
              {row.map((item) => (
                <Slot
                  key={item.instanceId}
                  item={item}
                  scene={scene}
                  onOpen={openStage}
                />
              ))}
              <Plank scene={scene} />
            </Fragment>
          ))}
        </div>
      )}
      {stage && (
        <StageView
          stage={stage}
          scene={scene}
          onClose={closeStage}
        />
      )}
    </>
  )
}

function Slot({
  item,
  scene,
  onOpen,
}: {
  item: CollectionItem
  scene: ShelfScene | null
  onOpen: (item: CollectionItem, slot: HTMLElement) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const coverUrl = item.coverUrl ?? item.thumbUrl

  useEffect(() => {
    if (!scene || !ref.current) return
    return scene.trackSleeve(ref.current, {
      id: item.instanceId,
      artist: item.artist,
      title: item.title,
      coverUrl,
    })
  }, [scene, item.instanceId, item.artist, item.title, coverUrl])

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'touch') return
    scene?.hover(item.instanceId)
  }

  function handleLeave() {
    scene?.hover(null)
  }

  function handleFocus(event: FocusEvent<HTMLButtonElement>) {
    if (!event.currentTarget.matches(':focus-visible')) return
    scene?.hover(item.instanceId)
  }

  return (
    <button
      ref={ref}
      className="shelf-slot"
      type="button"
      aria-label={`${item.title} by ${item.artist}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handleLeave}
      onFocus={handleFocus}
      onBlur={handleLeave}
      onClick={(event) => onOpen(item, event.currentTarget)}
    />
  )
}

function Plank({ scene }: { scene: ShelfScene | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scene || !ref.current) return
    return scene.trackPlank(ref.current)
  }, [scene])
  return <div ref={ref} className="shelf-plank" aria-hidden="true" />
}

function StageView({
  stage,
  scene,
  onClose,
}: {
  stage: Stage
  scene: ShelfScene | null
  onClose: () => void
}) {
  const artRef = useRef<HTMLButtonElement>(null)
  const { item } = stage

  useLayoutEffect(() => {
    if (!artRef.current) return
    scene?.open(item.instanceId, artRef.current)
    artRef.current.focus({ preventScroll: true })
  }, [])

  return (
    <div
      className={`stage${stage.closing ? ' stage-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-title"
      style={{ '--stage-aspect': STAGE_ASPECT } as CSSProperties}
    >
      <div className="stage-backdrop" onClick={onClose} />
      <button
        ref={artRef}
        className="stage-art"
        type="button"
        aria-label={`Put ${item.title} back`}
        onClick={onClose}
      />
      <section className="stage-details" data-lenis-prevent>
        <p className="stage-artist">
          {item.artist}
          {item.artistAlt && <span className="muted"> · {item.artistAlt}</span>}
        </p>
        <h2 id="stage-title">{item.title}</h2>
        <dl className="stage-facts">
          <div>
            <dt>Year</dt>
            <dd>{item.year ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Genre</dt>
            <dd>{item.genre || 'No genre'}</dd>
          </div>
        </dl>
        <div className="actions">
          <a
            className="button"
            href={`https://www.discogs.com/release/${item.releaseId}`}
            target="_blank"
            rel="noreferrer"
          >
            <ButtonLabel>View on Discogs</ButtonLabel>
          </a>
        </div>
        <SpotifyAlbumPrototype key={item.releaseId} item={item} active={!stage.closing} />
      </section>
    </div>
  )
}
