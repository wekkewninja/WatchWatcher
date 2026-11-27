import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isPasswordWithinLimits } from '../../../shared/schemas/password';
import { ServiceUnavailableError } from '../errors/errorTypes';

const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const prefix = 'scrypt$v=1$N=16384,r=8,p=5';
const hashPattern = /^scrypt\$v=1\$N=16384,r=8,p=5\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      scrypt(password, salt, 32, options, (error, key) => error ? reject(new ServiceUnavailableError()) : resolve(key));
    } catch {
      reject(new ServiceUnavailableError());
    }
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!isPasswordWithinLimits(password)) throw new RangeError('Password exceeds the supported limit.');
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `${prefix}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!isPasswordWithinLimits(password)) return false;
  const match = typeof storedHash === 'string' && storedHash.length <= 128 ? hashPattern.exec(storedHash) : null;
  let salt = Buffer.alloc(16);
  let expected = Buffer.alloc(32);
  let valid = false;
  if (match) {
    const parsedSalt = Buffer.from(match[1], 'base64url');
    const parsedKey = Buffer.from(match[2], 'base64url');
    if (parsedSalt.length === 16 && parsedKey.length === 32 && parsedSalt.toString('base64url') === match[1] && parsedKey.toString('base64url') === match[2]) {
      salt = parsedSalt;
      expected = parsedKey;
      valid = true;
    }
  }
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected) && valid;
}