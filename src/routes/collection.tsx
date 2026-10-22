import { useEffect, useRef, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { RotateCw } from 'lucide-react'
import { ButtonLabel } from '../components/ButtonLabel'
import { CollectionView } from '../components/CollectionView'
import { ShareCollection } from '../components/ShareCollection'
import { sortItems, type ImportedItem } from '../lib/collection'
import { deleteAllCollections, loadCollection, saveCollection } from '../lib/collection-cache'
import { deleteSpotifyMatches } from '../lib/spotify'
import { fetchCollectionPage, getViewer, signOut, type ImportError } from '../server/functions'

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
  const [status, setStatus] = useState<ImportStatus>({ state: 'idle' })
  const [needsReauth, setNeedsReauth] = useState(false)
  const importRun = useRef(0)

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
  const firstImportFailed = items === null && status.state === 'failed'

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
              Updating from Discogs{status.pagesTotal ? ` · ${progressLabel(status)}` : ''}
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
          <ShareCollection username={viewer.username} items={items} />
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

        {firstImportFailed ? (
          !needsReauth && <FirstImportError status={status} onRetry={runImport} />
        ) : (
          <>
            {items && <UpdateNotice status={status} needsReauth={needsReauth} onRetry={runImport} />}
            <CollectionView
              items={items}
              emptyMessage="There’s no vinyl in your Discogs collection yet."
            />
          </>
        )}
      </main>

      <DisconnectSection onDisconnect={handleDisconnect} />
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

function FirstImportError({ status, onRetry }: { status: ImportStatus; onRetry: () => void }) {
  return (
    <div className="panel" role="alert">
      <p>{importErrorMessage(status)}</p>
      <button className="button" type="button" onClick={onRetry}>
        <ButtonLabel>Try again</ButtonLabel>
      </button>
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

function DisconnectSection({ onDisconnect }: { onDisconnect: () => Promise<void> }) {
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)

  async function disconnect() {
    setWorking(true)
    setFailed(false)
    try {
      await onDisconnect()
    } catch {
      setFailed(true)
      setWorking(false)
    }
  }

  return (
    <footer className="page-footer">
      {failed && <p className="notice notice-error">Couldn’t disconnect. Please try again.</p>}
      <button className="link-button" type="button" onClick={disconnect} disabled={working}>
        <ButtonLabel>{working ? 'Disconnecting…' : 'Disconnect and delete data'}</ButtonLabel>
      </button>
    </footer>
  )
}
