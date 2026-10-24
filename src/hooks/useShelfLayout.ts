import { useEffect, useState } from 'react'
import type { ShelfLayout } from '../components/shelf/VinylShelf'

const LAYOUT_KEY = 'vinyl-library:layout'

/**
 * Whether the collection is shown on shelves or in a crate, remembered in this browser. The page
 * owns it so the header can switch views; `available` turns false if the 3D view cannot run.
 */
export function useShelfLayout() {
  const [layout, setLayout] = useState<ShelfLayout>('shelves')
  const [available, setAvailable] = useState(true)

  // Read after hydration; the server always renders shelves.
  useEffect(() => {
    try {
      if (localStorage.getItem(LAYOUT_KEY) === 'crate') setLayout('crate')
    } catch {
      // Storage can be unavailable; shelves remain the default.
    }
  }, [])

  function toggle() {
    const next = layout === 'shelves' ? 'crate' : 'shelves'
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // The choice still applies until the page is reloaded.
    }
  }

  return { layout, available, toggle, markUnavailable: () => setAvailable(false) }
}
