import { ButtonLabel } from './ButtonLabel'

export function InitialImportFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="shelf-loading shelf-import-error" role="alert">
      <p>
        Failed to import collection from Discogs, click{' '}
        <a className="inline-link" href="/collection" onClick={(event) => {
          event.preventDefault()
          onRetry()
        }}><ButtonLabel>here</ButtonLabel></a>{' '}to try again.
      </p>
    </div>
  )
}

