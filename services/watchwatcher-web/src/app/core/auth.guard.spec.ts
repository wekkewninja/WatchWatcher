import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStateService } from './auth-state.service';
import { authGuard } from './auth.guard';

afterEach(() => TestBed.resetTestingModule());

describe('authGuard', () => {
  it('waits for auth initialization and allows an authenticated learner', async () => {
    let finishInitialization!: () => void;
    const initialization = new Promise<void>((resolve) => { finishInitialization = resolve; });
    await TestBed.configureTestingModule({
      providers: [
        { provide: AuthStateService, useValue: { initialization, user: () => ({ id: 'sailor-1' }) } },
        { provide: Router, useValue: { createUrlTree: vi.fn() } },
      ],
    }).compileComponents();
    const result = TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/exam' } as never));
    finishInitialization();

    await expect(result).resolves.toBe(true);
  });

  it('redirects signed-out learners to login with their requested return URL', async () => {
    const loginUrl = { path: '/login' };
    const router = { createUrlTree: vi.fn().mockReturnValue(loginUrl) };
    await TestBed.configureTestingModule({
      providers: [
        { provide: AuthStateService, useValue: { initialization: Promise.resolve(), user: () => null } },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    const result = await TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/exam?topic=compass' } as never));

    expect(result).toBe(loginUrl);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/exam?topic=compass' } });
  });
});