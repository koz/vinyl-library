import { randomBytes } from 'node:crypto'

export type OAuthParams = {
  consumerKey: string
  consumerSecret: string
  token?: string
  tokenSecret?: string
  callback?: string
  verifier?: string
  nonce?: string
  timestamp?: number
}

// RFC 3986 encoding, as required by OAuth 1.0a.
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

// Discogs accepts the PLAINTEXT signature method over HTTPS.
export function oauthHeader(params: OAuthParams): string {
  const fields: Record<string, string> = {
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: params.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature: `${percentEncode(params.consumerSecret)}&${percentEncode(params.tokenSecret ?? '')}`,
    oauth_signature_method: 'PLAINTEXT',
    oauth_timestamp: String(params.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  }
  if (params.token) fields.oauth_token = params.token
  if (params.callback) fields.oauth_callback = params.callback
  if (params.verifier) fields.oauth_verifier = params.verifier

  return (
    'OAuth ' +
    Object.entries(fields)
      .map(([key, value]) => `${key}="${percentEncode(value)}"`)
      .join(', ')
  )
}
