import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { Learner } from '../domain-types';
import { AuthStateService } from './auth-state.service';

const sailor: Learner = { id: 'sailor-1', name: 'Sailor', email: 'sailor@example.test' };
const sessionResponse = () => ({ accountId: sailor.id, session: 'session-token', user: sailor });
const fetchResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('AuthStateService', () => {
  beforeEach(async () => {
    localStorage.clear();
    await api.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    await api.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('restores a current user on startup and marks initialization ready', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ user: sailor }));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();

    await auth.initialization;
    await vi.waitFor(() => expect(auth.ready()).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.user()).toEqual(sailor);
  });

  it('does not restore a session after an explicit signed-out choice', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();

    await auth.initialization;
    await vi.waitFor(() => expect(auth.ready()).toBe(true));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.user()).toBeNull();
  });

  it('clears stale user state when session restoration fails', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ error: { code: 'UNAUTHORIZED', message: 'Session expired.' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();

    await auth.initialization;
    await vi.waitFor(() => expect(auth.ready()).toBe(true));

    expect(auth.user()).toBeNull();
  });

  it('sets the user and clears the signed-out marker after login or account creation', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse(sessionResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthStateService();
    await auth.initialization;
    localStorage.setItem('watchwatcher-signed-out', 'true');

    await auth.login(sailor.email, 'password');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login');
    expect(auth.user()).toEqual(sailor);
    expect(localStorage.getItem('watchwatcher-signed-out')).toBeNull();

    await auth.createAccount(sailor.name, sailor.email, 'password');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/register');
    expect(auth.user()).toEqual(sailor);
  });

  it('updates state only when Google sign-in authenticates an account', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse({ error: { code: 'CONFLICT', message: 'Link account', details: { reason: 'GOOGLE_ACCOUNT_LINK_REQUIRED' } } }, 409))
      .mockResolvedValueOnce(fetchResponse(sessionResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthStateService();
    await auth.initialization;
    localStorage.setItem('watchwatcher-signed-out', 'true');
    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: 'challenge' })).resolves.toEqual({ kind: 'link-required' });
    expect(auth.user()).toBeNull();
    expect(localStorage.getItem('watchwatcher-signed-out')).toBe('true');

    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: 'challenge' })).resolves.toEqual({ kind: 'authenticated', user: sailor });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.user()).toEqual(sailor);
    expect(localStorage.getItem('watchwatcher-signed-out')).toBeNull();
  });

  it('marks the session signed out and clears the user after logout', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ user: sailor }));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();
    await auth.initialization;

    await auth.logout();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('watchwatcher-signed-out')).toBe('true');
    expect(auth.user()).toBeNull();
  });
});