import type { DiscogsCollectionRelease } from '../lib/collection'
import { getEnv } from './env.server'
import { oauthHeader } from './oauth.server'

const API_URL = 'https://api.discogs.com'
const AUTHORIZE_URL = 'https://www.discogs.com/oauth/authorize'
const MAX_ATTEMPTS = 4

export type AccessCredentials = { token: string; secret: string }

export class DiscogsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'DiscogsError'
  }
}

export class DiscogsAuthError extends DiscogsError {
  constructor(message = 'Discogs rejected the stored credentials') {
    super(message, 401)
    this.name = 'DiscogsAuthError'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function discogsFetch(
  path: string,
  init: { method?: 'GET' | 'POST'; auth: Parameters<typeof oauthHeader>[0] },
): Promise<Response> {
  const env = getEnv()

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: oauthHeader(init.auth),
        'User-Agent': env.discogsUserAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get('Retry-After'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000)
      continue
    }

    if (response.status === 401) {
      throw new DiscogsAuthError()
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new DiscogsError(
        `Discogs request failed (${response.status}): ${body.slice(0, 200)}`,
        response.status,
      )
    }

    // Stay within Discogs' moving 60-second rate-limit window.
    const remaining = Number(response.headers.get('X-Discogs-Ratelimit-Remaining'))
    if (Number.isFinite(remaining) && remaining <= 3) {
      await sleep(5_000)
    }

    return response
  }
}

function consumer() {
  const env = getEnv()
  return { consumerKey: env.discogsConsumerKey, consumerSecret: env.discogsConsumerSecret }
}

function parseTokenResponse(body: string): AccessCredentials {
  const params = new URLSearchParams(body)
  const token = params.get('oauth_token')
  const secret = params.get('oauth_token_secret')
  if (!token || !secret) throw new DiscogsError('Malformed token response from Discogs', 502)
  return { token, secret }
}

export async function getRequestToken(callback: string): Promise<AccessCredentials> {
  const response = await discogsFetch('/oauth/request_token', {
    auth: { ...consumer(), callback },
  })
  return parseTokenResponse(await response.text())
}

export function authorizeUrl(requestToken: string): string {
  return `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(requestToken)}`
}

export async function getAccessToken(
  request: AccessCredentials,
  verifier: string,
): Promise<AccessCredentials> {
  const response = await discogsFetch('/oauth/access_token', {
    method: 'POST',
    auth: { ...consumer(), token: request.token, tokenSecret: request.secret, verifier },
  })
  return parseTokenResponse(await response.text())
}

export async function getIdentity(
  credentials: AccessCredentials,
): Promise<{ id: number; username: string }> {
  const response = await discogsFetch('/oauth/identity', {
    auth: { ...consumer(), token: credentials.token, tokenSecret: credentials.secret },
  })
  const body = (await response.json()) as { id: number; username: string }
  return { id: body.id, username: body.username }
}

export type CollectionPage = {
  pagination: { page: number; pages: number; items: number }
  releases: DiscogsCollectionRelease[]
}

export async function getCollectionPage(
  credentials: AccessCredentials,
  username: string,
  page: number,
): Promise<CollectionPage> {
  // Oldest additions first, so records added during an import append rather than shift pages.
  const query = new URLSearchParams({
    page: String(page),
    per_page: '100',
    sort: 'added',
    sort_order: 'asc',
  })
  const response = await discogsFetch(
    `/users/${encodeURIComponent(username)}/collection/folders/0/releases?${query}`,
    { auth: { ...consumer(), token: credentials.token, tokenSecret: credentials.secret } },
  )
  return (await response.json()) as CollectionPage
}
