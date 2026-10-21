import { createFileRoute } from '@tanstack/react-router'
import { coverSourceUrl, fetchCover } from '../../server/cover.server'

// Discogs images have no CORS headers, so WebGL can only read them through this same-origin proxy.
export const Route = createFileRoute('/api/cover')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const source = coverSourceUrl(new URL(request.url).searchParams.get('url'))
        if (!source) return new Response(null, { status: 400 })
        try {
          return await fetchCover(source)
        } catch (error) {
          console.error('Could not fetch cover image', error)
          return new Response(null, { status: 502 })
        }
      },
    },
  },
})
