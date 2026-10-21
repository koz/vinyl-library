import { useEffect, useRef, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { RotateCw } from 'lucide-react'
import { ButtonLabel } from '../components/ButtonLabel'
import { VinylShelf } from '../components/shelf/VinylShelf'
import { sortItems, type CollectionItem, type ImportedItem } from '../lib/collection'
import { deleteAllCollections, loadCollection, saveCollection } from '../lib/collection-cache'
import { deleteSpotifyMatches } from '../lib/spotify'
import { fetchCollectionPage, getViewer, signOut, type ImportError } from '../server/functions'

const PAGE_SIZE = 50

type ImportStatus =
  | { state: 'idle' }
  | { state: 'importing'; pagesDone: number; pagesTotal: number | null }
  | { state: 'failed'; error: ImportError }

export const Route = createFileRoute('/collection')({
  beforeLoad: async () => {
    const viewer = await getViewer()
    if (!viewer) throw redirect({ to: '/' })
    return { viewer }
  },
  loader: ({ context }) => context.viewer,
  component: CollectionPage,
})

function CollectionPage() {
  const viewer = Route.useLoaderData()
  const navigate = useNavigate()
  const fetchPage = useServerFn(fetchCollectionPage)
  const callSignOut = useServerFn(signOut)

  // null until the saved copy (if any) has been read from this browser.
  const [items, setItems] = useState<ImportedItem[] | null>(null)
  const [cacheChecked, setCacheChecked] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [status, setStatus] = useState<ImportStatus>({ state: 'idle' })
  const [needsReauth, setNeedsReauth] = useState(false)
  const [shelfSupported, setShelfSupported] = useState(true)
  const importRun = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const itemCount = items?.length ?? 0

  useEffect(() => {
    const sentinel = loadMoreRef.current
    if (!sentinel || visible >= itemCount) return

    let active = true
    const observer = new IntersectionObserver((entries) => {
      if (!active || !entries.some((entry) => entry.isIntersecting)) return
      active = false
      observer.disconnect()
      setVisible((count) => Math.min(count + PAGE_SIZE, itemCount))
    }, { rootMargin: '0px 0px 600px 0px' })
    observer.observe(sentinel)

    return () => {
      active = false
      observer.disconnect()
    }
  }, [visible, itemCount])

  // Discogs can't filter vinyl or sort by artist, so every page is read before the list is replaced.
  async function runImport() {
    const run = ++importRun.current
    const isCurrent = () => run === importRun.current
    setStatus({ state: 'importing', pagesDone: 0, pagesTotal: null })

    const collected: ImportedItem[] = []
    let page = 1
    let pages = 1
    try {
      do {
        const result = await fetchPage({ data: { page } })
        if (!isCurrent()) return
        if (!result.ok) {
          if (result.error === 'reauth') setNeedsReauth(true)
          setStatus({ state: 'failed', error: result.error })
          return
        }
        pages = result.pages
        collected.push(...result.items)
        setStatus({ state: 'importing', pagesDone: page, pagesTotal: pages })
        page++
      } while (page <= pages)
    } catch {
      if (isCurrent()) setStatus({ state: 'failed', error: 'failed' })
      return
    }

    const sorted = sortItems(collected)
    setItems(sorted)
    setStatus({ state: 'idle' })
    await saveCollection({ userId: viewer.id, items: sorted, savedAt: Date.now() })
  }

  // Show the saved copy immediately, and refresh from Discogs every time the screen opens.
  useEffect(() => {
    let active = true
    loadCollection(viewer.id).then((cached) => {
      if (!active) return
      if (cached) setItems((current) => current ?? cached.items)
      setCacheChecked(true)
    })
    void runImport()
    return () => {
      active = false
      importRun.current++
    }
  }, [viewer.id])

  async function handleSignOut() {
    importRun.current++
    await callSignOut()
    await navigate({ to: '/' })
  }

  async function handleDisconnect() {
    importRun.current++
    await callSignOut()
    await deleteAllCollections()
    deleteSpotifyMatches()
    await navigate({ to: '/' })
  }

  const importing = status.state === 'importing'

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Vinyl Library</h1>
          <p className="muted">
            {viewer.username}
            {items && ` · ${items.length} ${items.length === 1 ? 'record' : 'records'}`}
          </p>
        </div>
        <div className="actions">
          {items && importing && (
            <p className="status-line muted" role="status" aria-live="polite">
              Updating from Discogs · {progressLabel(status)}
            </p>
          )}
          <button
            className="button button-icon button-refresh"
            type="button"
            onClick={runImport}
            disabled={importing || needsReauth}
            aria-label={importing ? 'Updating collection' : 'Refresh collection'}
            aria-busy={importing}
            title={importing ? 'Updating…' : 'Refresh collection'}
          >
            <RotateCw size="0.875rem" strokeWidth={1} aria-hidden="true" />
          </button>
          <button className="button" type="button" onClick={handleSignOut}>
            <ButtonLabel>Logout</ButtonLabel>
          </button>
        </div>
      </header>

      <main>
        {needsReauth && (
          <div className="notice notice-error" role="alert">
            <span>Discogs access was revoked or has expired. Reconnect to update your collection.</span>
            <a className="button button-primary" href="/auth/discogs/start">
              <ButtonLabel>Reconnect</ButtonLabel>
            </a>
          </div>
        )}

        {items ? (
          <>
            <UpdateNotice status={status} needsReauth={needsReauth} onRetry={runImport} />
            {items.length === 0 ? (
              <p className="empty">There’s no vinyl in your Discogs collection yet.</p>
            ) : shelfSupported ? (
              <VinylShelf
                items={items.slice(0, visible)}
                onUnsupported={() => setShelfSupported(false)}
              />
            ) : (
              <RecordList items={items.slice(0, visible)} />
            )}
            {visible < items.length && (
              <div ref={loadMoreRef} className="scroll-sentinel" aria-hidden="true" />
            )}
          </>
        ) : (
          cacheChecked && !needsReauth && <FirstImport status={status} onRetry={runImport} />
        )}
      </main>

      <DisconnectSection onConfirm={handleDisconnect} />
    </div>
  )
}

