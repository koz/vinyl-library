import { useEffect } from 'react'
import Lenis from 'lenis'

export function useSmoothScroll() {
  useEffect(() => {
    const scroll = new Lenis({
      autoRaf: true,
      // Follow the existing overflow lock when a record is open.
      autoToggle: true,
      lerp: 0.12,
      anchors: true,
      stopInertiaOnNavigate: true,
      respectReducedMotion: true,
      syncTouch: false,
    })

    return () => scroll.destroy()
  }, [])
}
