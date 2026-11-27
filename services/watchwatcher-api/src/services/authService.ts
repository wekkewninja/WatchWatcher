import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { PublicAccount } from '../../../shared/types/entities';
import type { DeleteAccountRequest } from '../../../shared/types/api';
import type { AppConfig } from './config';
import { ConflictError, RateLimitError, ReauthenticationError, ServiceUnavailableError, UnauthorizedError } from '../errors/errorTypes';
import type { IDatabaseService } from './interfaces/IDatabaseService';
import type { AuthSession, GoogleAuthChallenge, GoogleAccountLinkRequest, GoogleSignInResult, IAuthService } from './interfaces/IAuthService';
import { GoogleIdentityVerifier, type VerifiedGoogleIdentity } from './googleIdentityVerifier';

export class AuthService implements IAuthService {
  constructor(
    private readonly database: IDatabaseService,
    private readonly config: AppConfig,
    private readonly googleVerifier: Pick<GoogleIdentityVerifier, 'verify'> = new GoogleIdentityVerifier(),
  ) {}

  async register(input: { name: string; email: string; password: string }): Promise<AuthSession> {
    input = { ...input, email: input.email.trim().toLowerCase() };
    await this.consumeLimit('registration', input.email, 3600);
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await this.database.createAccount({ id: randomUUID(), name: input.name, email: input.email, passwordHash });
      return this.createSession(user);
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      throw error;
    }
  }

  async login(input: { email: string; password: string }): Promise<AuthSession> {
    input = { ...input, email: input.email.trim().toLowerCase() };
    await this.consumeLimit('login', input.email, 900);
    const account = await this.database.findAccountByEmail(input.email);
    if (!account?.passwordHash || !(await bcrypt.compare(input.password, account.passwordHash))) throw new UnauthorizedError('Email or password is incorrect.');
    return this.createSession({ id: account.id, name: account.name, email: account.email });
  }

  getGoogleClientId(): string {
    if (!this.config.googleClientId) throw new ServiceUnavailableError('Google sign-in is not configured.');
    return this.config.googleClientId;
  }

  async createGoogleChallenge(): Promise<GoogleAuthChallenge> {
    this.getGoogleClientId();
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.database.createGoogleChallenge({ id: challengeId, nonceHash: hashNonce(nonce), expiresAt });
    return { challengeId, nonce, expiresAt: expiresAt.toISOString() };
  }

  async loginWithGoogle(input: {
    credential: string;
    challengeId: string;
    linkExisting?: GoogleAccountLinkRequest;
  }): Promise<GoogleSignInResult> {
    const audience = this.getGoogleClientId();

    let identity: VerifiedGoogleIdentity;
    try { identity = await this.googleVerifier.verify(input.credential, audience); }
    catch { throw new UnauthorizedError('Google sign-in credential is invalid or expired.'); }

    const nonceHash = hashNonce(identity.nonce);
    if (!(await this.database.isGoogleChallengeValid(input.challengeId, nonceHash))) {
      throw new UnauthorizedError('Google sign-in challenge is invalid, expired, or already used.');
    }

    const linkedAccount = await this.database.findAccountByGoogleSubject(identity.subject);
    if (linkedAccount) {
      if (!(await this.database.consumeGoogleChallenge(input.challengeId, nonceHash))) {
        throw new UnauthorizedError('Google sign-in challenge is invalid, expired, or already used.');
      }
      return { kind: 'session', session: this.createSession(linkedAccount) };
    }

    const existingAccount = await this.database.findAccountByEmail(identity.email);
    if (existingAccount) {
      if (!input.linkExisting) {
        return { kind: 'link-required' };
      }
      await this.consumeLimit('login', identity.email.trim().toLowerCase(), 900);
      if (!existingAccount.passwordHash || !(await bcrypt.compare(input.linkExisting.password, existingAccount.passwordHash))) {
        throw new UnauthorizedError('The existing account password is incorrect.');
      }
      await this.database.linkGoogleIdentity({
        accountId: existingAccount.id,
        email: identity.email,
        subject: identity.subject,
        challengeId: input.challengeId,
        nonceHash,
      });
      return { kind: 'session', session: this.createSession(existingAccount) };
    }

    const account = await this.database.createGoogleAccount({
      id: randomUUID(),
      name: identity.name,
      email: identity.email,
      subject: identity.subject,
      challengeId: input.challengeId,
      nonceHash,
    });
    return { kind: 'session', session: this.createSession(account) };
  }

  async authenticate(authorization: string | undefined): Promise<PublicAccount> {
    const claims = this.verifySession(authorization);
    const account = await this.database.findAccountById(claims.id);
    if (!account) throw new UnauthorizedError('Session is invalid or expired.');
    return { id: account.id, name: account.name, email: account.email };
  }

  async deleteAccount(authorization: string | undefined, input: DeleteAccountRequest): Promise<void> {
    const claims = this.verifySession(authorization);
    const account = await this.database.findAccountById(claims.id);
    if (!account) return;
    await this.consumeLimit('deletion', claims.id.toLowerCase(), 900);
    if (input.reauthentication.type === 'password') {
      if (!account.passwordHash || !(await bcrypt.compare(input.reauthentication.password, account.passwordHash))) {
        throw new ReauthenticationError();
      }
      await this.database.deleteAccount(account.id, { type: 'password', passwordHash: account.passwordHash });
      return;
    }
    const audience = this.getGoogleClientId();
    let identity: VerifiedGoogleIdentity;
    try { identity = await this.googleVerifier.verify(input.reauthentication.credential, audience); }
    catch { throw new ReauthenticationError(); }
    await this.database.deleteAccount(account.id, {
      type: 'google', subject: identity.subject, challengeId: input.reauthentication.challengeId, nonceHash: hashNonce(identity.nonce),
    });
  }

  private verifySession(authorization: string | undefined): PublicAccount {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedError();
    const secret = this.signingSecret();
    try {
      const claims = jwt.verify(match[1], secret, {
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      }) as JwtPayload;
      if (!claims.sub || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub) || typeof claims.name !== 'string' || typeof claims.email !== 'string') throw new UnauthorizedError();
      return { id: claims.sub, name: claims.name, email: claims.email };
    } catch {
      throw new UnauthorizedError('Session is invalid or expired.');
    }
  }

  private createSession(user: PublicAccount): AuthSession {
    const session = jwt.sign({ name: user.name, email: user.email }, this.signingSecret(), {
      algorithm: 'HS256', subject: user.id, issuer: this.config.jwtIssuer, audience: this.config.jwtAudience, expiresIn: '20m',
    });
    return { accountId: user.id, session, user };
  }

  private signingSecret(): string {
    const secret = this.config.jwtSecret;
    if (!secret || secret.length < 32) throw new ServiceUnavailableError('Session signing is not configured.');
    return secret;
  }

  private async consumeLimit(scope: string, identifier: string, windowSeconds: number): Promise<void> {
    const secret = this.config.rateLimitSecret;
    if (!secret || secret.trim().length < 32 || secret === this.config.jwtSecret) throw new ServiceUnavailableError('Rate limiting is not configured.');
    const keyHash = createHmac('sha256', secret).update(scope).update('\0').update(identifier).digest('hex');
    let result: { allowed: boolean; retryAfter: number };
    try { result = await this.database.consumeIdentifierLimit(keyHash, 5, windowSeconds); }
    catch { throw new ServiceUnavailableError('Rate limiting is unavailable.'); }
    if (!result.allowed) throw new RateLimitError(result.retryAfter);
  }
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}
