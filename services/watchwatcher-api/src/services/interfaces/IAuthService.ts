import type { PublicAccount } from '../../../../shared/types/entities';

export interface AuthSession {
  accountId: string;
  session: string;
  user: PublicAccount;
}

export interface IAuthService {
  register(input: { name: string; email: string; password: string }): Promise<AuthSession>;
  login(input: { email: string; password: string }): Promise<AuthSession>;
  authenticate(authorization: string | undefined): Promise<PublicAccount>;
}
