import { encryptToken, decryptToken } from '@/lib/encryption'

/**
 * Encrypts an OAuth token for storage in the database.
 * Returns the encrypted hex string, or null if plaintext is empty.
 */
export async function encryptSecret({
  plaintext,
}: {
  plaintext?: string | null
}): Promise<string | null> {
  if (!plaintext) return null
  return encryptToken(plaintext)
}

/**
 * Decrypts an OAuth token read from the database.
 * Returns the plaintext string, or null if ciphertext is empty or decryption fails.
 */
export async function decryptSecret({
  ciphertext,
}: {
  ciphertext?: string | null
}): Promise<string | null> {
  if (!ciphertext) return null
  return decryptToken(ciphertext)
}
