import { createFileRoute } from '@tanstack/react-router'
import { completeLogin, type LoginError } from '../../../server/auth.server'

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } })
}

export const Route = createFileRoute('/auth/discogs/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let error: LoginError | null
        try {
          error = await completeLogin(new URL(request.url))
        } catch (cause) {
          console.error('Discogs sign-in failed', cause)
          error = 'failed'
        }
        return redirectTo(error ? `/?error=${error}` : '/collection')
      },
    },
  },
})
