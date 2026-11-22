import { describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';
import { GoogleIdentityVerifier } from '../src/services/googleIdentityVerifier';

describe('GoogleIdentityVerifier', () => {
  it('requires a verified email and returns the signed subject and nonce', async () => {
    const payload = {
      sub: 'google-subject',
      email: '  sailor@example.test ',
      email_verified: true,
      name: 'Sailor',
      nonce: 'one-time-nonce',
    };
    const verifyIdToken = vi.fn(async () => ({ getPayload: () => payload }));
    const verifier = new GoogleIdentityVerifier({ verifyIdToken } as unknown as Pick<OAuth2Client, 'verifyIdToken'>);

    await expect(verifier.verify('signed-id-token', 'configured-client-id')).resolves.toEqual({
      subject: 'google-subject',
      email: 'sailor@example.test',
      name: 'Sailor',
      nonce: 'one-time-nonce',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'signed-id-token', audience: 'configured-client-id' });
  });

  it('rejects unverified email claims and missing nonces', async () => {
    const verifier = new GoogleIdentityVerifier({
      verifyIdToken: vi.fn(async () => ({ getPayload: () => ({ sub: 'google-subject', email: 'sailor@example.test', email_verified: false, nonce: 'nonce' }) })),
    } as unknown as Pick<OAuth2Client, 'verifyIdToken'>);
    await expect(verifier.verify('token', 'client-id')).rejects.toThrow('verified email');

    const missingNonce = new GoogleIdentityVerifier({
      verifyIdToken: vi.fn(async () => ({ getPayload: () => ({ sub: 'google-subject', email: 'sailor@example.test', email_verified: true }) })),
    } as unknown as Pick<OAuth2Client, 'verifyIdToken'>);
    await expect(missingNonce.verify('token', 'client-id')).rejects.toThrow('nonce');
  });
});