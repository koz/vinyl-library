import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from './crypto.server'

describe('token encryption', () => {
  const key = randomBytes(32)

  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt('secret-token', key)
    const b = encrypt('secret-token', key)
    expect(a).not.toBe(b)
    expect(decrypt(a, key)).toBe('secret-token')
  })

  it('rejects tampered ciphertext and wrong keys', () => {
    const payload = encrypt('secret-token', key)
    const tampered = payload.slice(0, -2) + (payload.endsWith('A') ? 'BB' : 'AA')
    expect(() => decrypt(tampered, key)).toThrow()
    expect(() => decrypt(payload, randomBytes(32))).toThrow()
  })
})
