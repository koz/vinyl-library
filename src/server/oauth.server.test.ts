import { describe, expect, it } from 'vitest'
import { oauthHeader, percentEncode } from './oauth.server'

describe('percentEncode', () => {
  it('encodes reserved characters per RFC 3986', () => {
    expect(percentEncode("a b!*'()&=")).toBe('a%20b%21%2A%27%28%29%26%3D')
  })
})

describe('oauthHeader', () => {
  it('builds a PLAINTEXT-signed header', () => {
    const header = oauthHeader({
      consumerKey: 'key',
      consumerSecret: 'sec&ret',
      token: 'tok',
      tokenSecret: 'toksec',
      verifier: 'ver',
      nonce: 'n',
      timestamp: 1700000000,
    })
    expect(header).toBe(
      'OAuth oauth_consumer_key="key", oauth_nonce="n", ' +
        'oauth_signature="sec%2526ret%26toksec", oauth_signature_method="PLAINTEXT", ' +
        'oauth_timestamp="1700000000", oauth_version="1.0", oauth_token="tok", oauth_verifier="ver"',
    )
  })
})
