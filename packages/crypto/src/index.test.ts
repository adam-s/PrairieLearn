import * as crypto from 'node:crypto';

import { assert, describe, it } from 'vitest';

import { decrypt, encrypt } from './index.js';

describe('crypto', () => {
  it('can encrypt and decrypt a string', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const plaintext = 'test message';
    const ciphertext = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, key);
    assert.equal(decrypted, plaintext);
  });

  it('encrypting the same plaintext twice produces different ciphertext', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const plaintext = 'test message';
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);
    assert.notEqual(a, b);
  });

  it('decrypting with wrong key throws', () => {
    const keyA = crypto.randomBytes(32).toString('hex');
    const keyB = crypto.randomBytes(32).toString('hex');
    const ciphertext = encrypt('secret', keyA);
    assert.throws(() => decrypt(ciphertext, keyB));
  });

  it('tampered ciphertext throws', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const ciphertext = encrypt('secret', key);
    const buf = Buffer.from(ciphertext, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    assert.throws(() => decrypt(tampered, key));
  });

  it('empty string round-trips', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const ciphertext = encrypt('', key);
    assert.equal(decrypt(ciphertext, key), '');
  });

  it('throws on a key that is not 32 bytes', () => {
    const shortKey = crypto.randomBytes(16).toString('hex');
    assert.throws(() => encrypt('secret', shortKey), /Expected a 32-byte key/);
  });
});