function importErrorMessage(status: ImportStatus): string {
  if (status.state === 'failed' && status.error === 'rate_limited') {
    return 'Discogs is limiting requests right now. Try again in a minute.'
  }
  return 'Couldn’t update your collection from Discogs.'
}

function progressLabel(status: Extract<ImportStatus, { state: 'importing' }>): string {
  if (!status.pagesTotal) return 'Starting…'
  return `Read ${status.pagesDone} of ${status.pagesTotal} ${status.pagesTotal === 1 ? 'page' : 'pages'}`
}

function FirstImport({ status, onRetry }: { status: ImportStatus; onRetry: () => void }) {
  if (status.state === 'failed') {
    return (
      <div className="panel" role="alert">
        <p>{importErrorMessage(status)}</p>
        <button className="button" type="button" onClick={onRetry}>
          <ButtonLabel>Try again</ButtonLabel>
        </button>
      </div>
    )
  }

  const pagesDone = status.state === 'importing' ? status.pagesDone : 0
  const pagesTotal = status.state === 'importing' ? status.pagesTotal : null

  return (
    <div className="panel" role="status" aria-live="polite">
      <p>Importing your collection from Discogs</p>
      <p className="muted">
        {status.state === 'importing' ? progressLabel(status) : 'Starting…'}
      </p>
      <div className="progress">
        <div
          className="progress-bar"
          style={{ width: pagesTotal ? `${(pagesDone / pagesTotal) * 100}%` : '0%' }}
        />
      </div>
    </div>
  )
}

function UpdateNotice({
  status,
  needsReauth,
  onRetry,
}: {
  status: ImportStatus
  needsReauth: boolean
  onRetry: () => void
}) {
  if (status.state === 'failed' && !needsReauth) {
    return (
      <div className="notice" role="alert">
        <span>{importErrorMessage(status)} Showing your last saved collection.</span>
        <button className="button" type="button" onClick={onRetry}>
          <ButtonLabel>Retry</ButtonLabel>
        </button>
      </div>
    )
  }
  return null
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

function DisconnectSection({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)

  async function confirm() {
    setWorking(true)
    setFailed(false)
    try {
      await onConfirm()
    } catch {
      setFailed(true)
      setWorking(false)
    }
  }

  return (
    <footer className="page-footer">
      {confirming ? (
        <div className="panel">
          <p>Disconnect Discogs and delete the collection saved in this browser?</p>
          <p className="muted">
            Nothing is stored on our server, and your Discogs collection won’t change. To revoke
            this app’s access on every device, visit{' '}
            <a href="https://www.discogs.com/settings/applications" target="_blank" rel="noreferrer">
              Discogs application settings
            </a>
            .
          </p>
          {failed && <p className="notice notice-error">Couldn’t disconnect. Please try again.</p>}
          <div className="actions">
            <button className="button" type="button" onClick={() => setConfirming(false)} disabled={working}>
              <ButtonLabel>Cancel</ButtonLabel>
            </button>
            <button className="button button-danger" type="button" onClick={confirm} disabled={working}>
              <ButtonLabel>{working ? 'Disconnecting…' : 'Disconnect and delete data'}</ButtonLabel>
            </button>
          </div>
        </div>
      ) : (
        <button className="link-button" type="button" onClick={() => setConfirming(true)}>
          <ButtonLabel>Disconnect and delete app data</ButtonLabel>
        </button>
      )}
    </footer>
  )
}
