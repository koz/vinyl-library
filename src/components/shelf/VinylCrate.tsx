import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { CollectionItem } from '../../lib/collection'
import { crateWindow } from './crate'
import type { ShelfScene } from './scene'

// One flip per wheel notch, and a steady pace through trackpad momentum or a held key, slow
// enough for the stack to close up behind each record before the next is picked up.
const WHEEL_STEP = 90
const FLIP_INTERVAL = 200
const SWIPE_STEP = 40
const MAX_QUEUED = 4

/**
 * The collection as records standing in a wooden crate. The wheel, arrow keys or a vertical swipe
 * flip through them; clicking a record (or Enter, for the front one) opens it.
 */
export function VinylCrate({
  items,
  scene,
  ready,
  stageOpen,
  onOpen,
}: {
  items: CollectionItem[]
  scene: ShelfScene | null
  ready: boolean
  stageOpen: boolean
  onOpen: (item: CollectionItem, returnFocus: HTMLElement) => void
}) {
  const crateRef = useRef<HTMLDivElement>(null)
  const sleeves = useRef(new Map<number, HTMLElement>())
  const [current, setCurrent] = useState(0)
  const [pointing, setPointing] = useState(false)
  const direction = useRef(0)
  const lastFlip = useRef(-Infinity)
  const count = items.length
  const front = count ? current % count : 0
  const frontItem = items[front]
  const visible = (count ? crateWindow(count, front) : []).flatMap(({ index, offset }) => {
    const item = items[index]
    return item ? [{ item, offset }] : []
  })

  function flip(step: number) {
    const now = performance.now()
    if (count < 2 || now - lastFlip.current < FLIP_INTERVAL) return
    lastFlip.current = now
    direction.current = step
    setCurrent((value) => ((value % count) + step + count) % count)
  }

  // Wheel notches that arrive faster than records can flip are played out in turn.
  const queued = useRef(0)
  const drainTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(drainTimer.current), [])

  function queueFlip(step: number) {
    if (Math.sign(queued.current) !== step) queued.current = 0
    queued.current = Math.max(-MAX_QUEUED, Math.min(MAX_QUEUED, queued.current + step))
    if (drainTimer.current === undefined) drain()
  }

  function drain() {
    drainTimer.current = undefined
    const step = Math.sign(queued.current)
    if (!step) return
    let wait = FLIP_INTERVAL - (performance.now() - lastFlip.current)
    if (wait <= 0) {
      queued.current -= step
      latest.current.flip(step)
      wait = FLIP_INTERVAL
    }
    if (queued.current) drainTimer.current = setTimeout(drain, wait)
  }

  function openAt(clientX: number, clientY: number) {
    const id = scene?.pickCrate(clientX, clientY)
    const item = id == null ? undefined : items.find((candidate) => candidate.instanceId === id)
    if (item && crateRef.current) onOpen(item, crateRef.current)
  }

  // Read by listeners that outlive a render.
  const latest = useRef({ flip, queueFlip, stageOpen })
  latest.current = { flip, queueFlip, stageOpen }

  useLayoutEffect(() => {
    if (!scene || !crateRef.current) return
    return scene.trackCrate(crateRef.current)
  }, [scene])

  useLayoutEffect(() => {
    if (!scene) return
    const offsets = new Map<HTMLElement, number>()
    for (const { item, offset } of visible) {
      const element = sleeves.current.get(item.instanceId)
      if (element) offsets.set(element, offset)
    }
    scene.arrangeCrate(count, offsets, direction.current)
    direction.current = 0
  }, [scene, items, front])

  useEffect(() => {
    const crate = crateRef.current
    if (!crate) return
    let total = 0
    const onWheel = (event: WheelEvent) => {
      // Leave pinch-zoom to the browser.
      if (event.ctrlKey) return
      event.preventDefault()
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 800 : 1
      const delta = event.deltaY * lines
      if (Math.sign(delta) !== Math.sign(total)) total = 0
      total += delta
      const steps = Math.trunc(total / WHEEL_STEP)
      for (let i = 0; i < Math.abs(steps); i++) latest.current.queueFlip(Math.sign(steps))
      total -= steps * WHEEL_STEP
    }
    crate.addEventListener('wheel', onWheel, { passive: false })
    return () => crate.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || latest.current.stageOpen) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Separate presses each count; a held key's repeats only keep the steady pace, so flipping
      // stops as soon as it is released.
      if (event.repeat) latest.current.flip(step)
      else latest.current.queueFlip(step)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const crate = crateRef.current
    if (!crate) return
    // Notices above the crate can move it without a scroll.
    const observer = new ResizeObserver(() => scene?.requestRender())
    observer.observe(crate)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [scene])

  const swipe = useRef<{ y: number; moved: boolean } | null>(null)
  const hoverFrame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(hoverFrame.current), [])

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') swipe.current = { y: event.clientY, moved: false }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') {
      const drag = swipe.current
      if (!drag) return
      const distance = drag.y - event.clientY
      if (Math.abs(distance) < SWIPE_STEP) return
      // Swiping up moves on through the crate, like scrolling down.
      flip(Math.sign(distance))
      drag.y = event.clientY
      drag.moved = true
      return
    }
    const { clientX, clientY } = event
    cancelAnimationFrame(hoverFrame.current)
    hoverFrame.current = requestAnimationFrame(() => {
      const id = scene?.pickCrate(clientX, clientY) ?? null
      scene?.hover(id)
      setPointing(id !== null)
    })
  }

  function handlePointerLeave() {
    cancelAnimationFrame(hoverFrame.current)
    scene?.hover(null)
    setPointing(false)
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const swiped = swipe.current?.moved
    swipe.current = null
    if (swiped) return
    openAt(event.clientX, event.clientY)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.key === 'Enter' || event.key === ' ') && frontItem && crateRef.current) {
      event.preventDefault()
      onOpen(frontItem, crateRef.current)
    }
  }

  return (
    <div className={`crate-view${ready ? ' crate-ready' : ''}`} aria-busy={!ready} inert={!ready}>
      <div
        ref={crateRef}
        className={`crate${pointing ? ' crate-pointing' : ''}`}
        role="group"
        aria-roledescription="record crate"
        aria-label={frontItem ? `${frontItem.title} by ${frontItem.artist} at the front. Use the arrow keys to flip, Enter to open.` : 'Record crate'}
        tabIndex={0}
        data-lenis-prevent
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={() => { swipe.current = null }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          if (frontItem && event.currentTarget.matches(':focus-visible')) scene?.hover(frontItem.instanceId)
        }}
        onBlur={() => scene?.hover(null)}
      >
        {visible.map(({ item }) => (
          <CrateSleeve key={item.instanceId} item={item} scene={scene} sleeves={sleeves.current} />
        ))}
      </div>
      {frontItem && (
        <div className="crate-caption">
          <button className="button button-icon" type="button" aria-label="Previous record" onClick={() => flip(-1)} disabled={count < 2}>
            <ChevronUp size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <p aria-live="polite">
            <span className="crate-caption-title">{frontItem.artist} — {frontItem.title}</span>
            <span className="muted">{front + 1} of {count}</span>
          </p>
          <button className="button button-icon" type="button" aria-label="Next record" onClick={() => flip(1)} disabled={count < 2}>
            <ChevronDown size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

/** An invisible stand-in that keeps a record's 3D sleeve loaded while it is in the crate. */
function CrateSleeve({
  item,
  scene,
  sleeves,
}: {
  item: CollectionItem
  scene: ShelfScene | null
  sleeves: Map<number, HTMLElement>
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const coverUrl = item.coverUrl ?? item.thumbUrl

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    sleeves.set(item.instanceId, element)
    return () => {
      if (sleeves.get(item.instanceId) === element) sleeves.delete(item.instanceId)
    }
  }, [item.instanceId])

  useEffect(() => {
    if (!scene || !ref.current) return
    return scene.trackSleeve(ref.current, {
      id: item.instanceId,
      artist: item.artist,
      title: item.title,
      coverUrl,
    })
  }, [scene, item.instanceId, item.artist, item.title, coverUrl])

  return <span ref={ref} className="crate-sleeve" aria-hidden="true" />
}
