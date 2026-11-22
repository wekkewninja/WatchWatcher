import { OAuth2Client } from 'google-auth-library';

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  name: string;
  nonce: string;
}

export class GoogleIdentityVerifier {
  constructor(private readonly client: Pick<OAuth2Client, 'verifyIdToken'> = new OAuth2Client()) {}

  async verify(credential: string, audience: string): Promise<VerifiedGoogleIdentity> {
    const ticket = await this.client.verifyIdToken({ idToken: credential, audience });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true || !payload.nonce) {
      throw new Error('Google identity is missing a verified email, subject, or nonce.');
    }
    const email = payload.email.trim().toLowerCase();
    const displayName = payload.name?.trim() || email.split('@')[0] || 'Google learner';
    return {
      subject: payload.sub,
      email,
      name: (displayName.trim().length < 2 ? 'Google learner' : displayName).slice(0, 80),
      nonce: payload.nonce,
    };
  }
}
