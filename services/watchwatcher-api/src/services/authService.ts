import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { PublicAccount } from '../../../shared/types/entities';
import type { DeleteAccountRequest } from '../../../shared/types/api';
import type { AppConfig } from './config';
import { ConflictError, RateLimitError, ReauthenticationError, ServiceUnavailableError, UnauthorizedError } from '../errors/errorTypes';
import type { IDatabaseService } from './interfaces/IDatabaseService';
import type { AuthSession, GoogleAuthChallenge, GoogleAccountLinkRequest, GoogleSignInResult, IAuthService } from './interfaces/IAuthService';
import { GoogleIdentityVerifier, type VerifiedGoogleIdentity } from './googleIdentityVerifier';
import { hashPassword, verifyPassword } from './passwordHash';
import { deletionReceiptHash } from './deletionReceipt';

export class AuthService implements IAuthService {
  constructor(
    private readonly database: IDatabaseService,
    private readonly config: AppConfig,
    private readonly googleVerifier: Pick<GoogleIdentityVerifier, 'verify'> = new GoogleIdentityVerifier(),
  ) {}

  async register(input: { name: string; email: string; password: string }): Promise<AuthSession> {
    input = { ...input, email: input.email.trim().toLowerCase() };
    await this.consumeLimit('registration', input.email, 3600);
    const passwordHash = await hashPassword(input.password);
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
    if (!(await verifyPassword(input.password, account?.passwordHash)) || !account) throw new UnauthorizedError('Email or password is incorrect.');
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
      return { kind: 'session', session: await this.createSession(linkedAccount) };
    }

    const existingAccount = await this.database.findAccountByEmail(identity.email);
    if (input.linkExisting) {
      await this.consumeLimit('login', identity.email.trim().toLowerCase(), 900);
      if (!(await verifyPassword(input.linkExisting.password, existingAccount?.passwordHash)) || !existingAccount) {
        throw new UnauthorizedError('The existing account password is incorrect.');
      }
      await this.database.linkGoogleIdentity({
        accountId: existingAccount.id,
        email: identity.email,
        subject: identity.subject,
        challengeId: input.challengeId,
        nonceHash,
      });
      return { kind: 'session', session: await this.createSession(existingAccount) };
    }

    if (existingAccount) return { kind: 'link-required' };

