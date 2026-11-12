import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM sealing for secrets stored in the database (Slack tokens, webhook URLs, signing keys).
 * Format: "v1.<base64url(iv | authTag | ciphertext)>". The key never leaves the server.
 */
export class Secrets {
  constructor(private key: Buffer) {
    if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  }

  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')}`;
  }

  open<T>(sealed: string | null | undefined): T | null {
    if (!sealed?.startsWith('v1.')) return null;
    try {
      const raw = Buffer.from(sealed.slice(3), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
      return JSON.parse(text) as T;
    } catch {
      return null; // wrong key or tampered ciphertext
    }
  }
}

export function hmac(algorithm: 'sha256' | 'sha512', key: string | Buffer, data: string | Buffer, encoding: 'hex' | 'base64' = 'hex'): string {
  return createHmac(algorithm, key).update(data).digest(encoding);
}

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

/** Short, unambiguous, upper-case code (no 0/O/1/I) for WhatsApp linking. */
export function shortCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(length), (b) => alphabet[b % alphabet.length]).join('');
}

export function mask(value: string, visible = 4): string {
  if (value.length <= visible * 2) return '•'.repeat(value.length);
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}
