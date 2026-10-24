import { useEffect, useState } from 'react'
import type { CollectionItem } from '../lib/collection'
import { ButtonLabel } from './ButtonLabel'
import { ShareCollection } from './ShareCollection'
import { RefreshVinylIcon } from './RefreshVinylIcon'
import { LayoutToggle } from './LayoutToggle'
import type { ShelfLayout } from './shelf/VinylShelf'

export function CollectionHeader({
  username,
  items,
  importing,
  failed = false,
  needsReauth = false,
  layout,
  onToggleLayout,
  onRefresh,
  onSignOut,
}: {
  username: string
  items: CollectionItem[] | null
  importing: boolean
  failed?: boolean
  needsReauth?: boolean
  /** Shows the view switch when set. */
  layout?: ShelfLayout
  onToggleLayout?: () => void
  onRefresh: () => void
  onSignOut: () => void
}) {
  return (
    <header className="page-header">
      <div>
        <h1>Vinyl Library</h1>
        <p className="muted">
          {username}
          {items && ` · ${items.length} ${items.length === 1 ? 'record' : 'records'}`}
        </p>
      </div>
      <div className="actions">
        {failed && !importing && <UpdateFailure />}
        <button
          className="button button-icon button-refresh"
          type="button"
          onClick={onRefresh}
          disabled={importing || needsReauth}
          aria-label={importing ? 'Updating collection' : 'Refresh collection'}
          aria-busy={importing}
          title={importing ? 'Updating…' : 'Refresh collection'}
        >
          <RefreshVinylIcon />
        </button>
        {layout && onToggleLayout && <LayoutToggle layout={layout} onToggle={onToggleLayout} />}
        <ShareCollection username={username} items={items} />
        <button className="button" type="button" onClick={onSignOut}>
          <ButtonLabel>Logout</ButtonLabel>
        </button>
      </div>
    </header>
  )
}

function UpdateFailure() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 10_000)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null
  return (
    <p className="status-line status-line-error" role="alert">
      Failed to update from Discogs
    </p>
  )
}
