import { createFileRoute, redirect } from '@tanstack/react-router'
import { getViewer } from '../server/functions'
import { ButtonLabel } from '../components/ButtonLabel'

const LOGIN_ERRORS = {
  denied: 'Discogs access wasn’t granted. Connect again whenever you’re ready.',
  expired: 'That sign-in attempt expired. Please try again.',
  failed: 'Couldn’t connect to Discogs. Please try again.',
} as const

type LoginError = keyof typeof LOGIN_ERRORS

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { error?: LoginError } => {
    const error = search.error
    return typeof error === 'string' && error in LOGIN_ERRORS
      ? { error: error as LoginError }
      : {}
  },
  beforeLoad: async () => {
    if (await getViewer()) throw redirect({ to: '/collection' })
  },
  component: SignIn,
})

function SignIn() {
  const { error } = Route.useSearch()

  return (
    <main className="sign-in">
      <div className="sign-in-panel">
        <h1>Vinyl Library</h1>
        <p className="muted">Browse the vinyl in your Discogs collection.</p>
        {error && (
          <p className="notice notice-error" role="alert">
            {LOGIN_ERRORS[error]}
          </p>
        )}
        <a className="button button-primary" href="/auth/discogs/start">
          <ButtonLabel>Connect Discogs</ButtonLabel>
        </a>
        <p className="fine-print">
          You’ll approve access on Discogs. This app only reads your collection.
        </p>
      </div>
    </main>
  )
}
