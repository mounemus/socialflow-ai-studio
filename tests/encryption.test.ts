import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '@/lib/encryption';

describe('encryption (AES-256-GCM)', () => {
  it('roundtrips a string', () => {
    const original = 'access_token_secret_value';
    const enc = encrypt(original);
    expect(enc).not.toBe(original);
    expect(enc).toContain(':');
    expect(decrypt(enc)).toBe(original);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same-input');
    expect(decrypt(b)).toBe('same-input');
  });

  it('fails to decrypt tampered ciphertext', () => {
    const enc = encrypt('secret');
    const tampered = enc.replace(/[a-f0-9]/, (c) => (c === '0' ? 'f' : '0'));
    expect(() => decrypt(tampered)).toThrow();
  });

  it('handles unicode and long strings', () => {
    const long = '🚀 ' + 'lorem ipsum '.repeat(500) + 'éàç';
    expect(decrypt(encrypt(long))).toBe(long);
  });
});
