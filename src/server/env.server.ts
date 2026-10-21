type Env = {
  appUrl: string
  secureCookies: boolean
  discogsConsumerKey: string
  discogsConsumerSecret: string
  discogsUserAgent: string
  encryptionKey: Buffer
  spotifyClientId: string | undefined
  spotifyClientSecret: string | undefined
  spotifyMarket: string
}

let cached: Env | undefined

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}

export function getEnv(): Env {
  if (cached) return cached

  try {
    process.loadEnvFile()
  } catch {
    // No .env file; rely on the process environment.
  }

  const encryptionKey = Buffer.from(required('TOKEN_ENCRYPTION_KEY'), 'base64')
  if (encryptionKey.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  }

  const appUrl = required('APP_URL').replace(/\/+$/, '')

  cached = {
    appUrl,
    secureCookies: appUrl.startsWith('https://'),
    discogsConsumerKey: required('DISCOGS_CONSUMER_KEY'),
    discogsConsumerSecret: required('DISCOGS_CONSUMER_SECRET'),
    discogsUserAgent: required('DISCOGS_USER_AGENT'),
    encryptionKey,
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID?.trim() || undefined,
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET?.trim() || undefined,
    spotifyMarket: /^[A-Z]{2}$/.test(process.env.SPOTIFY_MARKET ?? '') ? process.env.SPOTIFY_MARKET! : 'NL',
  }
  return cached
}
