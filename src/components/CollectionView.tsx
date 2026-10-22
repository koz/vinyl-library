import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CollectionItem } from '../lib/collection'
import { VinylShelf } from './shelf/VinylShelf'
import { LoadingRecords } from './LoadingRecords'

const PAGE_SIZE = 50

export function CollectionView({ items, emptyMessage, footer }: {
  items: CollectionItem[] | null
  emptyMessage: string
  footer?: ReactNode
}) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [shelfSupported, setShelfSupported] = useState(true)
  const [shelfReady, setShelfReady] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = loadMoreRef.current
    if (!sentinel || !items || visible >= items.length) return

    let active = true
    const observer = new IntersectionObserver((entries) => {
      if (!active || !entries.some((entry) => entry.isIntersecting)) return
      active = false
      observer.disconnect()
      setVisible((count) => Math.min(count + PAGE_SIZE, items.length))
    }, { rootMargin: '0px 0px 600px 0px' })
    observer.observe(sentinel)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [visible, items?.length])

  const loading = items === null || (items.length > 0 && shelfSupported && !shelfReady)

  return (
    <>
      {loading && <LoadingRecords />}
      {items === null ? null : items.length === 0 ? (
        <p className="empty">{emptyMessage}</p>
      ) : shelfSupported ? (
        <VinylShelf
          items={items.slice(0, visible)}
          onUnsupported={() => setShelfSupported(false)}
          onReady={() => setShelfReady(true)}
        />
      ) : (
        <RecordList items={items.slice(0, visible)} />
      )}
      {items && visible < items.length && (
        <div ref={loadMoreRef} className="scroll-sentinel" aria-hidden="true" />
      )}
      {!loading && footer}
    </>
  )
}

function RecordList({ items }: { items: CollectionItem[] }) {
  return (
    <div className="records">
      <div className="records-head" aria-hidden="true">
        <span />
        <span>Artist</span>
        <span>Album</span>
        <span>Year</span>
        <span>Genre</span>
      </div>
      <ul className="record-list">
        {items.map((item) => (
          <li className="record" key={item.instanceId}>
            <Cover url={item.thumbUrl ?? item.coverUrl} />
            <span className="record-artist">
              <span className="record-artist-name">{item.artist}</span>
              {item.artistAlt && <span className="record-artist-alt">{item.artistAlt}</span>}
            </span>
            <span className="record-title">{item.title}</span>
            <span className="record-year">{item.year ?? 'Unknown'}</span>
            <span className="record-genre">{item.genre || 'No genre'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Cover({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLImageElement>(null)

  // An image can fail before React attaches onError.
  useEffect(() => {
    const img = ref.current
    if (img?.complete && img.naturalWidth === 0) setFailed(true)
  }, [])

  if (!url || failed) return <div className="cover cover-missing" aria-hidden="true" />
  return (
    <img
      ref={ref}
      className="cover"
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

