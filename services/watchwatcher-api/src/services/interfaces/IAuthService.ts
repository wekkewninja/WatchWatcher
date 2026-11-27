import type { PublicAccount } from '../../../../shared/types/entities';
import type { DeleteAccountRequest } from '../../../../shared/types/api';

export interface AuthSession {
  accountId: string;
  session: string;
  user: PublicAccount;
}

export interface GoogleAuthChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: string;
}

export interface GoogleAccountLinkRequest {
  confirmed: true;
  password: string;
}

export type GoogleSignInResult =
  | { kind: 'session'; session: AuthSession }
  | { kind: 'link-required' };

export interface IAuthService {
  register(input: { name: string; email: string; password: string }): Promise<AuthSession>;
  login(input: { email: string; password: string }): Promise<AuthSession>;
  getGoogleClientId(): string;
  createGoogleChallenge(): Promise<GoogleAuthChallenge>;
  loginWithGoogle(input: { credential: string; challengeId: string; linkExisting?: GoogleAccountLinkRequest }): Promise<GoogleSignInResult>;
  authenticate(authorization: string | undefined): Promise<PublicAccount>;
  consumeEvaluationLimit(accountId: string): Promise<void>;
  logout(authorization: string | undefined): Promise<void>;
  deleteAccount(authorization: string | undefined, input: DeleteAccountRequest): Promise<void>;
}
