import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getEnv } from './env.server'

const VERSION = 'v1'

export function encrypt(plaintext: string, key = getEnv().encryptionKey): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

export function decrypt(payload: string, key = getEnv().encryptionKey): string {
  const [version, iv, tag, ciphertext] = payload.split('.')
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('Unrecognized encrypted payload')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