    const account = await this.database.createGoogleAccount({
      id: randomUUID(),
      name: identity.name,
      email: identity.email,
      subject: identity.subject,
      challengeId: input.challengeId,
      nonceHash,
    });
    return { kind: 'session', session: await this.createSession(account) };
  }

  async authenticate(authorization: string | undefined): Promise<PublicAccount> {
    const claims = this.verifySession(authorization);
    const account = await this.findSessionAccount(claims.sessionId, claims.id);
    if (!account) throw new UnauthorizedError('Session is invalid or expired.');
    return { id: account.id, name: account.name, email: account.email };
  }

  async consumeEvaluationLimit(accountId: string): Promise<void> {
    await this.consumeLimit('evaluation', accountId, 3600, 30);
  }

  async logout(authorization: string | undefined): Promise<void> {
    const claims = this.verifySession(authorization);
    try {
      await this.database.revokeSession(claims.sessionId, claims.id);
    }
    catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new ServiceUnavailableError('Session store is unavailable.');
    }
  }

  async deleteAccount(authorization: string | undefined, input: DeleteAccountRequest): Promise<void> {
    const claims = this.verifySession(authorization);
    if ('receiptOnly' in input) {
      try {
        if (await this.database.hasDeletionReceipt(deletionReceiptHash(claims.id, claims.sessionId))) return;
      } catch { throw new ServiceUnavailableError('Session store is unavailable.'); }
      throw new UnauthorizedError('Deletion receipt is unavailable.');
    }
    const account = await this.findSessionAccount(claims.sessionId, claims.id);
    if (!account) {
      try {
        if (await this.database.hasDeletionReceipt(deletionReceiptHash(claims.id, claims.sessionId))) return;
      } catch { throw new ServiceUnavailableError('Session store is unavailable.'); }
      throw new UnauthorizedError('Session is invalid or expired.');
    }
    await this.consumeLimit('deletion', claims.id.toLowerCase(), 900);
    if (input.reauthentication.type === 'password') {
      if (!account.passwordHash || !(await verifyPassword(input.reauthentication.password, account.passwordHash))) {
        throw new ReauthenticationError();
      }
      await this.deleteWithReceipt(account.id, { type: 'password', passwordHash: account.passwordHash }, claims.sessionId, claims.expiresAt);
      return;
    }
    const audience = this.getGoogleClientId();
    let identity: VerifiedGoogleIdentity;
    try { identity = await this.googleVerifier.verify(input.reauthentication.credential, audience); }
    catch { throw new ReauthenticationError(); }
    await this.deleteWithReceipt(account.id, {
      type: 'google', subject: identity.subject, challengeId: input.reauthentication.challengeId, nonceHash: hashNonce(identity.nonce),
    }, claims.sessionId, claims.expiresAt);
  }

  private async deleteWithReceipt(accountId: string, verification: Parameters<IDatabaseService['deleteAccount']>[1], sessionId: string, expiresAt: Date): Promise<void> {
    try { await this.database.deleteAccount(accountId, verification, sessionId, expiresAt); }
    catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      try {
        if (await this.database.hasDeletionReceipt(deletionReceiptHash(accountId, sessionId))) return;
      } catch { throw new ServiceUnavailableError('Session store is unavailable.'); }
      throw error;
    }
  }

  private verifySession(authorization: string | undefined): { id: string; sessionId: string; expiresAt: Date } {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedError();
    const secret = this.signingSecret();
    try {
      const claims = jwt.verify(match[1], secret, {
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      }) as JwtPayload;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!claims.sub || !uuid.test(claims.sub) || typeof claims.jti !== 'string' || !uuid.test(claims.jti) || typeof claims.exp !== 'number') throw new UnauthorizedError();
      return { id: claims.sub, sessionId: claims.jti, expiresAt: new Date(claims.exp * 1000) };
    } catch {
      throw new UnauthorizedError('Session is invalid or expired.');
    }
  }

  private async createSession(user: PublicAccount): Promise<AuthSession> {
    const sessionId = randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 20 * 60;
    const session = jwt.sign({ exp: expiresAt }, this.signingSecret(), {
      algorithm: 'HS256', subject: user.id, jwtid: sessionId, issuer: this.config.jwtIssuer, audience: this.config.jwtAudience,
    });
    try { await this.database.createSession(sessionId, user.id, new Date(expiresAt * 1000)); }
    catch { throw new ServiceUnavailableError('Session store is unavailable.'); }
    return { accountId: user.id, session, user };
  }

  private async findSessionAccount(sessionId: string, accountId: string) {
    try { return await this.database.findSessionAccount(sessionId, accountId); }
    catch { throw new ServiceUnavailableError('Session store is unavailable.'); }
  }

  private signingSecret(): string {
    const secret = this.config.jwtSecret;
    if (!secret || secret.length < 32) throw new ServiceUnavailableError('Session signing is not configured.');
    return secret;
  }

  private async consumeLimit(scope: string, identifier: string, windowSeconds: number, limit = 5): Promise<void> {
    const secret = this.config.rateLimitSecret;
    if (!secret || secret.trim().length < 32 || secret === this.config.jwtSecret) throw new ServiceUnavailableError('Rate limiting is not configured.');
    const keyHash = createHmac('sha256', secret).update(scope).update('\0').update(identifier).digest('hex');
    let result: { allowed: boolean; retryAfter: number };
    try { result = await this.database.consumeIdentifierLimit(keyHash, limit, windowSeconds); }
    catch { throw new ServiceUnavailableError('Rate limiting is unavailable.'); }
    if (!result.allowed) throw new RateLimitError(result.retryAfter);
  }
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}
