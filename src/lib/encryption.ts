import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

let derivedKey: Buffer | null = null

function getKey(): Buffer {
  if (derivedKey) return derivedKey
  const secret = process.env.EMAIL_ENCRYPT_SECRET
  const salt = process.env.EMAIL_ENCRYPT_SALT
  if (!secret || !salt) {
    throw new Error(
      'Missing EMAIL_ENCRYPT_SECRET or EMAIL_ENCRYPT_SALT environment variables. ' +
        'Generate them with: openssl rand -hex 32'
    )
  }
  derivedKey = scryptSync(secret, salt, KEY_LENGTH) as Buffer
  return derivedKey
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a hex-encoded string: iv (16 bytes) + authTag (16 bytes) + ciphertext.
 * Requires EMAIL_ENCRYPT_SECRET and EMAIL_ENCRYPT_SALT environment variables.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('hex')
}

/**
 * Decrypts a hex-encoded ciphertext produced by encryptToken.
 * Returns null if decryption fails (wrong key, tampered data, etc.).
 */
export function decryptToken(ciphertext: string): string | null {
  try {
    const key = getKey()
    const buf = Buffer.from(ciphertext, 'hex')
    const iv = buf.subarray(0, IV_LENGTH)
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(encrypted) + decipher.final('utf8')
  } catch {
    return null
  }
}
