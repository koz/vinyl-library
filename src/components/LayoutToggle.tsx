import { Search } from 'lucide-react'
import type { ShelfLayout } from './shelf/VinylShelf'
import { ShelvesIcon } from './ShelvesIcon'

/** Switches between the shelves and the crate. The icon shows the view it switches to. */
export function LayoutToggle({ layout, onToggle }: { layout: ShelfLayout; onToggle: () => void }) {
  const label = layout === 'shelves' ? 'Flip through the crate' : 'Show the shelves'
  return (
    <button className="button button-icon button-layout" type="button" onClick={onToggle} aria-label={label} title={label}>
      {layout === 'shelves'
        ? <Search size={24} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
        : <ShelvesIcon />}
    </button>
  )
}
