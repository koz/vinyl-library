import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { decrypt, encrypt } from './crypto.server'
import type { AccessCredentials } from './discogs.server'
import { getEnv } from './env.server'

const SESSION_COOKIE = 'vl_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const OAUTH_COOKIE = 'vl_oauth'
const OAUTH_MAX_AGE_SECONDS = 60 * 15

export type Session = {
  discogsId: number
  username: string
  credentials: AccessCredentials
}

type Sealed<T> = T & { kind: string; exp: number }

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: getEnv().secureCookies,
    sameSite: 'lax' as const,
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge }),
  }
}

// Cookies are encrypted with AES-256-GCM, so they can't be read or altered by the browser.
// `kind` stops one sealed cookie from being replayed as the other.
function seal<T extends object>(kind: string, value: T, maxAgeSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds
  return encrypt(JSON.stringify({ ...value, kind, exp }))
}

function unseal<T>(kind: string, cookie: string | undefined): T | null {
  if (!cookie) return null
  try {
    const value = JSON.parse(decrypt(cookie)) as Sealed<T>
    if (value.kind !== kind || value.exp <= Date.now() / 1000) return null
    return value
  } catch {
    return null
  }
}

export function createSession(session: Session): void {
  setCookie(
    SESSION_COOKIE,
    seal('session', session, SESSION_MAX_AGE_SECONDS),
    cookieOptions(SESSION_MAX_AGE_SECONDS),
  )
}

export function getSession(): Session | null {
  return unseal<Session>('session', getCookie(SESSION_COOKIE))
}

export function destroySession(): void {
  deleteCookie(SESSION_COOKIE, cookieOptions())
}

export function setOAuthRequest(request: AccessCredentials): void {
  setCookie(
    OAUTH_COOKIE,
    seal('oauth', request, OAUTH_MAX_AGE_SECONDS),
    cookieOptions(OAUTH_MAX_AGE_SECONDS),
  )
}

export function takeOAuthRequest(): AccessCredentials | null {
  const request = unseal<AccessCredentials>('oauth', getCookie(OAUTH_COOKIE))
  deleteCookie(OAUTH_COOKIE, cookieOptions())
  return request
}
