import { VinylIcon } from './VinylIcon'

export function LoadingRecords() {
  return (
    <div className="shelf-loading" role="status" aria-label="Loading records…">
      <div className="shelf-spinner" aria-hidden="true">
        <VinylIcon />
      </div>
    </div>
  )
}
