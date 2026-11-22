import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { PublicAccount } from '../../../shared/types/entities';
import type { AppConfig } from './config';
import { ConflictError, ServiceUnavailableError, UnauthorizedError } from '../errors/errorTypes';
import type { IDatabaseService } from './interfaces/IDatabaseService';
import type { AuthSession, IAuthService } from './interfaces/IAuthService';

export class AuthService implements IAuthService {
  constructor(private readonly database: IDatabaseService, private readonly config: AppConfig) {}

  async register(input: { name: string; email: string; password: string }): Promise<AuthSession> {
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
    const account = await this.database.findAccountByEmail(input.email);
    if (!account || !(await bcrypt.compare(input.password, account.passwordHash))) throw new UnauthorizedError('Email or password is incorrect.');
    return this.createSession({ id: account.id, name: account.name, email: account.email });
  }

  async authenticate(authorization: string | undefined): Promise<PublicAccount> {
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
}
