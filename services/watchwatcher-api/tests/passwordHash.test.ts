import { scrypt } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../src/services/passwordHash';

vi.mock('node:crypto', async (importOriginal) => {
  const crypto = await importOriginal<typeof import('node:crypto')>();
  return { ...crypto, scrypt: vi.fn(crypto.scrypt) };
});

describe('password hashing', () => {
  it('uses exactly one fixed-cost derivation for each verification class', async () => {
    const hash = await hashPassword('synthetic-password');
    const salt = Buffer.from(hash.split('$')[3], 'base64url');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const noncanonical = hash.slice(0, -1) + alphabet[alphabet.indexOf(hash.at(-1)!) + 1];
    const cases = [
      { hash: undefined, password: 'synthetic-password', result: false, salt: Buffer.alloc(16) },
      { hash: null, password: 'synthetic-password', result: false, salt: Buffer.alloc(16) },
      { hash: '$2b$12$legacy', password: 'synthetic-password', result: false, salt: Buffer.alloc(16) },
      { hash: 'scrypt$v=1$N=999999999,r=8,p=5$bad$bad', password: 'synthetic-password', result: false, salt: Buffer.alloc(16) },
      { hash: hash.replace(/.$/, '='), password: 'synthetic-password', result: false, salt: Buffer.alloc(16) },
      { hash: noncanonical, password: 'synthetic-password', result: false, salt: Buffer.alloc(16) },
      { hash, password: 'wrong-password', result: false, salt },
      { hash, password: 'synthetic-password', result: true, salt },
    ];
    for (const candidate of cases) {
      vi.mocked(scrypt).mockClear();
      expect(await verifyPassword(candidate.password, candidate.hash)).toBe(candidate.result);
      expect(scrypt).toHaveBeenCalledTimes(1);
      expect(scrypt).toHaveBeenCalledWith(candidate.password, candidate.salt, 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }, expect.any(Function));
    }
    vi.mocked(scrypt).mockClear();
    expect(await verifyPassword('a'.repeat(1025), null)).toBe(false);
    expect(scrypt).not.toHaveBeenCalled();
  });

  it('reports asynchronous and synchronous scrypt failures without exposing details', async () => {
    vi.mocked(scrypt).mockImplementationOnce(((_password, _salt, _length, _options, callback) => {
      callback(new Error('private scrypt detail'), undefined);
    }) as typeof scrypt);
    await expect(verifyPassword('synthetic-password', null)).rejects.toMatchObject({ statusCode: 503, message: 'A required service is unavailable' });
    vi.mocked(scrypt).mockImplementationOnce((() => { throw new Error('private scrypt detail'); }) as typeof scrypt);
    const failure = await hashPassword('synthetic-password').catch((error: unknown) => error);
    expect(failure).toMatchObject({ statusCode: 503, message: 'A required service is unavailable' });
    expect(JSON.stringify(failure)).not.toContain('private scrypt detail');
  });

  it('preserves exact Unicode input without normalization or trimming', async () => {
    const hash = await hashPassword('  caf\u00e9 password  ');
    expect(await verifyPassword('  caf\u00e9 password  ', hash)).toBe(true);
    expect(await verifyPassword('  cafe\u0301 password  ', hash)).toBe(false);
    expect(await verifyPassword('caf\u00e9 password', hash)).toBe(false);
  });
  it('distinguishes ASCII passwords with the same first 72 bytes', async () => {
    const prefix = 'a'.repeat(72);
    const hash = await hashPassword(prefix + 'original');
    expect(await verifyPassword(prefix + 'original', hash)).toBe(true);
    expect(await verifyPassword(prefix + 'different', hash)).toBe(false);
  });

  it('hashes all bytes of long passwords with a unique random salt', async () => {
    const password = 'a'.repeat(72) + '\u{1f6a2}'.repeat(64);
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password.slice(0, 72), first)).toBe(false);
    expect(await verifyPassword('b' + password.slice(1), first)).toBe(false);
    expect(await verifyPassword(password, '$2b$12$legacy')).toBe(false);
    expect(await verifyPassword(password, first.replace('N=16384', 'N=1073741824'))).toBe(false);
    expect(await verifyPassword(password, first + '$extra')).toBe(false);
  });

  it('accepts the maximum and rejects oversized or invalid Unicode input', async () => {
    const maximum = '\u{1f6a2}'.repeat(1024);
    const hash = await hashPassword(maximum);
    expect(await verifyPassword(maximum, hash)).toBe(true);
    expect(await verifyPassword(maximum + 'a', hash)).toBe(false);
    await expect(hashPassword('a'.repeat(1025))).rejects.toThrow(RangeError);
    await expect(hashPassword('password\ud800')).rejects.toThrow(RangeError);
    expect(await verifyPassword('password\ud800', hash)).toBe(false);
  });

  it('fails closed on malformed, noncanonical and excessive stored parameters', async () => {
    const hash = await hashPassword('synthetic-password');
    for (const invalid of [null, undefined, '', 'x'.repeat(129), hash.replace('v=1', 'v=2'),
      hash.replace('r=8', 'r=999'), hash.replace('p=5', 'p=999'), hash.replace('N=16384', 'N=16385'),
      hash.replace(/\$[^$]+$/, '$invalid'), hash.replace(/.$/, '='), hash + '$extra']) {
      expect(await verifyPassword('synthetic-password', invalid)).toBe(false);
    }
  });
});