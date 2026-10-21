import { createFileRoute, Link } from '@tanstack/react-router'
import { ButtonLabel } from '../components/ButtonLabel'
import { CollectionView } from '../components/CollectionView'
import { readSharedCollection } from '../lib/shared-collection'

export const Route = createFileRoute('/share')({
  validateSearch: (search: Record<string, unknown>) => ({
    data: typeof search.data === 'string' ? search.data : '',
  }),
  loaderDeps: ({ search }) => ({ data: search.data }),
  loader: ({ deps }) => readSharedCollection(deps.data),
  head: () => ({ meta: [
    { title: 'Shared collection · Vinyl Library' },
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ] }),
  component: SharedCollectionPage,
})

function SharedCollectionPage() {
  const collection = Route.useLoaderData()
  const { data } = Route.useSearch()
  if (!collection) {
    return (
      <main className="sign-in">
        <div className="sign-in-panel">
          <h1>This share link isn’t valid</h1>
          <p className="muted">The link may be incomplete or damaged. Ask the owner for a new link.</p>
          <Link className="button" to="/"><ButtonLabel>Go to Vinyl Library</ButtonLabel></Link>
        </div>
      </main>
    )
  }
  const { username, items } = collection
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Vinyl Library</h1>
          <p className="muted">{username} · {items.length} {items.length === 1 ? 'record' : 'records'} · Shared collection</p>
        </div>
        <Link className="button" to="/"><ButtonLabel>Your collection</ButtonLabel></Link>
      </header>
      <main>
        <CollectionView key={data} items={items} shared emptyMessage="There’s no vinyl in this shared collection." />
      </main>
    </div>
  )
}
