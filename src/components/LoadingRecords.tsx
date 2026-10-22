import { Disc3 } from 'lucide-react'

export function LoadingRecords() {
  return (
    <div className="shelf-loading" role="status" aria-label="Loading records…">
      <div className="shelf-spinner" aria-hidden="true">
        <Disc3 size={28} strokeWidth={1.5} absoluteStrokeWidth />
      </div>
    </div>
  )
}
