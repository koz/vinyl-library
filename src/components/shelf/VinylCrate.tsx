import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { findRecord, type CollectionItem } from '../../lib/collection'
import { crateWindow } from './crate'
import type { ShelfScene } from './scene'

// One flip per wheel notch or swipe. Flips wait their turn, each starting once the record before
// it has landed and the stack is still, so every flip plays at the same pace.
const WHEEL_STEP = 90
const SWIPE_STEP = 40
const MAX_QUEUED = 4
// Waits for a pause in typing before searching.
const SEARCH_DELAY = 300

/**
 * The collection as records standing in a wooden crate. The wheel, arrow keys or a vertical swipe
 * flip through them; clicking a record (or Enter, for the front one) opens it. Typing in the search
 * field pulls the first record that matches out of the crate and brings it to the front.
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
  const [query, setQuery] = useState('')
  const [unmatched, setUnmatched] = useState(false)
  const [arranged, setArranged] = useState<{ items: CollectionItem[]; order: number[] } | null>(null)
  const direction = useRef(0)
  const carried = useRef<number | null>(null)
  const restacking = useRef(false)
  const count = items.length
  // The crate's order, as indexes into `items`: alphabetical, except while a record pulled out by
  // a search is on its way to the front.
  const pulling = arranged?.items === items
  const order = useMemo(
    () => arranged?.items === items ? arranged.order : items.map((_, index) => index),
    [arranged, items],
  )
  const front = count ? current % count : 0
  const frontIndex = order[front] ?? 0
  const frontItem = items[frontIndex]
  const visible = (count ? crateWindow(count, front) : []).flatMap(({ index, offset }) => {
    const at = order[index]
    const item = at === undefined ? undefined : items[at]
    return item ? [{ item, offset }] : []
  })
  // While a pulled record is on its way to the front, the records in the places they take once
  // they are back in alphabetical order behind it, so the scene can switch to them unseen.
  const restacked = pulling ? crateWindow(count, frontIndex).flatMap(({ index, offset }) => {
    const item = items[index]
    return item ? [{ item, offset }] : []
  }) : []
  const shown = new Set(visible.map(({ item }) => item))
  const kept = [...visible, ...restacked.filter(({ item }) => !shown.has(item))]

  function flip(step: number) {
    if (count < 2) return
    direction.current = step
    setCurrent((value) => ((value % count) + step + count) % count)
  }

  // Flips waiting their turn, counted in the direction they go, and whether the one waiting is only
  // there because a key is held down.
  const queued = useRef(0)
  const holding = useRef(false)
  const waiting = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => waiting.current?.(), [])

  /**
   * Flips a record once the crate is still. Presses and wheel notches add up, a few at most; a
   * `held` key keeps just one flip waiting, so flipping stops as soon as it is let go. Turning
   * the other way drops the flips still waiting.
   */
  function queueFlip(step: number, held = false) {
    if (count < 2) return
    if (Math.sign(queued.current) !== step) queued.current = 0
    if (held) {
      holding.current ||= !queued.current
      queued.current ||= step
    } else {
      holding.current = false
      queued.current = Math.max(-MAX_QUEUED, Math.min(MAX_QUEUED, queued.current + step))
    }
    drain()
  }

  /** Letting go of a held key drops the flip it left waiting. */
  function release() {
    if (!holding.current) return
    holding.current = false
    queued.current = 0
  }

  function drain() {
    if (!scene || waiting.current || !queued.current) return
    waiting.current = scene.whenCrateSettles(() => {
      waiting.current = undefined
      const step = Math.sign(queued.current)
      if (!step) return
      queued.current -= step
      holding.current = false
      latest.current.flip(step)
    })
  }

  /**
   * Lifts the record at `index` out of the crate and lowers it in at the front, in front of the
   * record there. The others keep their places until it hides them (see `restack`).
   */
  function pull(index: number) {
    waiting.current?.()
    waiting.current = undefined
    queued.current = 0
    const ahead = (order.indexOf(index) - front + count) % count
    const item = items[index]
    if (count < 2 || !ahead || !item) return
    const rest = [...order.slice(front), ...order.slice(0, front)]
    rest.splice(ahead, 1)
    // The records it passes over move back to make room, as when flipping back.
    direction.current = -1
    carried.current = item.instanceId
    setArranged({ items, order: [index, ...rest] })
    setCurrent(0)
  }

  /**
   * Puts the records behind the front one back in alphabetical order, so flipping carries on from
   * it. The scene has already switched them, while the record pulled out to the front hid them.
   */
  function restack() {
    if (!arranged) return
    restacking.current = true
    setArranged(null)
    setCurrent(frontIndex)
  }

  function search(text: string) {
    const index = findRecord(items, text)
    setUnmatched(index < 0 && text.trim() !== '')
    if (index >= 0) pull(index)
  }

  function openAt(clientX: number, clientY: number) {
    const id = scene?.pickCrate(clientX, clientY)
    const item = id == null ? undefined : items.find((candidate) => candidate.instanceId === id)
    if (item && crateRef.current) onOpen(item, crateRef.current)
  }

  // Read by listeners that outlive a render.
  const latest = useRef({ flip, queueFlip, release, search, restack, stageOpen })
  latest.current = { flip, queueFlip, release, search, restack, stageOpen }

  useEffect(() => {
    const timer = setTimeout(() => latest.current.search(query), SEARCH_DELAY)
    return () => clearTimeout(timer)
  }, [query])

  useLayoutEffect(() => {
    if (!scene || !crateRef.current) return
    return scene.trackCrate(crateRef.current)
  }, [scene])

  useLayoutEffect(() => {
    if (!scene) return
    const place = (records: typeof visible) => {
      const offsets = new Map<HTMLElement, number>()
      for (const { item, offset } of records) {
        const element = sleeves.current.get(item.instanceId)
        if (element) offsets.set(element, offset)
      }
      return offsets
    }
    const pulled = carried.current === null ? undefined : sleeves.current.get(carried.current)
    if (restacking.current) scene.restackCrate(count, place(visible))
    else scene.arrangeCrate(count, place(visible), direction.current, pulled, pulling ? place(restacked) : undefined)
    direction.current = 0
    carried.current = null
    restacking.current = false
    // The next flip waits for this one to land.
    drain()
  }, [scene, items, order, front])

  // Catches up once the scene has restacked the records behind the pulled one.
  useEffect(() => {
    if (!scene || !arranged) return
    return scene.onCrateRestack(() => latest.current.restack())
  }, [scene, arranged])

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
      // Separate presses each count; a held key's repeats only keep it flipping, one record at a
      // time, until it is let go.
      latest.current.queueFlip(step, event.repeat)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') latest.current.release()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
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
      queueFlip(Math.sign(distance))
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
        {kept.map(({ item }) => (
          <CrateSleeve key={item.instanceId} item={item} scene={scene} sleeves={sleeves.current} />
        ))}
      </div>
      {frontItem && (
        <div className="crate-caption">
          <button className="button button-icon" type="button" aria-label="Previous record" onClick={() => queueFlip(-1)} disabled={count < 2}>
            <ChevronUp size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <p aria-live="polite">
            <span className="crate-caption-title">{frontItem.artist} — {frontItem.title}</span>
            <span className="muted">{frontIndex + 1} of {count}</span>
          </p>
          <button className="button button-icon" type="button" aria-label="Next record" onClick={() => queueFlip(1)} disabled={count < 2}>
            <ChevronDown size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}
      {/* Below the crate, out of the way of records carried over it. */}
      <label className="crate-search">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an artist or album"
          aria-label="Find an artist or album"
          aria-invalid={unmatched}
          aria-describedby="crate-search-status"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        <span id="crate-search-status" className="muted" role="status">{unmatched ? 'No match' : ''}</span>
      </label>
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
