import { createFileRoute } from '@tanstack/react-router'
import { beginLogin } from '../../../server/auth.server'

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } })
}

export const Route = createFileRoute('/auth/discogs/start')({
  server: {
    handlers: {
      GET: async () => {
        try {
          return redirectTo(await beginLogin())
        } catch (error) {
          console.error('Could not start Discogs sign-in', error)
          return redirectTo('/?error=failed')
        }
      },
    },
  },
})
