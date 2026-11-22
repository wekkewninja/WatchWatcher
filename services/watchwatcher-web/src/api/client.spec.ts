import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveClient } from './client';

describe('live API client sessions', () => {
  afterEach(async () => {
    await liveClient.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the session token in memory and sends it on authenticated requests', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accountId: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4',
        session: 'memory-only-token',
        user: { id: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4', name: 'Student', email: 'student@example.test' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4', name: 'Student', email: 'student@example.test' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await liveClient.login({ email: 'student@example.test', password: 'a-valid-password' });
    await liveClient.getCurrentUser();

    const authenticatedHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login');
    expect(authenticatedHeaders.get('Authorization')).toBe('Bearer memory-only-token');
    expect(localStorage.getItem('watchwatcher-session')).toBeNull();
  });
});