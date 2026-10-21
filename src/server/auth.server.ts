import { authorizeUrl, getAccessToken, getIdentity, getRequestToken } from './discogs.server'
import { getEnv } from './env.server'
import { createSession, setOAuthRequest, takeOAuthRequest } from './session.server'

export type LoginError = 'denied' | 'expired' | 'failed'

export async function beginLogin(): Promise<string> {
  const request = await getRequestToken(`${getEnv().appUrl}/auth/discogs/callback`)
  // Binds the Discogs authorization to this browser, so a callback can't be completed elsewhere.
  setOAuthRequest(request)
  return authorizeUrl(request.token)
}

export async function completeLogin(url: URL): Promise<LoginError | null> {
  const request = takeOAuthRequest()
  const token = url.searchParams.get('oauth_token')
  const verifier = url.searchParams.get('oauth_verifier')

  if (url.searchParams.has('denied') || !verifier) return 'denied'
  if (!request || request.token !== token) return 'expired'

  const credentials = await getAccessToken(request, verifier)
  const identity = await getIdentity(credentials)
  createSession({ discogsId: identity.id, username: identity.username, credentials })
  return null
}
