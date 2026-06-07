import { assert, describe, it } from 'vitest';

import { decryptFromStorage, encryptForStorage } from './storage-crypt.js';

describe('storage-crypt', () => {
  it('can encrypt and decrypt a string', () => {
    const plaintext = 'test message';
    const ciphertext = encryptForStorage(plaintext);
    const decrypted = decryptFromStorage(ciphertext);
    assert.equal(decrypted, plaintext);
  });

  it('encrypting the same plaintext twice produces different ciphertext', () => {
    const plaintext = 'test message';
    const a = encryptForStorage(plaintext);
    const b = encryptForStorage(plaintext);
    assert.notEqual(a, b);
  });

  it('empty string round-trips', () => {
    const ciphertext = encryptForStorage('');
    assert.equal(decryptFromStorage(ciphertext), '');
  });
});
